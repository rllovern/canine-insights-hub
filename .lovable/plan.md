## What's actually missing

You're right — the previous pass added the database tables, edge functions, and a few chart primitives, but the **pages you see in the app are still the original Ridgeside scaffolding**. None of the screens from your AlienX screenshots exist yet:

- No "Google PPC Overview" page with the Cost / Clicks / Actions sections, dual-axis charts, KPI strip
- No full Call Tracking page (only the basic CTM tab)
- No Keywords page
- No Client Management page (the rich one with logo upload, sources badges, share link, sync/backfill row actions, score-mappings dialog, CTM diagnostic dialog, sync-health bell)
- No client-facing public report layout that matches screenshot #2
- No AI Assistant slide-out wired to the `ai-assistant` edge function
- Top bar lacks the property switcher pill, period selector, "vs previous" pill, export, and Internal/Viewer toggle in the layout shown

This plan ports each of those, rebranded to Ridgeside (sage green, Inter), running on the existing data model.

## Plan

### 1. Layout shell rebuild
Replace `AppShell` / sidebar / top bar with the AlienX layout, kept on Ridgeside tokens:
- Left sidebar: brand mark + "DASHBOARD" eyebrow, sections **Analytics** (PPC Overview, Call Tracking, Keywords) and **Admin** (Clients, Settings)
- Top bar: title + sub-line on the left; on the right — property switcher pill, "This Month" period selector, date-range pill, "vs previous" comparison pill, export button, Internal/Viewer toggle
- Wire to existing `PropertyContext`, `DateRangeContext`, `PreviewModeContext`

### 2. PPC Overview page (`/dashboard`)
Port `PpcOverview.tsx`:
- ADS OVERVIEW section divider
- Three KPI groups: **Cost & Impressions** (Cost, Avg CPM, Impressions), **Clicks** (Clicks, CTR, Avg CPC), **Actions** (Leads, Good Leads, Intakes/Admissions, Medicaid → relabel to "Boarded" or property-specific via `metric_labels`)
- Three dual-axis charts: Cost vs CPM, Clicks vs CTR, Impressions vs Calls
- Reads from `daily_metrics` for the active property + date range, with prior-period deltas

### 3. Call Tracking page (`/calls`)
Port `CallTracking.tsx` to replace the current CTM tab content:
- CALL PERFORMANCE divider, Total Calls + Calls by Source line charts
- Source × Outcome matrix and per-campaign breakdown (already partially built)
- Joins `ctm_calls` with `property_call_score_mappings` for Good Lead / Bad Lead / SPAM / Admission buckets
- Respects `canSeeSpam` / `canSeeBadLead` for viewers and public reports

### 4. Keywords page (`/keywords`)
Port `Keywords.tsx`:
- Rankings table from `keyword_rankings`
- Share-of-Voice from `keyword_share_of_voice`
- Trend chart, position-bucket distribution

### 5. Client Management page (`/admin/properties`)
Replace current `AdminProperties` with full `ClientsAdmin` port (screenshot #3):
- "Add a client" card (Name, Slug, Brand color, Add)
- "Import from MCC" and "Import from CTM" buttons (call `list-mcc-customers` / `list-ctm-accounts`)
- All-clients table: Brand swatch, Logo upload, Name, Slug, Sources badges (ADS/CTM/GA4), Status, Last synced, Share link with copy, row actions (visible-metrics editor, score mappings dialog, CTM diagnostic dialog, Sync, Backfill, Delete)
- "Sync all clients" button → `scheduled-sync-all`
- Sync-health bell in top bar

### 6. Public Report page (`/report/:token`)
Rebuild `PublicReport` to match screenshot #2:
- Centered "PERFORMANCE REPORT" header with property logo, name, date range, "vs previous", period pill
- Same ADS OVERVIEW + CALL PERFORMANCE sections as internal view
- Hides metrics listed in `properties.hidden_metrics` and SPAM/Bad-Lead per scoping rules
- No sidebar, no admin actions, AI Assistant disabled

### 7. Settings page (`/admin/settings`)
Port `Settings.tsx`:
- Google Ads OAuth connect button (uses `google-ads-oauth-url` / `google-ads-oauth`)
- CTM credentials form
- Default metric labels
- Sync schedule info

### 8. AI Assistant
Mount `AIAssistant.tsx` slide-out (already-built `ai-assistant` edge function + `ai_assistant_context` RPC). Visible on internal pages and on the public report when enabled.

### 9. Routes & navigation
Update `App.tsx`:
- `/dashboard` → PPC Overview (keep current "all properties" picker as `/dashboard/properties` or fold into property switcher)
- `/calls`, `/keywords`, `/admin/properties`, `/admin/settings`
- Keep `/report/:token`, `/login`, `/register`, `/properties/:slug` (legacy, redirects to PPC Overview with that property selected)

### Preserved
- All existing tables, RPCs, and edge functions
- Auth flow, super-admin account, role/preview-mode logic
- Ridgeside sage-green tokens, Inter font, BrandMark/PropertyAvatar
- CTM sync edge function (already working)

### Technical notes
- Sweeping rename during port: `client_id`→`property_id`, `clients`→`properties`, `activeClient`→`activeProperty`, `useDashboard`→reuse existing contexts
- Files touched: ~12 new pages/components, edits to `App.tsx`, `AppShell.tsx`, removal of obsolete `Dashboard.tsx` / `PropertyPage.tsx` (or repurposed)
- No new migrations needed — schema already in place

### Out of scope
Google Ads, GA4, and Keyword.com remain unconfigured until you provide credentials; their pages render with empty-state messaging in the meantime. CTM continues to work with live data.
