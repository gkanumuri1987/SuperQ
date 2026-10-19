import {
  mkdir,
  chmod,
  stat,
  rm,
  readdir,
  lstat,
  readFile,
} from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { BrowserContext } from "@playwright/test";
export type TraceArtifact = {
  id: string;
  testId: string;
  attempt: number;
  bytes: number;
  expiresAt: string;
};
/** Raw traces are sensitive, opt-in, local artifacts. Never part of exported reports. */
export class TraceStore {
  readonly artifacts: TraceArtifact[] = [];
  readonly warnings: string[] = [];
  warn() {
    if (!this.warnings.length)
      this.warnings.push(
        "Some traces could not be retained (browser closed, capture failed or storage limit). Test results remain independent of trace availability.",
      );
  }
  private started = 0;
  constructor(private directory: string) {}
  async prune() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    await chmod(this.directory, 0o700);
    for (const name of await readdir(this.directory))
      if (/^[a-f0-9-]{36}\.zip$/.test(name)) {
        const path = join(this.directory, name),
          s = await lstat(path);
        if (s.isSymbolicLink() || Date.now() - s.mtimeMs > 86400000)
          await rm(path, { force: true });
      }
  }
  async start(context: BrowserContext, testId: string, attempt: number) {
    await this.prune();
    if (this.started++ >= 20)
      throw new Error("Trace limit reached (20 journeys per run)");
    let total = 0,
      count = 0;
    for (const name of await readdir(this.directory)) {
      const s = await lstat(join(this.directory, name));
      total += s.size;
      count++;
    }
    if (total > 450_000_000 || count >= 100)
      throw new Error("Private trace storage full; delete existing traces");
    const id = randomUUID(),
      path = join(this.directory, `${id}.zip`);
    await context.tracing.start({
      screenshots: true,
      snapshots: true,
      sources: false,
    });
    let stopped = false;
    return async () => {
      if (stopped) return;
      stopped = true;
      try {
        await context.tracing.stop({ path });
        await chmod(path, 0o600);
        const s = await stat(path);
        if (s.size > 50_000_000) throw new Error("Trace too large");
        this.artifacts.push({
          id,
          testId,
          attempt,
          bytes: s.size,
          expiresAt: new Date(Date.now() + 86400000).toISOString(),
        });
      } catch {
        await rm(path, { force: true });
        throw new Error(
          "Trace could not be retained; capture limit or browser closed",
        );
      }
    };
  }
  async read(artifact: TraceArtifact) {
    if (
      !/^[a-f0-9-]{36}$/.test(artifact.id) ||
      Date.parse(artifact.expiresAt) <= Date.now()
    )
      throw new Error("Trace expired");
    const path = join(this.directory, `${artifact.id}.zip`),
      s = await lstat(path);
    if (
      !s.isFile() ||
      s.isSymbolicLink() ||
      s.size > 50_000_000 ||
      (process.platform !== "win32" && (s.mode & 0o077) !== 0)
    )
      throw new Error("Trace unavailable");
    return readFile(path);
  }
  async remove(artifact: TraceArtifact) {
    if (!/^[a-f0-9-]{36}$/.test(artifact.id)) throw new Error("Invalid trace");
    await rm(join(this.directory, `${artifact.id}.zip`), { force: true });
  }
}
