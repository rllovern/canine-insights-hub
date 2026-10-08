# Marketing Ops: Nested SOP Workspace + Visual Command Center

One coordinated update to the existing private Marketing Ops module. No changes to Bob, reporting, Google Ads/CTM/GHL syncs, or the PHP form integration. Everything stays behind the existing explicit-grant guard.

## What you will get

1. **Master templates (editable in the app)** — Google Ads and CallTrackingMetrics templates organized as Sections > Tasks > Subtasks (any depth). Add, delete, rename, drag to reorder, indent/outdent to nest, edit full descriptions — no code changes needed.
2. **Full SOP descriptions** — Markdown editor with preview: numbered steps, links, examples, code blocks, and image/file attachments in private storage reachable only through the guarded endpoint.
3. **Asana-style workspace per client** — expandable list; each row has its own status; clicking opens a side panel (full-screen sheet on mobile) with the full procedure, client notes, verification evidence and status history. Client data never changes the master template.
4. **Safe Asana import** — upload an Asana export (CSV or JSON). Matching uses the stable Asana task ID when present, otherwise the full path (Section > Task > Subtask) with collision detection. A preview labels every record New, Updated, Unchanged or Ambiguous; ambiguous rows need your choice and changed descriptions show before/after. Nothing is overwritten without your confirmation.
5. **Template versioning** — edits go into a draft; publishing creates a new approved version. Old versions and their instructions are kept. New clients start on the latest approved version; existing clients stay on theirs, and their history stays tied to it, until you click "Apply update", which previews changes and carries matching statuses and notes forward.
6. **Visual Command Center**
   - Client directory: one compact row per client — lifecycle stage, readiness badge, completion %, six area dots, blocker count; sortable by "needs attention".
   - Client overview: six areas — Business Discovery, Access & Assets, Google Ads, Call Tracking, Website & Forms, Launch Readiness — each with icon, concise progress and blocker count. Clicking one opens that area's nested workspace.
   - Distinct statuses: Verified (solid check), In progress, Awaiting access, Blocked (elevated), Unknown (dashed "?"), Not applicable (muted). Healthy areas stay calm.

## Honest progress

- Three separate measures: **Completion %** (verified applicable tasks / applicable tasks), **Launch readiness** (Not ready / At risk / Launch-ready), and **Blockers** (count and list).
- Tasks can be marked critical (tracking, billing, configuration dependencies). Any unresolved critical task — blocked, unknown, awaiting access, or unverified — prevents Launch-ready regardless of completion %.
- Unknown and unverified items are never drawn as complete.
- Your original Asana descriptions are not in the project (the earlier brief only names the areas). Those tasks are created as titles marked **"Description missing — needs import"**, with a running count. No invented instructions.

## Preserving existing progress

- Every current requirement maps to a template task (same key); each client's status, notes and decisions carry over unchanged and are pinned to version 1. Nothing becomes verified that wasn't already.
- Questionnaire rules (applicability, awaiting access, web-form N/A, decision log, questionnaire gate) and automatic verification keep working on the mapped tasks.

## Design flexibility

- Logic (readiness, completion, versioning, import matching) lives in plain functions and the backend, separate from screens.
- Screens are built from small reusable pieces (status pill, area card, progress meter, task tree, detail panel) styled only through design tokens, so a bolder design can replace the look later without touching functionality.

## Testing

- Migration/status preservation: every client's status, note and decision identical before and after.
- Template editing: create, edit, delete, reorder, nest, attach; master unchanged by client edits.
- Versioning: publish v2; existing client stays on v1; new client gets v2; Apply update preserves statuses.
- Import: same name in two sections, renamed task, changed description, missing IDs, re-import with no changes.
- Readiness: 95% complete with one critical blocker shows Not ready; Unknown never counts.
- Permissions: Admin, Location Owner, signed-out and Bob refused for templates, tasks, notes, attachments; automated denial suite extended.
- Desktop and mobile screenshots of directory, overview, workspace and detail panel.
- Final report: changes, test results, screenshots, tasks still missing descriptions.

## Technical details

- New private tables in `mops`: `sop_templates`, `sop_template_versions` (draft/approved, published_at), `sop_nodes` (version_id, parent_id, stable_key, asana_gid, path, kind, title, body_md, sort, area, is_critical, legacy_req_key, applicability_rule jsonb, verification), `client_sop_status` (property_id, version_id, node stable_key, status, evidence, note), `sop_status_history`, `sop_attachments`, `sop_import_batches`. `client_lifecycle` gains the pinned template version. Same REVOKE model; no browser grants.
- Additive migration: seed v1 from `requirement_catalog`, backfill statuses from `client_requirements`; old tables kept and marked deprecated. `generate_requirements` updated to write node statuses.
- New allowlisted `mops-api` operations: template/version CRUD, publish, apply update, reorder/move, client status/note, import preview/commit, attachment signed URLs; all audited.
- Private storage bucket with no public policies; short-lived signed URLs issued by the guarded function only.
- Frontend: `src/lib/mops/readiness.ts`, `sopTree.ts`, `importMatch.ts` (pure, unit-tested); `src/components/ops/` presentational pieces; pages rebuilt under `src/pages/ops/` plus `/ops/templates`. Ops tokens added to `index.css`.
