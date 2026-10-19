import { createServer, request } from "node:http";
import { connect, type Socket } from "node:net";
/** Origin-restricted streaming proxy for capture and local browser execution. */
export async function openAuthProxy(
  allowed: Set<string>,
  options: { webSockets?: boolean; onDenied?: () => void } = {},
) {
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
      options.onDenied?.();
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
        const location = incoming.headers.location;
        if (
          (incoming.statusCode ?? 0) >= 300 &&
          (incoming.statusCode ?? 0) < 400 &&
          location
        ) {
          try {
            const destination = new URL(location, target);
            if (
              !allowed.has(destination.origin) ||
              destination.username ||
              destination.password
            )
              throw new Error();
          } catch {
            options.onDenied?.();
            incoming.destroy();
            res.destroy();
            return;
          }
        }
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
    res.on("close", () => outgoing.destroy());
    req.on("aborted", () => outgoing.destroy());
    req.pipe(outgoing);
  });
  server.on("connection", track);
  server.on("connect", (req, client, head) => {
    let target: URL;
    try {
      target = new URL(`https://${req.url}`);
      if (
        (!allowed.has(target.origin) &&
          !(options.webSockets && allowed.has(`http://${req.url}`))) ||
        target.username ||
        target.password ||
        target.pathname !== "/"
      )
        throw new Error();
    } catch {
      options.onDenied?.();
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
  server.on("upgrade", (req, socket, head) => {
    let target: URL;
    try {
      target = new URL(req.url ?? "");
      if (target.protocol === "ws:") target.protocol = "http:";
      if (
        !options.webSockets ||
        target.protocol !== "http:" ||
        !allowed.has(target.origin) ||
        target.username ||
        target.password
      )
        throw new Error();
    } catch {
      options.onDenied?.();
      socket.destroy();
      return;
    }
    const headers: import("node:http").OutgoingHttpHeaders = {
      ...req.headers,
      host: target.host,
    };
    delete headers["proxy-authorization"];
    delete headers["proxy-connection"];
    const outgoing = request(target, { headers, timeout: 15000 });
    outgoing.on("socket", track);
    outgoing.on("upgrade", (response, upstream, upstreamHead) => {
      socket.write(
        `HTTP/1.1 ${response.statusCode} Switching Protocols\r\n` +
          Object.entries(response.headers)
            .map(([k, v]) => `${k}: ${v}\r\n`)
            .join("") +
          "\r\n",
      );
      if (upstreamHead.length) socket.write(upstreamHead);
      if (head.length) upstream.write(head);
      socket.pipe(upstream);
      upstream.pipe(socket);
      socket.on("close", () => upstream.destroy());
      upstream.on("close", () => socket.destroy());
    });
    outgoing.on("response", () => {
      outgoing.destroy();
      socket.destroy();
    });
    outgoing.on("error", () => socket.destroy());
    outgoing.on("timeout", () => outgoing.destroy());
    outgoing.end();
  });
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
