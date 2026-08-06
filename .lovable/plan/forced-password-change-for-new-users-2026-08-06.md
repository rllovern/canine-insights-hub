# Forced password change for new users

## Goal
When you create a login for someone (owner level or any role), they sign in with the temporary password you sent, are immediately prompted to set their own password, and can't use the app until they do. Also add a self-serve "Forgot password" path.

## What the user sees
1. You create the account in Admin → Users with a temporary password (unchanged flow). A new "Require password change on first sign-in" toggle is on by default.
2. They sign in at /login and land on a full-screen "Set your password" screen — no sidebar, no dashboard access.
3. They enter a new password twice (min 8 chars, confirm match, strength hint). On success they go straight to their normal landing page.
4. If they sign out before finishing, the prompt reappears next sign-in.
5. Login page gains a "Forgot password?" link → email reset → /reset-password page to set a new one.

## Technical approach

**Flag storage** — new table `public.user_security(user_id uuid pk → auth.users, must_change_password boolean default true, updated_at)`. Grants: `select` to `authenticated`, `all` to `service_role`. RLS: users can read only their own row; no client insert/update (only service role writes), so the prompt can't be bypassed by editing metadata.

**Backend**
- `admin-users` edge function: on `create`, insert `user_security` row with `must_change_password = true` (respecting the new toggle); on `update` when an admin sets a new password, set the flag true again. Also expose the flag in `list` so the admin table can show a "Pending password setup" badge.
- New edge function `set-own-password`: validates the caller's JWT, validates the new password (length ≥ 8, not equal to current), calls `auth.admin.updateUserById`, then clears `must_change_password`. Clearing happens server-side only.

**Frontend**
- `AuthContext`: fetch the caller's `user_security` row alongside the role; expose `mustChangePassword` and a `refreshSecurity()`.
- New `src/pages/ChangePassword.tsx` using `AuthShell`, calling `set-own-password`.
- `RequireAuth`: if authenticated and `mustChangePassword`, redirect every protected route to `/change-password` (that route itself excluded). Public routes `/login`, `/report/:token`, `/reset-password` unaffected.
- New `src/pages/ResetPassword.tsx` (public) handling the recovery link + `supabase.auth.updateUser({ password })`, and a "Forgot password?" link on `Login.tsx` calling `resetPasswordForEmail` with `redirectTo` `${origin}/reset-password`.
- Routes registered in `App.tsx`.
- Admin Users table: badge for accounts that still owe a password change.

## Notes
- Password reset emails use the built-in default auth emails; no domain setup needed unless you later want branded emails.
