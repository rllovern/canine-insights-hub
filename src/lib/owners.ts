// Single source of truth for the "View as Bob" impersonation toggle.
// Only emails in OWNER_EMAILS see the toggle.
export const OWNER_EMAILS = ["rl.lovern@gmail.com"];

export const BOB_EMAIL = "bob@demo.rsk9insights.com";

// Seeded by supabase/functions/seed-bob/index.ts. Bob is a viewer with
// access to every active property.
export const BOB_USER_ID = "76ee5d03-a371-47bd-b822-7b223e4f4a70";

export function isOwnerEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return OWNER_EMAILS.includes(email.toLowerCase());
}