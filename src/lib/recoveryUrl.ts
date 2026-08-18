/**
 * Supabase's client consumes password-recovery params from the URL at import
 * time (detectSessionInUrl) and then clears them with history.replaceState.
 * By the time React mounts, the reset page can no longer see them. This module
 * is imported first in main.tsx so it snapshots the original URL before any
 * Supabase code runs.
 */
function read(): boolean {
  try {
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const search = new URLSearchParams(window.location.search);
    return Boolean(
      hash.get("access_token") ||
        hash.get("token_hash") ||
        search.get("code") ||
        search.get("token_hash"),
    );
  } catch {
    return false;
  }
}

const hadPayloadAtLoad = read();

/** True when this page load arrived with a fresh recovery/invite payload. */
export function hadRecoveryPayloadAtLoad(): boolean {
  return hadPayloadAtLoad;
}