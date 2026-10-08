// Pure helpers for the nested SOP tree. No UI, no network.

export type SopKind = "section" | "task" | "subtask";
export type SopArea = "discovery" | "access" | "google_ads" | "call_tracking" | "website" | "launch";

export interface ApplicabilityRule {
  key: string;
  op: "equals" | "not_equals" | "includes" | "not_includes";
  value: string;
}

export interface SopNode {
  id: string;
  parent_id: string | null;
  stable_key: string;
  asana_gid?: string | null;
  kind: SopKind;
  title: string;
  body_md: string | null;
  sort: number;
  area: SopArea | null;
  is_critical: boolean;
  legacy_req_key?: string | null;
  applicability_rule?: ApplicabilityRule | null;
  verification?: string;
}

export interface TreeNode {
  node: SopNode;
  children: TreeNode[];
  depth: number;
}

const bySort = (a: SopNode, b: SopNode) => a.sort - b.sort || a.title.localeCompare(b.title);

export function buildTree(nodes: SopNode[]): TreeNode[] {
  const kids = new Map<string | null, SopNode[]>();
  const ids = new Set(nodes.map((n) => n.id));
  for (const n of nodes) {
    const p = n.parent_id && ids.has(n.parent_id) ? n.parent_id : null;
    const list = kids.get(p) ?? [];
    list.push(n);
    kids.set(p, list);
  }
  const walk = (parent: string | null, depth: number): TreeNode[] =>
    (kids.get(parent) ?? []).sort(bySort).map((node) => ({ node, depth, children: walk(node.id, depth + 1) }));
  return walk(null, 0);
}

export function flattenTree(tree: TreeNode[]): TreeNode[] {
  const out: TreeNode[] = [];
  const rec = (t: TreeNode[]) => t.forEach((x) => { out.push(x); rec(x.children); });
  rec(tree);
  return out;
}

/** Area of a node, inherited from the nearest ancestor that has one. */
export function areaOf(node: SopNode, byId: Map<string, SopNode>): SopArea | null {
  let cur: SopNode | undefined = node;
  while (cur) {
    if (cur.area) return cur.area;
    cur = cur.parent_id ? byId.get(cur.parent_id) : undefined;
  }
  return null;
}

/** Titles from the root down to (and including) the node. */
export function pathOf(node: SopNode, byId: Map<string, SopNode>): string[] {
  const out: string[] = [];
  let cur: SopNode | undefined = node;
  const seen = new Set<string>();
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    out.unshift(cur.title);
    cur = cur.parent_id ? byId.get(cur.parent_id) : undefined;
  }
  return out;
}

export const isMissingDescription = (n: SopNode) => n.kind !== "section" && !(n.body_md ?? "").trim();

/** Compare two versions of a template by stable key. */
export function diffVersions(from: SopNode[], to: SopNode[]) {
  const a = new Map(from.map((n) => [n.stable_key, n]));
  const b = new Map(to.map((n) => [n.stable_key, n]));
  const added = to.filter((n) => !a.has(n.stable_key));
  const removed = from.filter((n) => !b.has(n.stable_key));
  const changed = to.filter((n) => {
    const o = a.get(n.stable_key);
    return o && (o.title !== n.title || (o.body_md ?? "") !== (n.body_md ?? "") || o.is_critical !== n.is_critical);
  });
  return { added, removed, changed };
}
