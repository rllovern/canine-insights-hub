import { describe, expect, it } from "vitest";
import { summarize, effectiveStatus } from "../readiness";
import { matchImport, buildActions, parseAsanaCsv, parseAsanaJson } from "../importMatch";
import { buildTree, diffVersions, type SopNode } from "../sopTree";

const N = (p: Partial<SopNode> & { id: string; title: string }): SopNode => ({
  parent_id: null, stable_key: p.id, kind: "task", body_md: null, sort: 0, area: null, is_critical: false, ...p,
});

const tree: SopNode[] = [
  N({ id: "s1", title: "Google Ads configuration", kind: "section", area: "google_ads" }),
  ...Array.from({ length: 19 }, (_, i) => N({ id: `t${i}`, parent_id: "s1", title: `Task ${i}` })),
  N({ id: "crit", parent_id: "s1", title: "Conversions", is_critical: true }),
];

describe("readiness", () => {
  it("95% complete with one critical open is NOT launch-ready", () => {
    const statuses = Object.fromEntries(Array.from({ length: 19 }, (_, i) => [`t${i}`, { status: "verified" as const }]));
    const s = summarize(tree, { statuses: { ...statuses, crit: { status: "in_progress" } }, auto: {}, answers: null });
    expect(s.completion).toBeCloseTo(0.95);
    expect(s.readiness).toBe("not_ready");
    expect(s.blockers.map((b) => b.node.id)).toEqual(["crit"]);
  });
  it("unknown never counts as complete", () => {
    const s = summarize(tree, { statuses: { t0: { status: "unknown" } }, auto: {}, answers: null });
    expect(s.verified).toBe(0);
    expect(s.byArea.google_ads.unknown).toBe(1);
  });
  it("all critical verified, nothing blocked => launch-ready; blocked non-critical => at risk", () => {
    const ok = summarize(tree, { statuses: { crit: { status: "verified" } }, auto: {}, answers: null });
    expect(ok.readiness).toBe("launch_ready");
    const risk = summarize(tree, { statuses: { crit: { status: "verified" }, t1: { status: "blocked" } }, auto: {}, answers: null });
    expect(risk.readiness).toBe("at_risk");
  });
  it("legacy client with nothing tracked is not assessed", () => {
    expect(summarize(tree, { statuses: {}, auto: {}, answers: null, classification: "legacy" }).readiness).toBe("not_assessed");
  });
  it("applicability rule marks N/A only when answers say so; manual wins", () => {
    const n = N({ id: "f", title: "Forms", applicability_rule: { key: "booking_method", op: "includes", value: "Web form then callback" } });
    expect(effectiveStatus(n, { statuses: {}, auto: {}, answers: { booking_method: ["Phone"] } }).status).toBe("not_applicable");
    expect(effectiveStatus(n, { statuses: {}, auto: {}, answers: null }).status).toBe("not_started");
    expect(effectiveStatus(n, { statuses: { f: { status: "blocked" } }, auto: {}, answers: { booking_method: ["Phone"] } }).status).toBe("blocked");
  });
  it("sections do not count", () => {
    expect(summarize(tree, { statuses: {}, auto: {}, answers: null }).applicable).toBe(20);
  });
});

