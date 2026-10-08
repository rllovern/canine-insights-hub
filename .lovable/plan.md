# Marketing Ops: Nested SOP Workspace + Visual Command Center

One coordinated update to the existing private Marketing Ops module. No changes to Bob, reporting, Google Ads/CTM/GHL syncs, or the PHP form integration. Everything stays behind the existing explicit-grant guard.

## What you will get

1. **Master templates (editable in the app)** — a Google Ads template and a CallTrackingMetrics template, organized as Sections → Tasks → Subtasks (any depth). Add, delete, rename, drag to reorder, indent/outdent to nest, and edit full descriptions — no code changes needed.
2. **Full SOP descriptions** — Markdown editor with preview: numbered steps, links, examples, code blocks, and image/file attachments stored in a private storage area only reachable through the guarded endpoint.
3. **Asana-style workspace per client** — expandable list view; each row has its own status pill; clicking opens a side panel (full-screen sheet on mobile) with the full procedure, client-specific notes, verification evidence, and status history. Client data never changes the master template.
4. **Asana import** — upload an Asana export (CSV or JSON) for a project; sections, tasks, subtasks and descriptions are imported into a template, with a preview before saving. Re-imports match by name so nothing is duplicated.
5. **Visual Command Center**
   - Client directory: one compact row/tile per client with lifecycle stage, readiness ring, six area dots, and a blocker count; sortable by "needs attention".
   - Client overview: six area cards — Business Discovery, Access & Assets, Google Ads, Call Tracking, Website & Forms, Launch Readiness — each with platform icon, real progress (verified / applicable only), and top blocker. Clicking a card opens that area's nested workspace.
   - Distinct status treatments: Verified (solid green check), In progress (blue half ring), Awaiting access (amber key), Blocked (red, elevated), Unknown (dashed grey "?"), Not applicable (muted strike). Unverified items never look complete; healthy areas stay calm.

## Honesty rules

- Your original Asana descriptions are **not** in the project: the earlier brief only names the SOP areas (e.g. agency negative keywords, position/bidding rule, client kickoff). Those tasks will be created as titles marked **"Description missing — needs import"**, with a counter showing how many remain. No invented instructions.
- Readiness percentages are computed only from real statuses of applicable tasks; Unknown counts as not done.

## Preserving existing progress

- Every current requirement is mapped to a template task (same key) under its matching section; each client's current status, notes, and decisions carry over unchanged. Nothing is marked verified that wasn't already.
- The questionnaire-driven rules (applicability, awaiting access, not applicable for web forms, decision log) and the questionnaire gate continue to apply; they now act on the mapped tasks. New tasks you add can optionally be linked to a questionnaire answer for automatic applicability.
- Automatic verification signals (e.g. CTM calls arriving, Ads spend) keep working on the tasks they drive today.

## Testing

- Create/edit/delete/reorder/nest template tasks; edit descriptions; attach a file.
- Assign client statuses and notes; confirm the master template is unchanged.
- Confirm every existing client status is identical before and after.
- Questionnaire re-run still sets applicability correctly.
- Access tests: Admin, Location Owner, signed-out, and Bob all refused for templates, tasks, notes and attachments; extend the automated denial suite.
- Desktop and mobile screenshots of directory, overview, workspace, and side panel.
- Final report lists changes, tests, and the tasks still missing descriptions.

## Technical details

- New private tables in `mops`: `sop_templates`, `sop_nodes` (template_id, parent_id, kind section/task/subtask, title, body_md, sort, area, legacy_req_key, applicability_rule jsonb, verification), `client_sop_status` (property_id, node_id, status, severity, evidence, note, updated_by), `sop_attachments`, `sop_status_history`. Same REVOKE model as other mops tables; no browser grants.
- Additive migration: seed templates, insert nodes from `requirement_catalog` (legacy_req_key), backfill `client_sop_status` from `client_requirements`. Old tables kept and marked deprecated, not dropped; `generate_requirements` updated to write node statuses.
- New `mops-api` operations added to the allowlist and the dispatcher (template CRUD, reorder/move, client status/note, import, attachment signed URLs); all audited.
- Private storage bucket with no public policies; files served via short-lived signed URLs issued by the guarded function only.
- Frontend: `src/pages/ops/` rebuilt — directory, overview cards, `SopWorkspace` (tree with dnd-kit reorder), `SopDetailPanel` (Sheet), template editor at `/ops/templates`. Tokens added to `index.css`, matching the existing dashboard palette and fonts.
