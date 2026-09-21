// Plain-text app email sender.
//
// Uses Lovable's managed email service on the project's verified sender
// domain (notify.rsk9insights.com). No third-party provider, no extra key —
// LOVABLE_API_KEY is already present and server-only.
import { sendLovableEmail, EmailAPIError } from "npm:@lovable.dev/email-js@0.1.0";

export const SENDER_DOMAIN = "notify.rsk9insights.com";
export const FROM = `Ridgeside Insights Alerts <alerts@${SENDER_DOMAIN}>`;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export interface SendResult {
  sent: boolean;
  to: string;
  reason?: string;
  message_id?: string;
}

/** Sends one plain-text email. Never throws; returns a result for logging. */
export async function sendPlainEmail(
  to: string,
  subject: string,
  text: string,
  idempotencyKey?: string,
): Promise<SendResult> {
  const apiKey = Deno.env.get("LOVABLE_API_KEY");
  if (!apiKey) return { sent: false, to, reason: "missing_lovable_api_key" };

  const html =
    `<pre style="font:14px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre-wrap;margin:0">${escapeHtml(text)}</pre>`;

  // App emails must carry an idempotency key with purpose=transactional.
  const key = idempotencyKey ?? crypto.randomUUID();

  try {
    const res = await sendLovableEmail(
      {
        to,
        from: FROM,
        sender_domain: SENDER_DOMAIN,
        subject,
        text,
        html,
        purpose: "transactional",
        idempotency_key: key,
      },
      { apiKey, idempotencyKey: key },
    );
    return { sent: !!res.success, to, message_id: res.message_id };
  } catch (e) {
    if (e instanceof EmailAPIError) {
      console.error(`[email] ${e.status} ${e.code ?? ""}: ${e.message}`);
      return { sent: false, to, reason: e.code ?? `http_${e.status}` };
    }
    console.error("[email] send failed:", e);
    return { sent: false, to, reason: String(e) };
  }
}
