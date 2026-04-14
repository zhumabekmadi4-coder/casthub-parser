// Concurrency primitives — no external dependencies.

/**
 * Run a fixed list of async tasks with a maximum concurrency limit.
 * Tasks are passed as factories so they don't start until a slot frees up.
 * Returns settled results (never throws).
 */
export async function runWithConcurrency<T>(
  factories: Array<() => Promise<T>>,
  limit: number
): Promise<PromiseSettledResult<T>[]> {
  if (limit <= 0) throw new Error("limit must be > 0");
  const results: PromiseSettledResult<T>[] = new Array(factories.length);
  let cursor = 0;

  const worker = async () => {
    while (true) {
      const idx = cursor++;
      if (idx >= factories.length) return;
      try {
        const value = await factories[idx]();
        results[idx] = { status: "fulfilled", value };
      } catch (reason) {
        results[idx] = { status: "rejected", reason };
      }
    }
  };

  const workers = Array.from({ length: Math.min(limit, factories.length) }, worker);
  await Promise.all(workers);
  return results;
}

/**
 * Long-lived counting semaphore. Used to cap concurrent OpenAI requests
 * across the whole app (multiple sync-history pages, multiple roles per
 * message, multiple sub-extractions per role would otherwise overrun
 * provider rate limits).
 */
export class Semaphore {
  private available: number;
  private waiters: Array<() => void> = [];

  constructor(limit: number) {
    if (limit <= 0) throw new Error("limit must be > 0");
    this.available = limit;
  }

  async acquire(): Promise<() => void> {
    if (this.available > 0) {
      this.available--;
      return () => this.release();
    }
    return new Promise<() => void>((resolve) => {
      this.waiters.push(() => {
        this.available--;
        resolve(() => this.release());
      });
    });
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    const release = await this.acquire();
    try {
      return await fn();
    } finally {
      release();
    }
  }

  private release(): void {
    this.available++;
    const next = this.waiters.shift();
    if (next) next();
  }
}
