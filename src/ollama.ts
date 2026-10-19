import { z } from "zod";
import { Proposal, type ModelProvider } from "./ai.js";
export type LocalModelIdentity = {
  name: string;
  digest: string;
  cloudDisabled: true;
};
async function boundedJson(response: Response) {
  if (!response.ok)
    throw new Error(
      "Local Ollama request failed; verify daemon configuration and installed model",
    );
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Missing model response");
  let bytes = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > 1000000) {
        await reader.cancel();
        throw new Error("Model response exceeds size limit");
      }
      chunks.push(part.value);
    }
  } finally {
    reader.releaseLock();
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}
/** Fail closed unless a trusted loopback daemon confirms cloud disabled and an installed local model. */
export function ollamaProvider(
  model: string,
  endpoint = "http://127.0.0.1:11434",
  transport: typeof fetch = fetch,
  schema: z.ZodType = Proposal,
): ModelProvider & { identity?: LocalModelIdentity } {
  if (!model.trim() || model.length > 200 || /cloud/i.test(model))
    throw new Error(
      "Choose an explicit installed local model; cloud model names are not accepted",
    );
  const base = new URL(endpoint);
  if (
    base.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "[::1]"].includes(base.hostname) ||
    base.username ||
    base.password ||
    base.pathname !== "/" ||
    base.search ||
    base.hash
  )
    throw new Error("Ollama endpoint must be an HTTP loopback origin");
  const provider: ModelProvider & { identity?: LocalModelIdentity } = async (
    request,
  ) => {
    delete provider.identity;
    if (Buffer.byteLength(request.prompt) > 128000)
      throw new Error("AI context exceeds local prompt limit");
    const call = async (path: string, body?: unknown) =>
      boundedJson(
        await transport(new URL(path, base), {
          method: body === undefined ? "GET" : "POST",
          redirect: "error",
          headers: { "content-type": "application/json" },
          signal: AbortSignal.timeout(
            path === "/api/generate" ? 120000 : 10000,
          ),
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        }),
      );
    const status = z
      .object({ cloud: z.object({ disabled: z.literal(true) }) })
      .safeParse(await call("/api/status"));
    if (!status.success)
      throw new Error(
        "Ollama must confirm cloud disabled. Set OLLAMA_NO_CLOUD=1 on the daemon and restart it; an older or unknown status is not accepted.",
      );
    const metadata = z.object({
      name: z.string(),
      digest: z.string().regex(/^(sha256:)?[a-f0-9]{64}$/i),
      remote_model: z.string().optional(),
      remote_host: z.string().optional(),
    });
    const list = z
      .object({ models: z.array(metadata) })
      .parse(await call("/api/tags"));
    const installed = list.models.find(
      (m) => m.name === model || m.name === `${model}:latest`,
    );
    if (!installed || installed.remote_model || installed.remote_host)
      throw new Error(
        "Choose an installed local model; remote or unknown model metadata is rejected",
      );
    const details = z
      .object({
        remote_model: z.string().optional(),
        remote_host: z.string().optional(),
        details: z.object({ format: z.string().min(1) }),
        model_info: z.record(z.string(), z.unknown()),
      })
      .parse(await call("/api/show", { model: installed.name }));
    if (
      details.remote_model ||
      details.remote_host ||
      !Object.keys(details.model_info).length
    )
      throw new Error("Remote or unknown model metadata is rejected");
    provider.identity = {
      name: installed.name,
      digest: installed.digest,
      cloudDisabled: true,
    };
    const payload = z
      .object({
        done: z.literal(true),
        done_reason: z.string().optional(),
        response: z.string().max(100000),
      })
      .parse(
        await call("/api/generate", {
          model: installed.name,
          prompt: request.prompt,
          format: z.toJSONSchema(schema),
          stream: false,
          options: { temperature: 0, num_predict: request.maxOutputTokens },
        }),
      );
    if (payload.done_reason === "length")
      throw new Error("Model output truncated; draft discarded");
    // Detect a model alias changed during inference; cloud-disabled daemon remains the egress boundary.
    const after = z
      .object({ models: z.array(metadata) })
      .parse(await call("/api/tags"));
    if (
      !after.models.some(
        (m) =>
          m.name === installed.name &&
          m.digest === installed.digest &&
          !m.remote_model &&
          !m.remote_host,
      )
    )
      throw new Error(
        "Installed model changed during inference; result discarded",
      );
    return { json: JSON.parse(payload.response), costUsd: 0 };
  };
  return provider;
}
