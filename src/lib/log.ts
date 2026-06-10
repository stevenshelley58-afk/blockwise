/**
 * Returns a catch handler that logs the error with context before resolving
 * to the fallback. Use instead of silent `.catch(() => fallback)` so failed
 * fetches stay observable in server logs while the UI still degrades
 * gracefully.
 */
export function logCaught<T>(context: string, fallback: T): (error: unknown) => T {
  return (error) => {
    console.error(`[${context}]`, error);
    return fallback;
  };
}
