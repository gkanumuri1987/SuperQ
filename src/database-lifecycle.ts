/** Own database resources beyond a runner timeout, until bounded cleanup completes. */
export class DatabaseLifecycle {
  private active = new Set<() => Promise<void>>();
  private closed = false;
  private failed = false;
  constructor(private cleanupMs = 5000) {}
  async run<T>(
    parent: AbortSignal | undefined,
    cleanup: () => Promise<void>,
    work: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    if (this.closed || parent?.aborted)
      throw new Error("Database operation cancelled");
    const controller = new AbortController();
    let cleaning: Promise<void> | undefined;
    const clean = () =>
      (cleaning ??= (async () => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([
            Promise.resolve().then(cleanup),
            new Promise<never>((_, reject) => {
              timer = setTimeout(
                () => reject(new Error("Database cleanup deadline exceeded")),
                this.cleanupMs,
              );
            }),
          ]);
        } catch {
          this.failed = true;
          throw new Error(
            "Database cleanup failed or timed out; remote cancellation is unconfirmed",
          );
        } finally {
          clearTimeout(timer);
        }
      })());
    const stop = async () => {
      controller.abort();
      await clean();
    };
    const abort = () => {
      void stop().catch(() => {});
    };
    this.active.add(stop);
    parent?.addEventListener("abort", abort, { once: true });
    let onAbort: (() => void) | undefined;
    try {
      if (parent?.aborted) abort();
      controller.signal.throwIfAborted();
      return await Promise.race([
        work(controller.signal),
        new Promise<never>((_, reject) => {
          onAbort = () => reject(new Error("Database operation cancelled"));
          if (controller.signal.aborted) onAbort();
          else
            controller.signal.addEventListener("abort", onAbort, {
              once: true,
            });
        }),
      ]);
    } finally {
      parent?.removeEventListener("abort", abort);
      if (onAbort) controller.signal.removeEventListener("abort", onAbort);
      try {
        await clean();
      } finally {
        this.active.delete(stop);
      }
    }
  }
  async close() {
    this.closed = true;
    const results = await Promise.allSettled(
      [...this.active].map((stop) => stop()),
    );
    if (this.failed || results.some((r) => r.status === "rejected"))
      throw new Error(
        "Database cleanup failed or timed out; remote cancellation is unconfirmed",
      );
  }
}
