// Private Marketing Ops data endpoint. All access is via the shared guard.
import { mopsHandler, json } from "../_shared/mops/guard.ts";

const OPS = new Set([
  "directory", "client", "timeline", "brief",
  "journal_create", "journal_update", "journal_archive", "journal_revisions", "link_event",
  "lifecycle_update", "asset_upsert", "requirement_set", "decision_add", "form_config_upsert",
  "prospect_create", "prospect_update",
  // Nested SOP workspace
  "sop_templates", "sop_tree", "sop_draft_ensure", "sop_draft_discard",
  "sop_node_create", "sop_node_update", "sop_node_delete", "sop_node_move", "sop_publish",
  "sop_client", "sop_portfolio", "sop_status_set", "sop_history", "sop_apply_update",
  "sop_import_commit", "sop_attach_upload", "sop_attach_url", "sop_attach_delete",
]);

const MAX_FILE = 8 * 1024 * 1024;

Deno.serve(mopsHandler("mops-api", async ({ body, call, sopStorage }) => {
  const op = String(body.op ?? "");
  if (!OPS.has(op)) return json({ error: "Unknown operation" }, 400);
  const args = (body.args && typeof body.args === "object") ? body.args as Record<string, unknown> : {};
  if (op === "journal_create" || op === "journal_update") {
    const text = String(args.body ?? "");
    if (!text.trim() || text.length > 20000) return json({ error: "Note must be 1–20,000 characters" }, 400);
  }
  if ((op === "sop_node_create" || op === "sop_node_update") && typeof args.body_md === "string" && args.body_md.length > 100000) {
    return json({ error: "Description is too long (100,000 characters max)" }, 400);
  }

  if (op === "sop_attach_upload") {
    const b64 = String(args.data_base64 ?? "");
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    if (!bytes.length || bytes.length > MAX_FILE) return json({ error: "File must be under 8 MB" }, 400);
    const meta = await call("sop_attach_add", {
      template_id: args.template_id, stable_key: args.stable_key, property_id: args.property_id ?? null,
      file_name: String(args.file_name ?? "file").slice(0, 200), mime: String(args.mime ?? "application/octet-stream"), size_bytes: bytes.length,
    });
    const { error } = await sopStorage().upload(String(meta.storage_path), bytes, { contentType: String(args.mime ?? "application/octet-stream") });
    if (error) { await call("sop_attach_delete", { id: meta.id }); throw new Error(error.message); }
    return json({ id: meta.id });
  }
  if (op === "sop_attach_url") {
    const meta = await call("sop_attach_get", { id: args.id });
    const { data, error } = await sopStorage().createSignedUrl(String(meta.storage_path), 120, { download: String(meta.file_name) });
    if (error) throw new Error(error.message);
    return json({ url: data.signedUrl });
  }
  return json(await call(op, args));
}));
