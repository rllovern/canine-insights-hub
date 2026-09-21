import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./AuthContext";
import { usePreviewMode } from "./PreviewModeContext";
import { useProperties } from "./PropertyContext";
import type { AppRole } from "@/lib/types";

export const NOTICE_SOURCE_LABELS: Record<string, string> = {
  google_ads: "Google Ads",
  ctm: "Call tracking",
  ghl: "CRM",
};

export type Severity = "info" | "warning" | "critical";

export interface Announcement {
  id: string;
  title: string;
  body: string;
  severity: Severity;
  audience: "all" | "roles" | "properties";
  audience_roles: AppRole[] | null;
  audience_property_ids: string[] | null;
  frequency: "once" | "every_login";
  starts_at: string;
  ends_at: string | null;
  active: boolean;
}

export interface MaintenanceRow {
  active: boolean;
  scheduled_start: string | null;
  scheduled_end: string | null;
  expected_back_at: string | null;
  message: string;
}

export interface IncidentRow {
  id: string;
  source: string;
  opened_at: string;
  resolved_at: string | null;
  affected_property_ids: string[];
  acknowledged_at: string | null;
  owner_notice: "auto" | "show" | "hide" | "maintenance";
}

export interface NoticeSettings {
  auto_notice_after_hours: number;
  notice_title: string;
  notice_body: string;
}

export interface DelayNotice {
  incidentId: string;
  title: string;
  body: string;
}

export function eastern(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }) + " ET";
}

export function maintenanceInEffect(m: MaintenanceRow | null): boolean {
  if (!m) return false;
  if (m.active) return true;
  if (m.scheduled_start && m.scheduled_end) {
    const now = Date.now();
    return now >= new Date(m.scheduled_start).getTime() && now <= new Date(m.scheduled_end).getTime();
  }
  return false;
}

/** Renders a notice template against one incident's facts. */
export function renderNotice(
  settings: NoticeSettings,
  source: string,
  locations: string[],
  since: string | null,
): { title: string; body: string } {
  const fill = (s: string) =>
    s
      .replace(/\{source\}/g, NOTICE_SOURCE_LABELS[source] ?? source)
      .replace(/\{location\}/g, locations.join(", ") || "your location")
      .replace(/\{locations\}/g, locations.join(", ") || "your location")
      .replace(/\{since\}/g, eastern(since));
  return { title: fill(settings.notice_title), body: fill(settings.notice_body) };
}

export const DEFAULT_NOTICE_SETTINGS: NoticeSettings = {
  auto_notice_after_hours: 12,
  notice_title: "Some data is delayed",
  notice_body:
    "{source} data for {location} has not updated since {since}. Figures on this dashboard may be incomplete until it catches up. The issue has been flagged and is being looked into.",
};

interface NoticeContextValue {
  loading: boolean;
  maintenance: MaintenanceRow | null;
  /** Maintenance window is running (regardless of who is looking). */
  maintenanceOn: boolean;
  /** This viewer must be shown the full-screen maintenance page. */
  blockedByMaintenance: boolean;
  delayNotices: DelayNotice[];
  settings: NoticeSettings;
  currentAnnouncement: Announcement | null;
  dismissAnnouncement: (a: Announcement) => Promise<void>;
  /** True when nothing higher in the display order is occupying the screen. */
  modalsAllowed: boolean;
  reload: () => Promise<void>;
}

/**
 * Safe fallback so a consumer rendered outside the provider (or during a hot
 * reload that swaps the context identity) degrades to "no notices" instead of
 * blanking the app.
 */
const FALLBACK: NoticeContextValue = {
  loading: true,
  maintenance: null,
  maintenanceOn: false,
  blockedByMaintenance: false,
  delayNotices: [],
  settings: DEFAULT_NOTICE_SETTINGS,
  currentAnnouncement: null,
  dismissAnnouncement: async () => {},
  modalsAllowed: false,
  reload: async () => {},
};

const Ctx = createContext<NoticeContextValue>(FALLBACK);

export function useNotices() {
  return useContext(Ctx);
}

const sessionKey = (id: string) => `announcementSeen:${id}`;

