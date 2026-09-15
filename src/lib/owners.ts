// Single source of truth for the owner-email allowlist.
export const OWNER_EMAILS = ["rl.lovern@gmail.com"];

export function isOwnerEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return OWNER_EMAILS.includes(email.toLowerCase());
}
