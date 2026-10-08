// Asana import: parse exports and match them safely against a draft template. Pure, unit-tested.
import { pathOf, type SopNode } from "./sopTree";

export interface ImportRow {
  ref: string;
  asana_gid: string | null;
  path: string[]; // ancestor titles (section first), excluding own title
  title: string;
  body: string;
}

export type MatchKind = "new" | "updated" | "unchanged" | "ambiguous";

export interface MatchResult {
  row: ImportRow;
  kind: MatchKind;
  node?: SopNode;          // matched node (updated/unchanged)
  candidates?: SopNode[];  // ambiguous options
  reason?: string;
  overwrites?: boolean;    // update would replace a non-empty existing description
  needsLink?: boolean;     // matched by path; store the Asana ID for next time
  accept: boolean;         // default selection (never true when overwriting existing text)
  parentRef?: string;      // for new rows whose parent is another new row
  parentId?: string | null;
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
const keyOf = (parts: string[]) => parts.map(norm).join(" › ");
const normBody = (s: string | null | undefined) => (s ?? "").replace(/\r\n/g, "\n").trim();

// ---------- parsing ----------

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim()));
}

interface RawTask { gid: string | null; name: string; notes: string; section: string; parentGid: string | null; parentName: string | null }

function toRows(raw: RawTask[]): ImportRow[] {
  const byGid = new Map(raw.filter((r) => r.gid).map((r) => [r.gid!, r]));
  const parentOf = (r: RawTask): RawTask | undefined => {
    if (r.parentGid && byGid.has(r.parentGid)) return byGid.get(r.parentGid);
    if (r.parentName) {
      const same = raw.filter((x) => x !== r && norm(x.name) === norm(r.parentName!));
      return same.find((x) => x.section === r.section) ?? (same.length === 1 ? same[0] : undefined);
    }
    return undefined;
  };
  const tasks: ImportRow[] = raw.map((r, i) => {
    const chain: string[] = [];
    let p = parentOf(r); const seen = new Set<RawTask>([r]);
    let root: RawTask = r;
    while (p && !seen.has(p)) { seen.add(p); chain.unshift(p.name); root = p; p = parentOf(p); }
    const section = root.section || r.section || "Imported";
    return { ref: `r${i}`, asana_gid: r.gid, path: [section, ...chain], title: r.name, body: r.notes };
  });
  // Synthesize section rows so sections are matched/created explicitly.
  const sections = [...new Set(tasks.map((t) => t.path[0]))];
  return [...sections.map((s, i) => ({ ref: `s${i}`, asana_gid: null, path: [], title: s, body: "" })), ...tasks];
}

export function parseAsanaCsv(text: string): ImportRow[] {
  const [head, ...rows] = parseCsv(text);
  if (!head) return [];
  const idx = (...names: string[]) => head.findIndex((h) => names.some((n) => norm(h) === norm(n)));
  const iId = idx("Task ID", "gid"), iName = idx("Name", "Task Name"), iSec = idx("Section/Column", "Section"),
    iNotes = idx("Notes", "Description"), iPar = idx("Parent task", "Parent Task", "Parent"), iParId = idx("Parent task ID", "Parent Task ID");
  if (iName < 0) throw new Error("This file has no Name column — export the project from Asana as CSV.");
  return toRows(rows.filter((r) => (r[iName] ?? "").trim()).map((r) => ({
    gid: iId >= 0 ? (r[iId] || null) : null,
    name: r[iName].trim(),
    notes: iNotes >= 0 ? r[iNotes] ?? "" : "",
    section: iSec >= 0 ? (r[iSec] ?? "").trim() : "",
    parentGid: iParId >= 0 ? (r[iParId] || null) : null,
    parentName: iPar >= 0 ? ((r[iPar] ?? "").trim() || null) : null,
  })));
}

export function parseAsanaJson(text: string): ImportRow[] {
  const data = JSON.parse(text);
  const list: any[] = Array.isArray(data) ? data : data.data ?? [];
  const raw: RawTask[] = [];
  const visit = (t: any, section: string, parentGid: string | null) => {
    const sec = t.memberships?.[0]?.section?.name ?? section ?? "";
    raw.push({ gid: t.gid ? String(t.gid) : null, name: String(t.name ?? "").trim(), notes: String(t.notes ?? ""), section: sec,
      parentGid: t.parent?.gid ? String(t.parent.gid) : parentGid, parentName: t.parent?.name ?? null });
    for (const s of t.subtasks ?? []) visit(s, sec, t.gid ? String(t.gid) : null);
  };
  list.forEach((t) => visit(t, "", null));
  return toRows(raw.filter((r) => r.name));
}

// ---------- matching ----------

