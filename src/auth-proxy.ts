import { createServer, request } from "node:http";
import { connect, type Socket } from "node:net";
/** Capture-only local proxy: checks HTTP origins and TLS CONNECT destinations, including redirects. */
export async function openAuthProxy(allowed: Set<string>) {
  const sockets = new Set<Socket>();
  const track = (socket: Socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => socket.destroy());
    return socket;
  };
  const server = createServer((req, res) => {
    let target: URL;
    try {
      target = new URL(req.url ?? "");
      if (
        target.protocol !== "http:" ||
        !allowed.has(target.origin) ||
        target.username ||
        target.password
      )
        throw new Error();
    } catch {
      res.writeHead(403);
      res.end("Origin not allowed for sign-in");
      return;
    }
    const headers: import("node:http").OutgoingHttpHeaders = {
      ...req.headers,
      host: target.host,
    };
    delete headers["proxy-authorization"];
    delete headers["proxy-connection"];
    delete headers.connection;
    const outgoing = request(
      target,
      { method: req.method, headers, timeout: 30000 },
      (incoming) => {
        res.writeHead(incoming.statusCode ?? 502, incoming.headers);
        incoming.pipe(res);
      },
    );
    outgoing.on("socket", track);
    outgoing.on("timeout", () => outgoing.destroy());
    outgoing.on("error", () => {
      if (!res.headersSent) res.writeHead(502);
      res.end();
    });
    req.on("aborted", () => outgoing.destroy());
    req.pipe(outgoing);
  });
  server.on("connection", track);
  server.on("connect", (req, client, head) => {
    let target: URL;
    try {
      target = new URL(`https://${req.url}`);
      if (
        !allowed.has(target.origin) ||
        target.username ||
        target.password ||
        target.pathname !== "/"
      )
        throw new Error();
    } catch {
      client.end("HTTP/1.1 403 Forbidden\r\n\r\n");
      return;
    }
    const upstream = track(
      connect(
        Number(target.port || 443),
        target.hostname.replace(/^\[|\]$/g, ""),
        () => {
          client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
          if (head.length) upstream.write(head);
          client.pipe(upstream);
          upstream.pipe(client);
        },
      ),
    );
    upstream.on("error", () => client.destroy());
    client.on("error", () => upstream.destroy());
    client.on("close", () => upstream.destroy());
  });
  server.maxConnections = 128;
  server.on("upgrade", (_req, socket) => socket.destroy());
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Could not open sign-in proxy");
  return {
    proxy: {
      server: `http://127.0.0.1:${address.port}`,
      bypass: "<-loopback>",
    },
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}
