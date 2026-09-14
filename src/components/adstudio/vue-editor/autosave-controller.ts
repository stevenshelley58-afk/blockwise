export const AUTOSAVE_DELAY_MS = 2500;

type SaveResult = boolean | void;
type Save = () => SaveResult | Promise<SaveResult>;

export function createAutosaveController(save: Save, delayMs = AUTOSAVE_DELAY_MS) {
  let version = 0;
  let attemptedVersion: number | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight = false;
  let enabled = true;
  let disposed = false;

  const clearTimer = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };

  const attempt = async (targetVersion: number) => {
    if (disposed || inFlight) return;
    attemptedVersion = targetVersion;
    inFlight = true;
    try {
      await save();
    } finally {
      inFlight = false;
      if (!disposed && version !== targetVersion) schedule();
    }
  };

  const schedule = () => {
    clearTimer();
    if (disposed || !enabled || attemptedVersion === version) return;
    timer = setTimeout(() => {
      timer = null;
      void attempt(version).catch(() => undefined);
    }, delayMs);
  };

  return {
    edit() {
      if (disposed) return;
      version += 1;
      schedule();
    },
    setEnabled(value: boolean) {
      if (disposed || enabled === value) return;
      enabled = value;
      if (!enabled) clearTimer();
      else schedule();
    },
    dispose() {
      disposed = true;
      clearTimer();
    },
    getState() {
      return { version, attemptedVersion, inFlight };
    },
  };
}
