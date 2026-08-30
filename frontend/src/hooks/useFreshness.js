import { useEffect, useRef, useState } from 'react';

/**
 * When was what I am looking at last read from the server? [1.58.0]
 *
 * Observes a loading flag rather than owning a fetch, so it works with every data hook in the app
 * without any of them being changed — and, more importantly, without a second source of truth for
 * "when did this load". The alternative was adding a `lastUpdated` to a dozen hooks, where the one
 * that later forgets to stamp it reports a stale reading as fresh, which is worse than no
 * timestamp at all.
 *
 * Stamps on the true→false edge of `loading`, and only when the attempt did not fail: a screen
 * that has just failed to reload is showing OLDER data than the clock would claim, and a
 * confidently wrong "Updated 15:32" over a five-hour-old queue is precisely the thing this exists
 * to prevent.
 *
 * @param loading  the hook's in-flight flag
 * @param error    its error, if any — falsy means the read succeeded
 * @returns Date | null   null until the first successful read
 */
export function useFreshness(loading, error) {
  const [at, setAt] = useState(null);
  const wasLoading = useRef(false);

  useEffect(() => {
    if (wasLoading.current && !loading && !error) setAt(new Date());
    wasLoading.current = loading;
  }, [loading, error]);

  return at;
}

export default useFreshness;