export function matchImport(rows: ImportRow[], nodes: SopNode[]): MatchResult[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const nodePath = new Map(nodes.map((n) => [n.id, keyOf(pathOf(n, byId))]));
  const byGid = new Map(nodes.filter((n) => n.asana_gid).map((n) => [n.asana_gid!, n]));
  const rowKeyCount = new Map<string, number>();
  for (const r of rows) { const k = keyOf([...r.path, r.title]); rowKeyCount.set(k, (rowKeyCount.get(k) ?? 0) + 1); }

  const results: MatchResult[] = rows.map((row) => {
    const key = keyOf([...row.path, row.title]);
    let node: SopNode | undefined;
    if (row.asana_gid && byGid.has(row.asana_gid)) node = byGid.get(row.asana_gid);
    else {
      if ((rowKeyCount.get(key) ?? 0) > 1) {
        return { row, kind: "ambiguous", reason: "The file has more than one task with this exact path", candidates: nodes.filter((n) => nodePath.get(n.id) === key), accept: false };
      }
      const exact = nodes.filter((n) => nodePath.get(n.id) === key && !(n.asana_gid && row.asana_gid && n.asana_gid !== row.asana_gid));
      if (exact.length > 1) return { row, kind: "ambiguous", reason: "Several existing tasks share this path", candidates: exact, accept: false };
      if (exact.length === 1) node = exact[0];
      else {
        const sameTitle = nodes.filter((n) => norm(n.title) === norm(row.title) && !(n.asana_gid && row.asana_gid));
        if (sameTitle.length) return { row, kind: "ambiguous", reason: "A task with this name exists elsewhere — moved or renamed?", candidates: sameTitle, accept: false };
        return { row, kind: "new", accept: true };
      }
    }
    const incoming = normBody(row.body), existing = normBody(node!.body_md);
    const needsLink = !!row.asana_gid && !node!.asana_gid;
    if (!incoming || incoming === existing) return { row, kind: "unchanged", node, needsLink, accept: needsLink };
    const overwrites = existing.length > 0;
    return { row, kind: "updated", node, overwrites, needsLink, accept: !overwrites };
  });

  // Resolve parents for new rows.
  const resolvedByKey = new Map<string, { id?: string; ref?: string; ok: boolean }>();
  results.forEach((r) => {
    const k = keyOf([...r.row.path, r.row.title]);
    if (r.node) resolvedByKey.set(k, { id: r.node.id, ok: true });
    else if (r.kind === "new") resolvedByKey.set(k, { ref: r.row.ref, ok: true });
    else resolvedByKey.set(k, { ok: false });
  });
  for (const r of results) {
    if (r.kind !== "new" || r.row.path.length === 0) { if (r.kind === "new") r.parentId = null; continue; }
    const p = resolvedByKey.get(keyOf(r.row.path));
    if (!p || !p.ok) { r.kind = "ambiguous"; r.reason = "Its parent could not be matched safely"; r.accept = false; r.candidates = []; continue; }
    if (p.id) r.parentId = p.id; else r.parentRef = p.ref;
  }
  return results;
}

export interface ImportAction { action: "create" | "update" | "link"; ref?: string; parent_id?: string | null; parent_ref?: string; node_id?: string; title?: string; body_md?: string; asana_gid?: string | null }

/** Build server actions from the user's choices. Ambiguous rows are only applied with an explicit resolution. */
export function buildActions(results: MatchResult[], resolutions: Record<string, { mode: "skip" | "new" | "match"; nodeId?: string; parentId?: string | null }> = {}): ImportAction[] {
  const creates: ImportAction[] = [], others: ImportAction[] = [];
  for (const r of results) {
    if (r.kind === "ambiguous") {
      const res = resolutions[r.row.ref];
      if (!res || res.mode === "skip") continue;
      if (res.mode === "match" && res.nodeId) {
        others.push({ action: "update", node_id: res.nodeId, ...(r.row.body.trim() ? { body_md: r.row.body } : {}), asana_gid: r.row.asana_gid });
      } else if (res.mode === "new") {
        creates.push({ action: "create", ref: r.row.ref, parent_id: res.parentId ?? null, title: r.row.title, body_md: r.row.body, asana_gid: r.row.asana_gid });
      }
      continue;
    }
    if (!r.accept) continue;
    if (r.kind === "new") creates.push({ action: "create", ref: r.row.ref, parent_id: r.parentId ?? null, parent_ref: r.parentRef, title: r.row.title, body_md: r.row.body, asana_gid: r.row.asana_gid });
    else if (r.kind === "updated" && r.node) others.push({ action: "update", node_id: r.node.id, body_md: r.row.body, asana_gid: r.row.asana_gid });
    else if (r.kind === "unchanged" && r.node && r.needsLink) others.push({ action: "link", node_id: r.node.id, asana_gid: r.row.asana_gid });
  }
  // Parents before children: order creates so referenced refs come first.
  const ordered: ImportAction[] = []; const done = new Set<string>(); let guard = 0;
  while (ordered.length < creates.length && guard++ < creates.length + 5) {
    for (const c of creates) if (!done.has(c.ref!) && (!c.parent_ref || done.has(c.parent_ref) || !creates.some((x) => x.ref === c.parent_ref))) {
      if (c.parent_ref && !creates.some((x) => x.ref === c.parent_ref)) { c.parent_ref = undefined; }
      ordered.push(c); done.add(c.ref!);
    }
  }
  return [...ordered, ...others];
}
