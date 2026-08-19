/** Sentinel returned when a request does not settle in time. */
export const TIMED_OUT = Symbol("timed-out");

/** Default ceiling for auth/bootstrap requests before we show an error state. */
export const BACKEND_TIMEOUT_MS = 12_000;

/**
 * Races a promise against a timeout and swallows rejections, so a hanging or
 * failing backend request can never leave a loading flag stuck on `true`.
 */
export async function withTimeout<T>(
  p: PromiseLike<T>,
  ms: number = BACKEND_TIMEOUT_MS,
): Promise<T | typeof TIMED_OUT> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve(p),
      new Promise<typeof TIMED_OUT>((resolve) => {
        timer = setTimeout(() => resolve(TIMED_OUT), ms);
      }),
    ]);
  } catch {
    return TIMED_OUT;
  } finally {
    if (timer) clearTimeout(timer);
  }
}