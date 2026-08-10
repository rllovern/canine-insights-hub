# Make password-reset links single use

## What happens today
The reset page shows the "Update password" form whenever *any* session exists — it calls `getSession()` and flips to ready if a session is returned. Once a recovery link has signed the browser in, that session stays in local storage, so re-opening the same emailed link (or just navigating back to the page) puts the user right back on the form even though the reset was already completed.

## Target behavior
- A reset link works exactly once. After the password is set, that link is dead.
- Re-opening a used link shows "This link has already been used or expired" with a "Back to sign in" button and a "Send me a new link" option.
- Getting back in requires requesting a new reset email from the login page.

## How it will work

**1. Only a fresh recovery event unlocks the form**
The page will stop trusting a pre-existing session. It will unlock only when the URL carries recovery credentials (hash `type=recovery` tokens or the `?code=` PKCE param) and that exchange succeeds in this page load. If the URL has no recovery payload, the page shows the "link already used or expired" state regardless of any lingering session.

**2. Server-side consumption record**
Add a `last_password_reset_at` timestamp to the existing `user_security` row, written by the `set-own-password` function when a reset completes. The reset page passes a flag indicating it came from a recovery link; the function rejects the call if the caller's session was issued before the recorded reset time. This blocks the case where someone keeps an old recovery session in another tab.

**3. Sign out after completion**
Currently the reset page navigates straight into the dashboard on success. It will instead complete the change, sign the recovery session out, and send the user to `/login` with a "Password updated — sign in with your new password" message. This guarantees no reusable recovery session is left behind and matches the "they have to ask again" expectation.

**4. Expired-link recovery path**
The "already used or expired" state includes an email field + "Send new reset link" button so the user doesn't have to hunt for the login page.

## Technical notes
- `src/pages/ResetPassword.tsx`: replace the `getSession()`-based `ready` flag with recovery-payload detection (`window.location.hash` / `?code=`), an `invalid` state, `supabase.auth.signOut()` after success, and a resend form.
- `supabase/functions/set-own-password/index.ts`: record `last_password_reset_at`, reject stale recovery sessions, keep clearing `must_change_password`. Redeploy after edit.
- Migration: add `last_password_reset_at timestamptz` to `public.user_security` (no new grants needed; existing select policy covers it).
- The forced-first-login flow at `/change-password` is unaffected — it uses a normal password session, not a recovery link.