describe("import matching", () => {
  const nodes: SopNode[] = [
    N({ id: "a", title: "Access", kind: "section" }),
    N({ id: "b", title: "Billing", kind: "section" }),
    N({ id: "a1", parent_id: "a", title: "Testing", body_md: "Existing steps" }),
    N({ id: "b1", parent_id: "b", title: "Testing" }),
    N({ id: "a2", parent_id: "a", title: "Linked", asana_gid: "999" }),
  ];
  const row = (ref: string, path: string[], title: string, body = "", gid: string | null = null) => ({ ref, path, title, body, asana_gid: gid });

  it("same name in two sections matches by full path, not name", () => {
    const r = matchImport([row("1", ["Billing"], "Testing", "New billing steps")], nodes)[0];
    expect(r.kind).toBe("updated"); expect(r.node?.id).toBe("b1"); expect(r.overwrites).toBe(false); expect(r.accept).toBe(true);
  });
  it("never silently overwrites existing text", () => {
    const r = matchImport([row("1", ["Access"], "Testing", "Different")], nodes)[0];
    expect(r.kind).toBe("updated"); expect(r.overwrites).toBe(true); expect(r.accept).toBe(false);
    expect(buildActions([r])).toEqual([]);
  });
  it("stable Asana ID wins over a renamed title", () => {
    const r = matchImport([row("1", ["Access"], "Renamed", "", "999")], nodes)[0];
    expect(r.node?.id).toBe("a2"); expect(r.kind).toBe("unchanged");
  });
  it("same title elsewhere is ambiguous; duplicate paths in the file are ambiguous", () => {
    expect(matchImport([row("1", ["Launch"], "Testing")], nodes).find((x) => x.row.ref === "1")?.kind).toBe("ambiguous");
    const dup = matchImport([row("1", ["Access"], "New"), row("2", ["Access"], "New")], nodes);
    expect(dup.every((d) => d.kind === "ambiguous")).toBe(true);
  });
  it("re-import with identical content is all unchanged and creates nothing", () => {
    const r = matchImport([row("1", [], "Access"), row("2", ["Access"], "Testing", "Existing steps")], nodes);
    expect(r.map((x) => x.kind)).toEqual(["unchanged", "unchanged"]);
    expect(buildActions(r)).toEqual([]);
  });
  it("new nested rows create parents before children", () => {
    const r = matchImport([row("s", [], "Launch"), row("t", ["Launch"], "Kickoff"), row("u", ["Launch", "Kickoff"], "Agenda")], nodes);
    const acts = buildActions(r);
    expect(acts.map((a) => a.ref)).toEqual(["s", "t", "u"]);
    expect(acts[1].parent_ref).toBe("s"); expect(acts[2].parent_ref).toBe("t");
  });
  it("children of a skipped parent are not re-homed", () => {
    const r = matchImport([row("s", [], "Launch"), row("t", ["Launch"], "Kickoff")], nodes);
    r[0].accept = false;
    expect(buildActions(r)).toEqual([]);
  });
});

describe("parsers", () => {
  it("parses Asana CSV with sections, parents and quoted notes", () => {
    const csv = 'Task ID,Name,Section/Column,Notes,Parent task\n1,Setup,Config,"Step 1\nStep ""2""",\n2,Child,Config,Do it,Setup\n';
    const rows = parseAsanaCsv(csv);
    expect(rows.map((r) => [r.path.join("/"), r.title])).toEqual([["", "Config"], ["Config", "Setup"], ["Config/Setup", "Child"]]);
    expect(rows[1].body).toBe('Step 1\nStep "2"');
  });
  it("parses Asana JSON with nested subtasks", () => {
    const rows = parseAsanaJson(JSON.stringify({ data: [{ gid: "1", name: "A", notes: "x", memberships: [{ section: { name: "S" } }], subtasks: [{ gid: "2", name: "B", notes: "y" }] }] }));
    expect(rows.map((r) => [r.path.join("/"), r.title, r.asana_gid])).toEqual([["", "S", null], ["S", "A", "1"], ["S/A", "B", "2"]]);
  });
});

describe("tree + versions", () => {
  it("builds nested tree sorted", () => {
    const t = buildTree([N({ id: "x", title: "X", kind: "section" }), N({ id: "y", parent_id: "x", title: "Y", sort: 2 }), N({ id: "z", parent_id: "x", title: "Z", sort: 1 })]);
    expect(t[0].children.map((c) => c.node.id)).toEqual(["z", "y"]);
  });
  it("diffs versions by stable key", () => {
    const d = diffVersions([N({ id: "1", title: "A" }), N({ id: "2", title: "B" })], [N({ id: "1", title: "A2" }), N({ id: "3", title: "C" })]);
    expect([d.added.length, d.removed.length, d.changed.length]).toEqual([1, 1, 1]);
  });
});
