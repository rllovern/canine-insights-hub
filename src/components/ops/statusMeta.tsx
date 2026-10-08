// Presentation metadata for SOP statuses and areas. All colors come from the --ops-* tokens.
import { Ban, CheckCircle2, CircleDashed, CircleDot, Clock, HelpCircle, KeyRound, ShieldCheck, Search, Megaphone, PhoneCall, Globe, Rocket, Circle, Minus } from "lucide-react";
import type { SopStatus, Readiness } from "@/lib/mops/readiness";
import type { SopArea } from "@/lib/mops/sopTree";
import type { LucideIcon } from "lucide-react";

export const STATUS_META: Record<SopStatus, { label: string; icon: LucideIcon; text: string; bg: string; ring: string; dashed?: boolean }> = {
  verified:              { label: "Verified",              icon: CheckCircle2, text: "text-ops-verified", bg: "bg-ops-verified/10", ring: "ring-ops-verified/30" },
  awaiting_verification: { label: "Awaiting verification", icon: Clock,        text: "text-ops-progress", bg: "bg-ops-progress/10", ring: "ring-ops-progress/30" },
  in_progress:           { label: "In progress",           icon: CircleDot,    text: "text-ops-progress", bg: "bg-ops-progress/10", ring: "ring-ops-progress/30" },
  awaiting_access:       { label: "Awaiting access",       icon: KeyRound,     text: "text-ops-access",   bg: "bg-ops-access/10",   ring: "ring-ops-access/30" },
  blocked:               { label: "Blocked",               icon: Ban,          text: "text-ops-blocked",  bg: "bg-ops-blocked/10",  ring: "ring-ops-blocked/40" },
  unknown:               { label: "Unknown",               icon: HelpCircle,   text: "text-ops-unknown",  bg: "bg-transparent",     ring: "ring-ops-unknown/40", dashed: true },
  not_started:           { label: "Not started",           icon: Circle,       text: "text-muted-foreground", bg: "bg-transparent", ring: "ring-border" },
  not_applicable:        { label: "Not applicable",        icon: Minus,        text: "text-ops-na",       bg: "bg-transparent",     ring: "ring-ops-na/30" },
};

export const STATUS_ORDER: SopStatus[] = ["not_started", "unknown", "awaiting_access", "in_progress", "awaiting_verification", "verified", "blocked", "not_applicable"];

export const AREA_META: Record<SopArea, { label: string; icon: LucideIcon; blurb: string }> = {
  discovery:     { label: "Business Discovery",  icon: Search,      blurb: "Questionnaire & discovery" },
  access:        { label: "Access & Assets",     icon: ShieldCheck, blurb: "Accounts and permissions" },
  google_ads:    { label: "Google Ads",          icon: Megaphone,   blurb: "Account configuration" },
  call_tracking: { label: "Call Tracking",       icon: PhoneCall,   blurb: "CallTrackingMetrics setup" },
  website:       { label: "Website & Forms",     icon: Globe,       blurb: "Landing page and form attribution" },
  launch:        { label: "Launch Readiness",    icon: Rocket,      blurb: "Billing, kickoff and handoff" },
};

export const READINESS_META: Record<Readiness, { label: string; text: string; bg: string; dot: string }> = {
  launch_ready: { label: "Launch-ready",  text: "text-ops-verified", bg: "bg-ops-verified/10", dot: "bg-ops-verified" },
  at_risk:      { label: "At risk",       text: "text-ops-access",   bg: "bg-ops-access/10",   dot: "bg-ops-access" },
  not_ready:    { label: "Not ready",     text: "text-ops-blocked",  bg: "bg-ops-blocked/10",  dot: "bg-ops-blocked" },
  not_assessed: { label: "Not assessed",  text: "text-ops-unknown",  bg: "bg-muted",           dot: "bg-ops-unknown" },
};

export const UNTRACKED_ICON = CircleDashed;
