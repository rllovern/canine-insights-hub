# Branded emails from rsk9insights.com (and out of the spam folder)

Right now invitation and password emails go out from a generic default sender that has no relationship to your domain. Mailbox providers see an unfamiliar sender with no authentication record for rsk9insights.com, so the messages get filed as spam. The fix is to send from your own authenticated sender domain and replace the stock templates with Ridgeside-branded ones.

## What changes

1. **Set up a sender domain.** Emails will come from a subdomain of rsk9insights.com (for example `notify.rsk9insights.com`). This requires adding a small set of DNS records at your registrar — the setup dialog shows the exact values, and I'll walk you through it. Once verified, your mail is properly authenticated (SPF/DKIM/DMARC-aligned), which is the single biggest factor in staying out of spam.
2. **Branded auth emails.** Signup/invitation, password reset, magic link, email change, and reauthentication emails get custom templates using the Ridgeside K9 logo, brand colors, and your wording — including a proper "Welcome to RSK9 Insights" invitation instead of the generic default.
3. **Email infrastructure.** Queueing, retry, bounce/complaint suppression, and one-click unsubscribe handling get set up so failed sends retry and repeatedly bouncing addresses stop being mailed (another deliverability factor).
4. **Delivery monitoring.** Cloud → Emails shows domain verification status and send history so we can confirm the invites are landing.

## Order of work

```text
1. You complete the sender-domain setup dialog for rsk9insights.com
2. DNS records added at your registrar -> domain verifies (can take a few hours)
3. I set up the email infrastructure and branded auth templates
4. I deploy and we send a test invite to confirm inbox placement
```

Steps 3 and 4 don't have to wait for DNS to finish verifying — I can build the templates while verification is in flight; sending simply activates once the domain is green.

## Technical details

- Provision the sender domain via the email setup flow; Lovable manages SPF/DKIM/MX in the delegated subdomain zone.
- Run email infrastructure setup (queues, send log, suppression list, unsubscribe tokens, queue processor).
- Scaffold auth email templates: an `auth-email-hook` function plus six React Email templates (signup, magic-link, recovery, invite, email-change, reauthentication), restyled to the app's design tokens with the Ridgeside logo.
- Keep the existing invite flow in `supabase/functions/admin-users/index.ts` as-is — it calls `inviteUserByEmail`, which will now render the branded invite template automatically.
- Deploy `auth-email-hook`.

## Note

Your registrar must support NS records for the delegated subdomain. If it doesn't, the alternatives are moving DNS hosting (e.g. Cloudflare free) or transferring the domain into Lovable — I'll flag it if we hit that.
