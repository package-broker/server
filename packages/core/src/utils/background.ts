export interface BackgroundContext {
  executionCtx: {
    waitUntil(promise: Promise<unknown>): void;
  };
}

export function runInBackground(c: BackgroundContext, promise: Promise<unknown>): void {
  try {
    c.executionCtx.waitUntil(promise);
  } catch {
    promise.catch(() => {
      // Ignore background task failures in runtimes without waitUntil.
    });
  }
}
