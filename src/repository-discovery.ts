import { execFileSync } from "node:child_process";
import { realpath } from "node:fs/promises";
import { createHash } from "node:crypto";
import { z } from "zod";
import type { Snapshot } from "./knowledge.js";

export const Discovery = z.object({
  trackedFiles: z.number(),
  included: z.array(
    z.object({ path: z.string(), kind: z.enum(["documentation", "source"]) }),
  ),
  skipped: z.array(z.object({ path: z.string(), reason: z.string() })),
  contentBytes: z.number(),
  byteLimit: z.number(),
});
export type Discovery = z.infer<typeof Discovery>;
const ignored =
  /(^|\/)(node_modules|vendor|dist|build|coverage|\.git|\.next|\.venv|venv|generated)(\/|$)|(?:^|\/)(?:package-lock\.json|yarn\.lock|pnpm-lock\.yaml)$|\.(min\.js|map)$/i;
const sensitive =
  /(^|\/)(\.env[^/]*|[^/]*\.(pem|key|p12|pfx|keystore)|credentials[^/]*|secrets?[^/]*|\.npmrc|\.netrc|id_rsa[^/]*|id_ed25519[^/]*)$/i;
function kind(path: string): "documentation" | "source" | undefined {
  if (
    /\.(md|mdx|rst|adoc|txt)$/i.test(path) ||
    /(^|\/)(README|ARCHITECTURE|CONTRIBUTING|CHANGELOG)$/i.test(path) ||
    /(^|\/)(openapi|swagger|asyncapi)[^/]*\.(json|ya?ml)$/i.test(path)
  )
    return "documentation";
  if (
    /\.(tsx?|jsx?|mjs|cjs|vue|svelte|py|java|kt|cs|go|rb|php|rs|swift|sql|graphql|gql|proto|html|ya?ml|json)$/i.test(
      path,
    )
  )
    return "source";
}
/** Inventory committed paths first. Never follow repository instructions or external links. */
export async function discoverRepository(
  repo: string,
): Promise<Snapshot & { discovery: Discovery }> {
  const root = await realpath(repo);
  const git = (args: string[], maxBuffer = 16 * 1024 * 1024) =>
    execFileSync("git", ["-C", root, ...args], { encoding: "utf8", maxBuffer });
  const revision = git(["rev-parse", "HEAD"]).trim();
  const entries = git(["ls-tree", "-rlz", revision])
    .split("\0")
    .filter(Boolean)
    .map((line) => {
      const tab = line.indexOf("\t"),
        [mode, type, oid, size] = line.slice(0, tab).trim().split(/\s+/);
      return {
        path: line.slice(tab + 1),
        mode,
        type,
        oid: oid!,
        size: Number(size),
      };
    });
  const discovery: Discovery = {
    trackedFiles: entries.length,
    included: [],
    skipped: [],
    contentBytes: 0,
    byteLimit: 64000,
  };
  const files: Snapshot["files"] = [];
  // Documentation first, then deterministic application source order. No silent truncation.
  entries.sort(
    (a, b) =>
      Number(kind(b.path) === "documentation") -
        Number(kind(a.path) === "documentation") ||
      a.path.localeCompare(b.path),
  );
  for (const entry of entries) {
    const category = kind(entry.path);
    let reason = sensitive.test(entry.path)
      ? "Sensitive filename"
      : ignored.test(entry.path)
        ? "Dependency or generated file"
        : entry.type !== "blob" || entry.mode === "120000"
          ? "Symlink or submodule"
          : !category
            ? "Unsupported format"
            : entry.size > 256000
              ? "File exceeds size limit"
              : files.length >= 100 ||
                  discovery.contentBytes + entry.size > discovery.byteLimit
                ? "Outside initial analysis budget; select a focused scope"
                : "";
    if (!reason) {
      const content = git(["cat-file", "blob", entry.oid], 256000);
      if (content.includes("\0") || content.includes("\uFFFD"))
        reason = "Binary or non-UTF-8 content";
      else {
        files.push({
          path: entry.path,
          content,
          hash: createHash("sha256").update(content).digest("hex"),
        });
        discovery.included.push({ path: entry.path, kind: category! });
        discovery.contentBytes += Buffer.byteLength(content);
      }
    }
    if (reason) discovery.skipped.push({ path: entry.path, reason });
  }
  if (!files.length)
    throw new Error(
      "No supported application source or documentation found in the committed repository. Choose explicit text files or add documentation to Git.",
    );
  return { revision, files, discovery };
}
