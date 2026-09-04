export type MetaExecutionLeaseHeartbeat = {
  signal: AbortSignal;
  fetch: typeof fetch;
  renewNow: () => Promise<void>;
  assertOwned: () => void;
  stop: () => void;
};

/**
 * Keep a database execution lease alive independently of provider checkpoints.
 * Losing the lease aborts primary provider I/O; callers keep compensation on a
 * separate transport so safety PAUSE requests can still complete.
 */
export function createMetaExecutionLeaseHeartbeat(input: {
  renew: () => Promise<boolean>;
  intervalMs?: number;
  fetchImpl?: typeof fetch;
}): MetaExecutionLeaseHeartbeat {
  const controller = new AbortController();
  const fetchImpl = input.fetchImpl ?? fetch;
  const intervalMs = input.intervalMs ?? 120_000;
  let stopped = false;
  let failure: Error | null = null;
  let renewal: Promise<void> | null = null;

  const loseLease = (error: unknown) => {
    if (stopped || failure) return;
    failure = error instanceof Error ? error : new Error("The Meta execution lease was lost.");
    controller.abort(failure);
  };

  const renewNow = async () => {
    if (stopped) return;
    if (failure) throw failure;
    if (!renewal) {
      renewal = (async () => {
        try {
          const owned = await input.renew();
          if (!stopped && !owned) throw new Error("The Meta execution lease was lost.");
        } catch (error) {
          if (!stopped) {
            loseLease(error);
            throw failure;
          }
        }
      })().finally(() => {
        renewal = null;
      });
    }
    await renewal;
    if (failure) throw failure;
  };

  const timer = setInterval(() => {
    void renewNow().catch(() => undefined);
  }, intervalMs);
  timer.unref?.();

  const guardedFetch: typeof fetch = (resource, init) => {
    const signal = init?.signal
      ? AbortSignal.any([init.signal, controller.signal])
      : controller.signal;
    return fetchImpl(resource, { ...init, signal });
  };

  return {
    signal: controller.signal,
    fetch: guardedFetch,
    renewNow,
    assertOwned: () => {
      if (failure) throw failure;
    },
    stop: () => {
      stopped = true;
      clearInterval(timer);
    },
  };
}
