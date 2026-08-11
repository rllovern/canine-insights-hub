# Separate welcome / set-password email for new users

Today a newly created user gets the exact same "Reset your password" email that an existing user gets when they ask for a reset. New accounts will instead get a distinct invitation email, and the page that link opens will greet them as a new user rather than as someone resetting a forgotten password.

## What changes

1. **New user → invitation email.** When an admin adds a user in Admin → Users, the app sends the built-in *invitation* email ("You have been invited") instead of the password-reset email. Different subject and wording, same secure one-time link.
2. **Password reset → unchanged.** Anyone using "Forgot password" keeps getting the reset email exactly as today.
3. **Resend is context-aware.** "Resend invite" re-sends the invitation to people who have never signed in; for users who have already signed in it sends a normal reset link.
4. **Welcome experience lands in the app.** Since branded email copy isn't available without a sender domain, the welcome message lives on the page the invite link opens: "Welcome to RSK9 Insights — set a password to finish setting up your account," with a one-line note about what the dashboard covers. Reset-link visitors keep the existing "Choose a new password" copy.
5. **Admin feedback.** The Add User dialog and its toasts say "invitation email sent" rather than referring to a reset email. The temp password stays visible as a fallback.

## Note on branding

You chose built-in templates for now, so the invitation email uses the default sender and default wording. Fully branded, custom-worded welcome emails from rsk9insights.com are a follow-up: set up the sender domain, then swap in custom templates.

## Technical details

- `supabase/functions/admin-users/index.ts`
  - Create path: replace `anon.auth.resetPasswordForEmail(...)` with an invite link — `admin.auth.admin.generateLink({ type: 'invite', email, options: { redirectTo: <app>/reset-password?welcome=1 } })` (or `inviteUserByEmail` where the account does not pre-exist). Keep the existing behaviour that a mail failure never fails user creation, and keep returning `invite_email_sent` / `invite_email_error`.
  - `resend_invite`: look up the user; if `last_sign_in_at` is null send the invitation link, otherwise fall back to the current recovery email. Report which kind was sent.
- `src/pages/ResetPassword.tsx`
  - Treat `?welcome=1` (and an `invite` link type in the URL payload) as invite mode: title "Welcome to RSK9 Insights", subtitle "Set a password to finish setting up your account", submit button "Set password", success toast "Password set — sign in to continue".
  - `hasRecoveryPayload()` already accepts `token_hash` / `code`, which is what invite links carry, so the single-use gating is unchanged.
- `src/pages/admin/AdminUsers.tsx`: update helper text and toasts to "invitation email".
- Redeploy the `admin-users` edge function.

## Verification

- Create a test user, confirm the received email is the invitation (not "Reset your password"), follow the link, confirm the welcome wording and that setting the password clears the forced-change flag.
- Run "Forgot password" on an existing account and confirm that email and page are unchanged.