export function NoticeProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { effectiveRole } = usePreviewMode();
  const { properties } = useProperties();

  const [loading, setLoading] = useState(true);
  const [maintenance, setMaintenance] = useState<MaintenanceRow | null>(null);
  const [incidents, setIncidents] = useState<IncidentRow[]>([]);
  const [settings, setSettings] = useState<NoticeSettings>(DEFAULT_NOTICE_SETTINGS);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());
  const [sessionDismissed, setSessionDismissed] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    // Maintenance is readable by everyone, including anonymous report viewers.
    const { data: m } = await supabase.from("maintenance_mode").select("*").eq("id", 1).maybeSingle();
    setMaintenance((m as MaintenanceRow) ?? null);

    if (!user) {
      setIncidents([]);
      setAnnouncements([]);
      setDismissedIds(new Set());
      setLoading(false);
      return;
    }

    const [{ data: inc }, { data: st }, { data: ann }, { data: dis }] = await Promise.all([
      supabase.from("data_source_incidents").select("*").is("resolved_at", null),
      supabase.from("incident_notice_settings").select("*").eq("id", 1).maybeSingle(),
      supabase.from("site_announcements").select("*").eq("active", true),
      supabase.from("announcement_dismissals").select("announcement_id").eq("user_id", user.id),
    ]);

    setIncidents((inc as IncidentRow[]) ?? []);
    if (st) setSettings(st as NoticeSettings);
    setAnnouncements((ann as Announcement[]) ?? []);
    setDismissedIds(new Set(((dis as { announcement_id: string }[]) ?? []).map((d) => d.announcement_id)));
    setLoading(false);
  }, [user]);

  useEffect(() => { void load(); }, [load]);

  const isStaffViewer = effectiveRole === "super_admin" || effectiveRole === "admin";
  const myPropertyIds = useMemo(() => properties.map((p) => p.id), [properties]);
  const nameOf = useCallback(
    (id: string) => properties.find((p) => p.id === id)?.name ?? "your location",
    [properties],
  );

  const maintenanceOn = maintenanceInEffect(maintenance);

  // Incidents that touch at least one location this viewer can reach.
  const myIncidents = useMemo(
    () =>
      incidents
        .map((i) => ({
          incident: i,
          mine: (i.affected_property_ids ?? []).filter((pid) => myPropertyIds.includes(pid)),
        }))
        .filter((x) => x.mine.length > 0),
    [incidents, myPropertyIds],
  );

  // owner_notice = maintenance and every location this viewer has is affected.
  const incidentLockout = useMemo(() => {
    if (isStaffViewer || myPropertyIds.length === 0) return false;
    return myIncidents.some(
      (x) => x.incident.owner_notice === "maintenance" && x.mine.length === myPropertyIds.length,
    );
  }, [isStaffViewer, myIncidents, myPropertyIds.length]);

  const delayNotices = useMemo<DelayNotice[]>(() => {
    if (isStaffViewer) return [];
    const out: DelayNotice[] = [];
    for (const { incident, mine } of myIncidents) {
      const mode = incident.owner_notice;
      if (mode === "hide") continue;
      if (mode === "auto") {
        if (incident.acknowledged_at) continue;
        const openHours = (Date.now() - new Date(incident.opened_at).getTime()) / 3_600_000;
        if (openHours < settings.auto_notice_after_hours) continue;
      }
      if (mode === "maintenance" && mine.length === myPropertyIds.length) continue; // full page instead
      const { title, body } = renderNotice(settings, incident.source, mine.map(nameOf), incident.opened_at);
      out.push({ incidentId: incident.id, title, body });
    }
    return out;
  }, [isStaffViewer, myIncidents, settings, myPropertyIds.length, nameOf]);

  const blockedByMaintenance = (maintenanceOn && !isStaffViewer) || incidentLockout;

  const currentAnnouncement = useMemo<Announcement | null>(() => {
    if (blockedByMaintenance || !user) return null;
    const now = Date.now();
    const rank: Record<Severity, number> = { critical: 0, warning: 1, info: 2 };
    const applicable = announcements
      .filter((a) => a.active)
      .filter((a) => new Date(a.starts_at).getTime() <= now)
      .filter((a) => !a.ends_at || new Date(a.ends_at).getTime() >= now)
      .filter((a) => {
        if (a.audience === "all") return true;
        if (a.audience === "roles") return !!effectiveRole && (a.audience_roles ?? []).includes(effectiveRole);
        return (a.audience_property_ids ?? []).some((pid) => myPropertyIds.includes(pid));
      })
      .filter((a) => {
        if (sessionDismissed.has(a.id)) return false;
        if (a.frequency === "once") return !dismissedIds.has(a.id);
        // every_login: hidden only for the rest of this browser session
        try { return sessionStorage.getItem(sessionKey(a.id)) !== "1"; } catch { return true; }
      })
      .sort((a, b) => rank[a.severity] - rank[b.severity] || a.starts_at.localeCompare(b.starts_at));
    return applicable[0] ?? null;
  }, [announcements, blockedByMaintenance, user, effectiveRole, myPropertyIds, dismissedIds, sessionDismissed]);

  const dismissAnnouncement = useCallback(
    async (a: Announcement) => {
      setSessionDismissed((s) => new Set(s).add(a.id));
      try { sessionStorage.setItem(sessionKey(a.id), "1"); } catch { /* storage disabled */ }
      if (a.frequency === "once" && user) {
        await supabase.from("announcement_dismissals").insert({ announcement_id: a.id, user_id: user.id });
        setDismissedIds((s) => new Set(s).add(a.id));
      }
    },
    [user],
  );

  const value = useMemo<NoticeContextValue>(
    () => ({
      loading,
      maintenance,
      maintenanceOn,
      blockedByMaintenance,
      delayNotices,
      settings,
      currentAnnouncement,
      dismissAnnouncement,
      // Display order: maintenance, then the (non-blocking) delay banner, then
      // announcements, then the tour, then the Bob intro.
      modalsAllowed: !loading && !blockedByMaintenance && !currentAnnouncement,
      reload: load,
    }),
    [loading, maintenance, maintenanceOn, blockedByMaintenance, delayNotices, settings, currentAnnouncement, dismissAnnouncement, load],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
