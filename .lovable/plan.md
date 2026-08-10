# Welcome email for new users

When an admin creates a user in Admin → Users, the app will automatically email that person a secure link to set their own password, instead of relying on the admin to hand over a temporary password verbally.

## How it works

1. Admin fills out the Add User form as today (email, role, property).
2. The account is still created immediately with a temp password and the "must change password" flag.
3. Right after creation, the backend sends a password-set email to the new user containing a one-time link that lands on the existing `/reset-password` page.
4. The Add User dialog reports whether the email was sent, and still shows the temp password as a fallback.
5. A "Resend invite email" action is added to each row in the users list, for cases where the first email is lost.

## Email delivery

Right now the project has no sender domain configured, so email would go out from a default Lovable sender address (deliverable, but not branded as rsk9insights.com).

- Phase 1 (this plan): use the built-in auth recovery email so invites work today, no domain setup needed.
- Phase 2 (optional, later): set up `rsk9insights.com` as the sender domain and swap in a branded, custom-worded invite template.

## Technical details

- `supabase/functions/admin-users/index.ts`
  - In the `create` action, after role/security rows are written, call `admin.auth.admin.generateLink({ type: 'recovery', email, options: { redirectTo: <app>/reset-password } })` so GoTrue delivers the email.
  - Accept an optional `send_invite_email` boolean (default true) and an `app_url` from the caller.
  - Return `{ ok, user_id, invite_email_sent, invite_email_error }` — a mail failure must not fail user creation.
  - Add a new `resend_invite` action that takes `user_id`, looks up the email, re-sends the same recovery link, and re-sets `must_change_password = true`.
- `src/pages/admin/AdminUsers.tsx`
  - Pass `app_url: window.location.origin` on create; surface a toast for sent/failed.
  - Update the helper text from "Share the temporary password" to reflect that an email was sent, with temp password as backup.
  - Add a "Resend invite" item to the per-user actions menu.
- Verify `/reset-password` handles the `recovery` link type and clears `must_change_password` after a successful set (it already calls `set-own-password`/`updateUser`); adjust only if the flag is not cleared on that path.
- Redeploy the `admin-users` edge function.

## Rate limits

Auth emails have an hourly cap. If bulk user creation ever trips it, the invite is retried via the "Resend invite" action rather than blocking account creation.
