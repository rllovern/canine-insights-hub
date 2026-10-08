// Private Marketing Ops data endpoint. All access is via the shared guard.
import { mopsHandler, json } from "../_shared/mops/guard.ts";

const OPS = new Set([
  "directory", "client", "timeline", "brief",
  "journal_create", "journal_update", "journal_archive", "journal_revisions", "link_event",
  "lifecycle_update", "asset_upsert", "requirement_set", "decision_add", "form_config_upsert",
  "prospect_create", "prospect_update",
]);

Deno.serve(mopsHandler("mops-api", async ({ body, call }) => {
  const op = String(body.op ?? "");
  if (!OPS.has(op)) return json({ error: "Unknown operation" }, 400);
  const args = (body.args && typeof body.args === "object") ? body.args as Record<string, unknown> : {};
  if (op === "journal_create" || op === "journal_update") {
    const text = String(args.body ?? "");
    if (!text.trim() || text.length > 20000) return json({ error: "Note must be 1–20,000 characters" }, 400);
  }
  return json(await call(op, args));
}));
