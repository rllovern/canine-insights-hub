# SYSTEM OVERVIEW — Ridgeside K9 Insights

**Last updated:** 2026-08-10 (UTC)
**Maintenance rule:** this is a living document. Any change to a sync, a schema
object, a metric formula, a threshold, or a business rule must update the
relevant section in the same change. Do not let it go stale.

## How to read the provenance markers

Every non-obvious claim in this document carries one of:

- **[CODE]** — read directly out of the repository in this session, with a
  `file:line` reference where practical.
- **[DB]** — measured by running a live query against the production database
  in this session (2026-08-10). Row counts and date ranges are point-in-time.
- **[RECALL]** — recalled from prior conversation with the operator. Not
  re-verified against code or data in this session. Treat as lower confidence.
- **[UNKNOWN]** — explicitly not determined. See §9.

Where a number was not measured, it is not stated. Gaps are left as gaps.

---

# 1. WHAT THIS IS

## Purpose

A marketing and sales performance dashboard for **Ridgeside K9**, a multi-location
dog-training business. It merges paid-media spend (Google Ads), call tracking
(CallTrackingMetrics), CRM pipeline and sales (GoHighLevel), and a manually
maintained Google Sheet of sales, into one reporting surface per location and
across the portfolio. [CODE — inferred from table set, page set, and property rows]

## Locations (properties) [DB]

Seven active properties:

| Name | Slug | Timezone | Google Sheet tab |
|---|---|---|---|
| Ridgeside K9 Ashtabula | `ashtabula` | America/New_York | `Ashtabula 2026` |
| Ridgeside K9 Central IL | `rsk9-central-il` | America/New_York | *(none)* |
| Ridgeside K9 DFW | `ridgeside-k9-dfw` | America/New_York | *(none)* |
| Ridgeside K9 MoCo | `ridgeside-k9-moco` | America/New_York | `MOCO 2026` |
| RidgesideK9 Colorado Springs | `ridgesidek9-colorado-springs` | America/New_York | *(none — deliberately cleared, see §8)* |
| RidgesideK9 NoVA | `ridgesidek9-nova` | America/New_York | `NOVA/DMV 2026` |
| RidgesideK9 Winchester | `ridgesidek9-winchester` | America/New_York | `Winchester 2026` |

All seven carry `timezone = America/New_York`, including DFW and Central IL,
which are not Eastern. This is a **known correctness issue** — see §8.

## Who uses it

Roles are stored in `public.user_roles` with enum `app_role`:
`internal, viewer, super_admin, admin, owner, location_owner`. [DB]

- **super_admin / admin / owner / internal** — agency staff. Full portfolio,
  all admin pages, sync controls. [CODE — `src/components/layout/Sidebar.tsx`
  `staffOnly` / `superAdminOnly` flags]
- **location_owner** — a client who owns one location. Constrained to a single
  property by a DB trigger, `enforce_single_location_for_location_owner()`. [DB]
- **viewer** — external client viewer, access granted row-by-row through
  `viewer_property_access` (5 rows currently). Blocked from most pages by
  `<ViewerBlock>`. [CODE — `src/App.tsx:72-79`] [DB]

There is a preview/impersonation mechanism (`PreviewModeContext`) that lets an
owner view the app as a location owner. Several of its exports are marked
`@deprecated` in place. [CODE — `src/contexts/PreviewModeContext.tsx:20-40`]

## Client-facing vs internal

**Client-facing:**
- `/report/:token` — `PublicReport`, unauthenticated, token-scoped. Reads only
  through `SECURITY DEFINER` token RPCs (`get_property_by_report_token`,
  `public_report_metrics`, `get_ctm_calls_by_report_token`, etc.). [CODE/DB]
- `/command` in non-owner mode — renders a merged "Performance Report" made of
  `Dashboard` + `CallTracking`. [CODE — `src/pages/Command.tsx:189-197`]
- `/admin/client-reports` — staff-generated client report surface (staff opens
  it, client is the audience). [CODE]

**Internal only:** everything under `/admin/*`, `/lead-performance`, `/budget`,
`/assistant` (Jarvis), `/keywords`. [CODE — Sidebar role flags]

## Build status by feature

| Feature | Status | Evidence |
|---|---|---|
| Google Ads sync → `daily_metrics` | **Live** | [DB] 2,136 PPC rows, syncing hourly-ish |
| CTM sync → `ctm_calls` + `daily_metrics` | **Live** | [DB] 2,591 calls, 84 successful runs/24h |
| GHL sync → contacts/opps/messages/appts | **Live but unstable** | [DB] failures + stuck `running` rows, see §8 |
| Google Sheets sales sync | **Live but abandoned upstream** | [DB] `sheet_sales` max date 2026-07-06 |
| GA4 sync | **Broken / dead** | [CODE] writes to `client_data_sources` / `client_id`, neither exists [DB] |
| Keyword.com sync | **Broken / dead** | [CODE] writes `client_id`; [DB] both keyword tables have 0 rows |
| Command / Executive Overview | Live | [CODE] |
| PPC Overview (Dashboard) | Live | [CODE] |
| Call Tracking | Live | [CODE] |
| Lead Performance | Live | [CODE] |
| Budget Pacing | Live | [CODE] |
| Sale Records + Sales Cadence + Revenue Runway | Live | [CODE] |
| Jarvis AI assistant | Live | [DB] 16 sessions, 53 messages |
| Guided tour | Live | [DB] `user_tour_state` 3 rows |
| Forced password change / invites | Live | [DB] `user_security` 2 rows |
| **Opportunity Conversion card** (replacement for Revenue Runway) | **Planned, not built** | [RECALL] specced and approved, build deliberately halted |
| $0-win data-quality guard, excluded-win counter, Central IL suppression | **Planned, not built** | [RECALL] |

---

# 2. DATA SOURCES

Connection state lives in `property_data_sources` (one row per property × source).
Current state [DB]: every property has `ctm` + `google_ads` + `ghl` connected,
**except MoCo, which has no `ghl` row at all** (only `ctm` and `google_ads`).
That single missing row explains MoCo's absence from every CRM-derived metric.

There are **no** `ga4` or `keyword_com` rows in `property_data_sources`. [DB]

## 2.1 Google Ads

- **Function:** `sync-google-ads`, `supabase/functions/sync-google-ads/index.ts` [CODE]
- **API:** `googleads.googleapis.com/v23/customers/{id}/googleAds:searchStream`;
  OAuth refresh at `oauth2.googleapis.com/token`. [CODE :11,:26,:146]
- **Writes:**
  - `daily_metrics`, conflict target `property_id,date,ad_source,campaign` [CODE :276]
  - `campaign_budgets` — full delete-then-insert per property [CODE :317-319]
  - `campaign_labels` — full delete-then-insert [CODE :351-353]
  - `property_data_sources` status fields; `sync_runs` when self-logging
- **Derived / defaulted fields (not copied from source):** [CODE]
  - `ad_source` — hardcoded string `"Google PPC"` (:235)
  - `campaign` — `campaign.name`, falls back to `"(unknown)"` (:236)
  - `cost` — `costMicros / 1_000_000` (:237)
  - `campaign_budgets.daily_budget` — `amountMicros / 1_000_000` (:311)
  - `synced_at` on budgets/labels — `new Date().toISOString()` (our write time)
  - `record_count, leads, good_leads, bad_leads, medicaid, projected_sale,
    verified_sale, no_entry, spam, sessions, users` — **preserved from the
    existing row if present, otherwise defaulted to 0** (:261-271). Google Ads
    explicitly does not own these columns.
- **Date range:** default last 7 days ending yesterday (`isoDaysAgo(7)` →
  `isoYesterday()`), overridable by body params. The orchestrator overrides this
  to 30 days. [CODE :108-109; `scheduled-sync-all/index.ts:53-54`]
- **Pagination:** none. **Rate limiting:** none. **Retry/backoff:** none. [CODE]
- **Partial failure:** API or upsert error aborts and sets
  `property_data_sources.status='error'`. Budget and label snapshot steps are in
  try/catch and **swallow errors silently** — if the delete succeeds and the
  re-insert fails, the snapshot is left empty. [CODE :322-324,:356-358]
- **Auth:** service key, `CRON_SECRET`, or a user JWT with role in
  `super_admin/admin/owner/internal`. [CODE :50-73]

## 2.2 GoHighLevel (GHL)

- **Function:** `sync-ghl`, `supabase/functions/sync-ghl/index.ts` [CODE]
- **API:** `services.leadconnectorhq.com`, version header `2021-07-28`. Endpoints
  used: `/users/`, `/opportunities/pipelines`, `/contacts/search`,
  `/contacts/{id}`, `/conversations/search`, `/conversations/{id}/messages`,
  `/opportunities/search`, `/calendars/`, `/calendars/events`,
  `/contacts/{id}/tasks`. [CODE :17-18]
- **Writes:** `ghl_users`, `ghl_pipelines`, `ghl_pipeline_stages`,
  `ghl_contacts`, `ghl_messages`, `ghl_opportunities`,
  `ghl_opportunity_stage_history`, `ghl_appointments`, `ghl_tasks` (opt-in),
  then calls RPCs `seed_pipeline_mapping_suggestions` and `rebuild_lead_facts`
  (which populate `property_pipeline_mapping` and `ghl_lead_facts`). [CODE]
- **Derived / defaulted fields — critical list:** [CODE]
  - `ghl_users.name` — concatenation of firstName + lastName, fallback `u.name`,
    else null (:284)
  - `ghl_users.is_active` — `deleted === true ? false : true` (:287)
  - `ghl_contacts.assigned_user_id` — duplicated from `assigned_to` (:373-374)
  - `ghl_messages.response_source` — **classified by `classifyMessage()`** into
    human / automation / ai / system / customer / unknown from direction,
    messageType, source, userId (:106-129,:545). This is a heuristic, not source
    data, and it drives every speed-to-lead metric.
  - `ghl_messages.channel` — `messageChannel()` mapping (:131-141)
  - `ghl_messages.body_preview` — truncated to 280 chars (:548)
  - `ghl_messages.meta` — normalized merge of call duration/status (:155-164)
  - `ghl_opportunities.status` — `canonicalizeOppStatus()` (:187-194)
  - **`ghl_opportunities.won_at` / `lost_at`** — only set when status is won/lost,
    value taken from `lastStatusChangeAt ?? lastStageChangeAt ?? updatedAt`
    (:624-625). **This is the root cause of the bulk-stamped won dates** (§8):
    a bulk edit in GHL rewrites `updatedAt`, and the fallback then treats that
    as the win date.
  - `ghl_opportunities.stage_id` — `pipelineStageId ?? stageId` (:617)
  - `ghl_opportunity_stage_history` rows — **synthesized by diffing** local stage
    against re-fetched stage; `source` hardcoded `"sync_diff"` (:641-656). These
    are not GHL history records; they only exist from the moment we started
    syncing. Earliest row is 2026-06-09. [DB]
  - `ghl_appointments.appointment_status` — `canonicalizeApptStatus()`; a
    "confirmed" appointment whose end time is in the past is **heuristically
    reclassified to `showed`** with `status_is_derived = true` (:168-185)
  - `ghl_tasks.counts_as_attempt` — regex on title/taskType + completion (:731-745)
- **Date range:** default `now − 30 days` to `now`; orchestrator passes the same.
  Appointments are walked in 7-day sub-windows. Contacts outside the window are
  dropped, not written. [CODE :252-253,:362,:674-678]
- **Pagination and hard caps** [CODE :19-29] — these caps mean a single run does
  **not** guarantee full coverage:
  `MAX_RPS=8`, `MAX_RETRIES=5`, `BACKOFF_BASE_MS=2000`,
  `MAX_CONTACT_SEARCH_PAGES=5` (500 contacts), `MAX_CONVERSATION_SEARCH_PAGES=4`,
  `MAX_MESSAGE_PAGES_PER_CONVERSATION=2`, `MAX_TARGETED_CONVERSATION_LOOKUPS=20`,
  `MAX_CONVERSATIONS_FOR_MESSAGE_SYNC=35`, `MAX_TOTAL_MESSAGE_PAGES=50`,
  `MAX_OPPORTUNITY_PAGES=15`, `MAX_TAG_REFRESH=75`, tasks capped to 500 contacts.
- **Rate limiting:** sliding-window limiter at 8 req/s. **Retry:** on 429
  (honors Retry-After, 10–60s floor), on transient 5xx/408, on 401-with-timeout,
  and on the specific GHL 400 `"Error occurred while searching for contact"`.
  Up to 5 attempts. [CODE :70-97]
- **Partial failure:** every phase is wrapped in a `safe()` helper; a failing
  phase is recorded and skipped, and the sync continues. **Partial writes are
  the normal case.** `property_data_sources.status` is deliberately kept
  `connected` even on failure so the orchestrator does not permanently skip the
  pair. [CODE :269-276,:769-773]
- **Auth:** no explicit role guard found in the file — relies on the platform
  `verify_jwt` default. It is the only sync function without one. [CODE — flagged
  as an open question by the code survey]

### GHL historical backfill

- **Function:** `ghl-backfill`, `supabase/functions/ghl-backfill/index.ts`,
  surfaced in the UI at **Admin → Data Sources → Historical backfill**. [CODE][RECALL]
- Resumable cursor machine: contacts phase (`searchAfter`, 15 pages ≈ 1,500
  contacts per invocation), then opportunities phase (page number, 15 pages per
  invocation, hard ceiling page 300), then a `finalize` phase that calls
  `rebuild_lead_facts`. The caller must re-invoke with the returned cursor until
  `next: null`. [CODE :27-29,:160-230]
- Default `start_date` = `now − 730 days`. [CODE :127]
- Own retry: 429/5xx, 4 attempts, `1500 × 2^attempt`. Does **not** honor
  Retry-After (unlike `sync-ghl`). [CODE :44-69]
- On error it returns 500 with `next: null`, which **kills the resumable chain**
  rather than allowing continuation. [CODE :293-298]
- Auth: real user JWT **and** `is_all_properties_reader` true. [CODE :106-110]

**Backfill history [DB + RECALL]:** only one run is logged with
`trigger_source='backfill'`, on **2026-08-06** for GHL. That matches the DFW
backfill [RECALL: ~889 opportunities imported]. Earliest-write-time versus
earliest-source-date per property shows where history predates our sync and
therefore arrived by backfill or by GHL's own search window:

| Property | First row we wrote | Earliest source `ghl_created_at` |
|---|---|---|
| Ashtabula | 2026-06-12 | 2025-07-23 |
| Central IL | 2026-08-06 | 2026-07-07 |
| DFW | 2026-08-05 | 2026-03-12 |
| Colorado Springs | 2026-06-16 | 2026-05-01 |
| NoVA | 2026-06-16 | 2026-05-19 |
| Winchester | 2026-06-16 | 2026-05-17 |

[DB] I cannot reconstruct a full backfill audit trail beyond this — see §9.

## 2.3 CallTrackingMetrics (CTM)

- **Function:** `sync-ctm`, `supabase/functions/sync-ctm/index.ts` [CODE]
- **API:** `api.calltrackingmetrics.com/api/v1/accounts/{accountId}/calls/search.json`,
  HTTP Basic auth. [CODE :174,:181]
- **Writes:** `ctm_calls` (conflict `property_id,ctm_call_id`) and
  `daily_metrics` (conflict `property_id,date,ad_source,campaign`).
- **Derived / defaulted:** [CODE]
  - `ctm_call_id` — falls back to `crypto.randomUUID()` if CTM supplies none
    (:237). Such a row will duplicate on every subsequent sync.
  - `called_at` — `called_at ?? start_time ?? date` (:233); rows with none are dropped
  - `channel` / `ad_source` — `classifyChannel()` + `TRACKING_SOURCE_MAP` (:65-81)
  - `call_score_label` — first label from `extractScoreLabels()` (:21-49)
  - `call_score_bucket` — `classifyCall()` against the `property_call_score_mappings`
    table (42 rows) (:51-63)
  - `campaign` — `campaign ?? utm_campaign ?? source ?? "(unattributed)"`,
    truncated to 120 chars (:290)
  - `record_count, leads, good_leads, bad_leads, no_entry, spam, projected_sale`
    — aggregated from the bucket classification (:281-304). **Every lead-quality
    number in this product originates from this classifier.**
  - `verified_sale` — `isConverted()`, truthiness of `sale.conversion` /
    `converted` / `conversion` (:266-280). Code comments claim this is now the
    canonical source and GHL no longer writes it (:264-265).
  - `cost, impressions, clicks, sessions, users` — set to 0 then overwritten with
    the pre-existing row values (merge-preserve). CTM never owns them. (:356-359)
- **Date range:** default last 30 days to today. [CODE :139-140]
- **Pagination:** `per_page=150`, loop until short page or `total_pages`, hard
  break after page 50 (7,500 calls max). [CODE :179-199]
- **Retry/backoff:** none.
- **Partial failure — highest-risk behavior in the system:** before upserting,
  the function issues a **blanket UPDATE zeroing `record_count`, leads, and all
  quality columns for the entire date range** for that property (:330-335). If
  the subsequent upsert fails, the range is left zeroed with no recomputed
  values, and there is no transaction wrapping it. [CODE]
- **Auth:** service key / `CRON_SECRET` / `is_all_properties_reader` RPC. [CODE :94-112]

## 2.4 Google Sheets (sales)

- **Function:** `sync-sheet-sales`, `supabase/functions/sync-sheet-sales/index.ts`;
  `verify_jwt = false` in `supabase/config.toml`. [CODE]
- **API:** the Lovable connector gateway at
  `connector-gateway.lovable.dev/google_sheets/v4`, not the raw Google API. [CODE :17]
- **Writes:** `sheet_sales` (conflict `property_id,source_row_hash`),
  `sheet_sync_config`, and `properties.google_sheet_tab` via a `set_property_tab`
  action.
- **Derived / defaulted:** [CODE]
  - `sale_date` — `sold_date ?? creation_date` (:168); rows without a name or a
    resolvable date are skipped
  - `source_row_hash` — SHA-256 of
    `full_name|email|phone|sold_date|creation_date|deal_value` (:57-61,:176).
    Purely our own dedup key. **Because the property is not in the hash, the same
    person on two tabs collides across properties** — the mechanism behind the
    Colorado Springs duplication in §8.
  - `first_session`, `deal_value` — parsed, including Google Sheets serial dates
  - `synced_at` — our write time
- **Date range:** none. Full re-import of `A1:Z10000` per tab every run. [CODE :93]
- **Pagination:** none; multi-tab reads use `batchGet` with one 5s retry on 429. [CODE]
- **Partial failure:** per-property loop continues on error; overall status
  recorded as `partial`. Falls back to per-row upsert if a chunk fails. This is
  the only sync with row-level resilience. [CODE :203-215,:341-367]
- **Auth:** cron via service key / `CRON_SECRET` / vault `get_cron_secret_v2`;
  interactive actions require `is_super_admin`. [CODE :236-257]

## 2.5 GA4 — dead

`sync-ga4` reads `client_data_sources` and writes `daily_metrics` with conflict
target `client_id,date,ad_source,campaign`. **Neither `client_data_sources` nor a
`client_id` column on `daily_metrics` exists in the database.** [CODE + DB] The
function cannot succeed. Notably, `daily_metrics` does contain `Organic`,
`Direct`, `Referral`, `Facebook`, and `Other` rows [DB] — those are produced by
CTM's `classifyChannel()`, not by GA4.

## 2.6 Keyword.com — dead

`sync-keyword-com` also writes `client_id`-keyed rows. `keyword_rankings` and
`keyword_share_of_voice` both have **0 rows**. The `/keywords` page therefore has
no data. [CODE + DB]

## 2.7 Orchestration and recovery

- **`scheduled-sync-all`** — cron orchestrator. Maps
  `google_ads→sync-google-ads, ctm→sync-ctm, ga4→sync-ga4,
  keyword_com→sync-keyword-com, ghl→sync-ghl`. Selects every
  `property_data_sources` row with status in (`connected`,`error`). Passes a
  30-day window to every child, overriding their defaults. Runs pairs
  sequentially. Retries a pair up to 3 times with waits `[0s, 30s, 120s]`.
  `PER_INVOKE_TIMEOUT_MS = 90_000`, `PER_PAIR_TIMEOUT_MS = 300_000`. Cron-secret
  auth only. [CODE :21-27,:36-98,:116]
- **`resync-failed`** — recovery pass, intended to run **every 2 minutes**
  [CODE header comment; RECALL: this cadence was an explicit instruction].
  A pair is eligible if the last run failed, or is `running` and older than
  5 minutes, or the last success is older than 5 hours. Max 10 candidates per
  tick. [CODE :32-37,:92-124]
- **Actual cadence observed [DB]:** the `cron` trigger source fires roughly every
  4 hours per pair; `resync_failed` has logged 1,513 GHL runs since 2026-07-13,
  which is far more than the other sources and indicates GHL is failing
  constantly.
- I could **not** read `cron.job` — permission denied for the `cron` schema, and
  the `get_sync_cron_schedule()` RPC is also permission-denied from this
  connection. **The live cron schedule is therefore unverified.** [UNKNOWN]

### Run-log distribution [DB]

| trigger_source | source | runs | first | last |
|---|---|---|---|---|
| cron | ctm | 620 | 2026-07-13 | 2026-08-10 |
| cron | ghl | 584 | 2026-07-13 | 2026-08-10 |
| cron | google_ads | 631 | 2026-07-13 | 2026-08-10 |
| resync_failed | ghl | 1,513 | 2026-07-13 | 2026-08-10 |
| resync_failed | ctm | 252 | 2026-07-13 | 2026-08-10 |
| resync_failed | google_ads | 251 | 2026-07-13 | 2026-08-10 |
| backfill | ghl | 1 | 2026-08-06 | 2026-08-06 |
| manual | google_ads | 2 | 2026-07-13 | 2026-08-05 |
| unknown | ctm / ghl / google_ads | 2,619 / 2,805 / 843 | 2026-05-11 → | 2026-08-10 |

`unknown` is the pre-`trigger_source` era plus self-logged runs.

---

# 3. SCHEMA

Row counts and date ranges are **[DB], measured 2026-08-10**.

## 3.1 Core reporting

### `daily_metrics` — 2,647 rows, 2025-08-22 → 2026-08-10

The single blended fact table. One row per
`(property_id, date, ad_source, campaign)`. Written by **two different syncs that
each own a disjoint column set and preserve the other's columns on upsert** —
Google Ads owns `cost/impressions/clicks`; CTM owns
`record_count/leads/good_leads/bad_leads/no_entry/spam/projected_sale/verified_sale`.

- `date` — **source date** (Google Ads `segments.date`, or the local day of the
  CTM call).
- `created_at` — our write time.
- Per-property coverage:

| Property | First | Last | Rows | Total cost |
|---|---|---|---|---|
| Ashtabula | 2025-08-22 | 2026-08-10 | 691 | $26,923 |
| Central IL | 2026-07-07 | 2026-08-09 | 68 | $839 |
| DFW | 2026-07-06 | 2026-08-10 | 39 | $2,005 |
| MoCo | 2026-04-20 | 2026-08-10 | 360 | $24,515 |
| Colorado Springs | 2026-04-28 | 2026-08-10 | 268 | $16,813 |
| NoVA | 2026-04-28 | 2026-08-09 | 642 | $67,970 |
| Winchester | 2026-04-28 | 2026-08-09 | 579 | $49,141 |

- `ad_source` values present: `Google PPC` (2,136), `Organic` (171),
  `Direct` (139), **`GHL Won` (113, 2025-08-22 → 2026-06-25)**, `Referral` (61),
  `Other` (24), `Facebook` (3). `GHL Won` is a legacy disposition feed that is
  now **explicitly excluded** by the Command page (§4).

### `v_lead_counts_daily` — VIEW, full SQL [DB]

```sql
 SELECT property_id,
    date,
    ad_source,
    campaign,
    cost,
    record_count AS records,
    no_entry,
    spam,
    bad_leads,
    good_leads,
    projected_sale AS projected_sales,
    verified_sale AS verified_sales,
    bad_leads + good_leads + projected_sale AS total_leads,
    good_leads + projected_sale AS quality_numerator,
        CASE
            WHEN (bad_leads + good_leads + projected_sale) > 0 THEN (good_leads + projected_sale)::numeric / (bad_leads + good_leads + projected_sale)::numeric
            ELSE NULL::numeric
        END AS quality_rate
   FROM daily_metrics dm;
```

### `v_lead_counts_property_daily` — VIEW, full SQL [DB]

```sql
 SELECT property_id,
    date,
    sum(cost) AS cost,
    sum(records) AS records,
    sum(no_entry) AS no_entry,
    sum(spam) AS spam,
    sum(bad_leads) AS bad_leads,
    sum(good_leads) AS good_leads,
    sum(projected_sales) AS projected_sales,
    sum(verified_sales) AS verified_sales,
    sum(total_leads) AS total_leads,
    sum(quality_numerator) AS quality_numerator,
        CASE
            WHEN sum(total_leads) > 0 THEN sum(quality_numerator)::numeric / sum(total_leads)::numeric
            ELSE NULL::numeric
        END AS quality_rate
   FROM v_lead_counts_daily
  GROUP BY property_id, date;
```

These are the **only two views** in the `public` schema. Everything else that
looks like a view is a `SECURITY DEFINER` function (§3.5).

## 3.2 CRM tables (populated by sync + backfill)

| Table | Rows | Date column | Range | Notes |
|---|---|---|---|---|
| `ghl_contacts` | 9,471 | `ghl_created_at` (source) | 2025-07-23 → 2026-08-09 | `created_at`/`updated_at` are our write time |
| `ghl_opportunities` | 6,979 | `ghl_created_at` (source) | 2025-06-15 → 2026-08-10 | `won_at`/`lost_at` are **derived**, see §2.2 |
| — wins subset | 1,544 | `won_at` (derived) | 2025-06-20 → 2026-08-09 | |
| `ghl_messages` | 24,541 | `sent_at` (source) | **2026-05-14** → 2026-08-10 | The message-history horizon. Nothing before mid-May 2026 exists |
| `ghl_lead_facts` | 9,540 | `lead_created_at` (source) | 2025-07-23 → 2026-08-09 | Derived table, rebuilt by `rebuild_lead_facts()` |
| `ghl_appointments` | 701 | `starts_at` (source) | 2026-05-15 → 2026-08-08 | `appointment_status` partly derived |
| `ghl_opportunity_stage_history` | 1,357 | `changed_at` (derived) | **2026-06-09** → 2026-08-10 | Synthesized by sync diffing, not GHL history |
| `ghl_pipelines` / `ghl_pipeline_stages` | 20 / 218 | — | — | Sync |
| `ghl_users` | 72 | — | — | Sync |
| `ghl_events_raw` | 610 | `occurred_at` | — | Raw landing table |
| `ghl_tasks` | 0 | — | — | Opt-in only, never enabled |

**`ghl_lead_facts` per property [DB]** — note the widely different start dates,
which is why cross-location history comparisons are unsafe:

| Property | Rows | First lead | Last lead |
|---|---|---|---|
| Ashtabula | 5,626 | 2025-07-23 | 2026-08-09 |
| Central IL | 238 | 2026-07-07 | 2026-08-09 |
| DFW | 1,188 | 2026-03-12 | 2026-08-09 |
| Colorado Springs | 664 | 2026-05-01 | 2026-08-09 |
| NoVA | 1,272 | 2026-05-19 | 2026-08-09 |
| Winchester | 552 | 2026-05-17 | 2026-08-09 |
| **MoCo** | **0** | — | — |

`ghl_lead_facts` is **derived**, produced entirely by the
`rebuild_lead_facts(property_id)` SQL function (16.3 KB of PL/pgSQL). It carries
~45 columns of behavioral derivations: `first_human_response_at`,
`first_human_outbound_at`, `first_human_engagement_at`,
`human_speed_to_lead_seconds_raw` / `_business`, `human_attempt_count`,
`automation_touch_count`, `ai_touch_count`, `is_stale`, `needs_first_response`,
`suppresses_needs_first_response_by_tag`, `is_disqualified`,
`disqualification_reason`, `canonical_stage`. **Every column in this table is
derived, none is copied verbatim from GHL.** I did not read the full body of
`rebuild_lead_facts` in this session — see §9.

## 3.3 Call tracking

`ctm_calls` — 2,591 rows, `called_at` 2026-05-11 → 2026-08-10 (source
timestamp). `synced_at` is our write time. `call_score_label` and
`call_score_bucket` are derived. Populated by sync.

## 3.4 Sales, config, and admin tables

| Table | Rows | Populated by | Notes |
|---|---|---|---|
| `sheet_sales` | 338 | Sheet sync | `sale_date` 2025-03-17 → **2026-07-06 (stale)** |
| `properties` | 7 | Manual/admin | |
| `property_data_sources` | 20 | Admin + sync status writes | MoCo missing `ghl` |
| `property_targets` | 5 | Manual/admin | Central IL and DFW have **no targets row** |
| `budget_accounts` | 7 | Manual/admin + self-healing placeholder creation | |
| `campaign_budgets` | 27 | Google Ads sync (delete+insert) | |
| `campaign_labels` | 5 | Google Ads sync (delete+insert) | Only NoVA and Winchester use label filtering |
| `property_call_score_mappings` | 42 | Manual/admin | Drives CTM good/bad classification |
| `property_pipeline_mapping` | 218 | Seeded by `seed_pipeline_mapping_suggestions()` | **0 of 218 confirmed by a user** |
| `lead_perf_suppression_tags` | 15 | Migration/manual | Global, not per-property |
| `agency_sla_defaults` | 1 | Migration | Global SLA fallback |
| `property_sla_settings` | **0** | Admin UI | No per-property overrides exist yet |
| `property_settings` | **0** | — | Table exists, entirely unused |
| `property_business_hours` | **0** | — | Unused, though SLA has `business_hours_only = true` |
| `keyword_rankings` / `keyword_share_of_voice` | 0 / 0 | Dead sync | |
| `sync_runs` | 10,122 | All syncs | 2026-05-11 → now |
| `user_roles` | 4 | Admin | |
| `user_security` | 2 | Invite flow | `must_change_password` flag |
| `viewer_property_access` | 5 | Admin | |
| `user_tour_state` | 3 | Tour | |
| `user_nav_preferences` | 1 | User | |
| `ai_agent_sessions` / `_messages` / `_reports` / `_tool_runs` | 16 / 53 / 13 / 57 | Jarvis | |
| `sheet_sync_config` | 1 | Sheet sync | Singleton |

**`property_targets` content [DB]:** all five rows are `period_start 2026-06-01`
with **identical** `cpl_target 200`, `cpgl_target 400`,
`monthly_good_leads_goal 35`; only `monthly_ad_budget` differs
(Ashtabula 6,000 · MoCo 7,500 · Winchester 10,000 · NoVA 17,000 · CO Springs 6,000).

**`budget_accounts` [DB]:** Ashtabula 6,000 · Central IL 540 · DFW 2,000 ·
MoCo 7,500 · CO Springs 6,000 · NoVA 17,000 · Winchester 10,000.

**`agency_sla_defaults` (single row) [DB]:** `first_response_seconds 300`,
`attempts_24h 3`, `attempts_7d 5`, `stale_after_hours 24`,
`critical_stale_after_hours 48`, `business_hours_only true`,
`after_hours_mode 'pause_until_open'`, `active_window_days 30`.

Note: `attempts_7d` is **5** in the database, while the admin UI default constant
is **6**. [DB vs CODE — `AdminSlaSettings.tsx:63-64`] That is a real
inconsistency.

## 3.5 Database functions that feed displayed metrics

40 functions exist in `public`. The ones that produce displayed numbers:
`lead_quality_rollup`, `lead_quality_rollup_by_report_token`,
`lead_perf_speed`, `lead_perf_handling`, `lead_perf_pipeline`,
`lead_perf_quality`, `lead_perf_agents`, `lead_perf_drill`,
`ghl_won_attribution`, `get_api_health_summary`, `rebuild_lead_facts`,
`sync_verified_sales_daily_metrics`, plus the `*_by_report_token` family for the
public report. Full SQL for the four most load-bearing ones is in §4.

---

# 4. EVERY COMPUTED METRIC

## 4.1 The canonical lead model — `src/lib/leadModel.ts` (full source) [CODE]

```typescript
/**
 * Canonical lead model — the ONLY place TypeScript computes lead totals or
 * quality. SQL mirror lives in `public.v_lead_counts_daily` and
 * `public.lead_quality_rollup`. Every page reads through this module; no
 * surface re-derives total leads or quality rate locally.
 *
 * Three mutually-exclusive real-lead tiers (bad, good, sales).
 * `projected` is NEVER inside `good`, NEVER subtracted, NEVER a forecast.
 */

export type LeadCounts = {
  bad: number;
  good: number;
  projected: number;
  spam?: number;
  noEntry?: number;
  verified?: number;
};

/** Total Leads = bad + good + sales. Three exclusive tiers. */
export const totalLeads = (c: LeadCounts) => c.bad + c.good + c.projected;

/** Quality numerator = good + sales (both are quality outcomes). */
export const qualityNumerator = (c: LeadCounts) => c.good + c.projected;

/** Quality rate = (good + projected) ÷ total. Ratio-of-sums when aggregating. */
export const qualityRate = (c: LeadCounts) => {
  const t = totalLeads(c);
  return t ? qualityNumerator(c) / t : 0;
};

/** Absolute, fixed quality targets. Never derived from any single location. */
export const QUALITY_TARGETS = { green: 0.55, amber: 0.45 } as const;

/**
 * Small-sample floor. Below this we suppress the rate entirely (genuinely
 * coin-flip territory). Calibrated for PPC-level lead volume, where even the
 * highest-spend location only produces ~12 quality leads per 30 days.
 */
export const LOW_SAMPLE_BASE = 8;

/**
 * Above the floor but still thin — render the rate with a "small sample"
 * caveat tag. Provisional, informational only: never drives pass/fail color
 * or opportunities (callers should check this independently of `qualityTier`).
 */
export const LOW_SAMPLE_CAVEAT = 15;

export type QualityTier = "green" | "amber" | "red" | "low-sample";

export function qualityTier(rate: number, base: number): QualityTier {
  if (base < LOW_SAMPLE_BASE) return "low-sample";
  if (rate >= QUALITY_TARGETS.green) return "green";
  if (rate >= QUALITY_TARGETS.amber) return "amber";
  return "red";
}

/** Canonical UI label for the projected-sale tier. Never "expected sales". */
export const PROJECTED_LABEL = "Sales";

/** Tailwind color helpers so every page styles the same tier the same way. */
export const TIER_TEXT: Record<QualityTier, string> = {
  green: "text-emerald-600",
  amber: "text-amber-600",
  red: "text-rose-600",
  "low-sample": "text-slate-500",
};
export const TIER_DOT: Record<QualityTier, string> = {
  green: "bg-emerald-500",
  amber: "bg-amber-500",
  red: "bg-rose-500",
  "low-sample": "bg-slate-400",
};

export function formatQualityRate(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

export function rowLeadCounts(row: {
  bad_leads?: number | null;
  good_leads?: number | null;
  projected_sale?: number | null;
  verified_sale?: number | null;
}): LeadCounts {
  return {
    bad: Number(row.bad_leads ?? 0),
    good: Number(row.good_leads ?? 0),
    projected: Number(row.projected_sale ?? 0),
    verified: Number(row.verified_sale ?? 0),
  };
}

export function rowTotalLeads(row: Parameters<typeof rowLeadCounts>[0]) {
  return totalLeads(rowLeadCounts(row));
}

export function rowQualityRate(row: Parameters<typeof rowLeadCounts>[0]) {
  return qualityRate(rowLeadCounts(row));
}
```

## 4.2 The shared ratio module — `src/lib/scopedMetrics.ts` (full source) [CODE]

```typescript
// Ratio-of-sums helpers. Always sum numerator and denominator across scope
// THEN divide. Never average per-row rates — a small property would distort.

export function ctr(clicks: number, impressions: number): number {
  if (!impressions) return 0;
  return clicks / impressions;
}

export function cpl(spend: number, totalLeads: number): number {
  if (!totalLeads) return 0;
  return spend / totalLeads;
}

export function cpgl(spend: number, goodLeads: number): number {
  if (!goodLeads) return 0;
  return spend / goodLeads;
}

export function cpc(spend: number, clicks: number): number {
  if (!clicks) return 0;
  return spend / clicks;
}

export function responseRate(responded: number, total: number): number {
  if (!total) return 0;
  return responded / total;
}

export function ratio(numerator: number, denominator: number): number {
  if (!denominator) return 0;
  return numerator / denominator;
}

/** Sum a numeric field across rows. */
export function sumField<T>(rows: readonly T[], key: keyof T): number {
  let total = 0;
  for (const r of rows) {
    const v = r[key] as unknown as number | null | undefined;
    if (typeof v === "number" && Number.isFinite(v)) total += v;
  }
  return total;
}
```

## 4.3 SQL mirror — `lead_quality_rollup` (full definition) [DB]

```sql
CREATE OR REPLACE FUNCTION public.lead_quality_rollup(_property_ids uuid[], _from date, _to date)
 RETURNS TABLE(records bigint, no_entry bigint, spam bigint, bad bigint, good bigint, projected bigint, verified bigint, total bigint, quality_num bigint, quality_rate numeric, spend numeric, cpl numeric, cpgl numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH base AS (
    SELECT * FROM public.v_lead_counts_daily v
    WHERE v.date >= _from AND v.date <= _to
      AND (_property_ids IS NULL OR v.property_id = ANY(_property_ids))
      AND (
        public.has_role(auth.uid(), 'internal'::app_role)
        OR public.viewer_can_access(auth.uid(), v.property_id)
      )
  )
  SELECT
    COALESCE(SUM(records), 0)::bigint            AS records,
    COALESCE(SUM(no_entry), 0)::bigint           AS no_entry,
    COALESCE(SUM(spam), 0)::bigint               AS spam,
    COALESCE(SUM(bad_leads), 0)::bigint          AS bad,
    COALESCE(SUM(good_leads), 0)::bigint         AS good,
    COALESCE(SUM(projected_sales), 0)::bigint    AS projected,
    COALESCE(SUM(verified_sales), 0)::bigint     AS verified,
    COALESCE(SUM(total_leads), 0)::bigint        AS total,
    COALESCE(SUM(quality_numerator), 0)::bigint  AS quality_num,
    CASE WHEN COALESCE(SUM(total_leads), 0) > 0
      THEN SUM(quality_numerator)::numeric / SUM(total_leads)
      ELSE NULL END                              AS quality_rate,
    COALESCE(SUM(cost), 0)::numeric              AS spend,
    CASE WHEN COALESCE(SUM(total_leads), 0) > 0
      THEN SUM(cost)::numeric / SUM(total_leads)
      ELSE NULL END                              AS cpl,
    CASE WHEN COALESCE(SUM(good_leads + projected_sales), 0) > 0
      THEN SUM(cost)::numeric / SUM(good_leads + projected_sales)
      ELSE NULL END                              AS cpgl
  FROM base;
$function$
```

**Note a definitional split:** this SQL defines `cpgl` with denominator
`good + projected`, while the TypeScript `scopedMetrics.cpgl` takes `goodLeads`
alone and `JourneyFunnel.tsx:45-48` computes `spend / (good + sales)`. Three
call sites, two different denominators. Drift risk — see §4.9.

## 4.4 CRM→media attribution — `ghl_won_attribution` (full definition) [DB]

```sql
CREATE OR REPLACE FUNCTION public.ghl_won_attribution(_property_ids uuid[], _from date, _to date)
 RETURNS TABLE(property_id uuid, won_day date, ad_source text, contact_method text, wins bigint, revenue numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _pid uuid;
BEGIN
  IF _property_ids IS NULL THEN
    IF NOT public.is_all_properties_reader(auth.uid()) THEN
      RAISE EXCEPTION 'access denied';
    END IF;
  ELSE
    FOREACH _pid IN ARRAY _property_ids LOOP
      IF NOT public.can_access_property(auth.uid(), _pid) THEN
        RAISE EXCEPTION 'access denied';
      END IF;
    END LOOP;
  END IF;

  RETURN QUERY
  WITH opp AS (
    SELECT
      o.property_id,
      (o.won_at AT TIME ZONE COALESCE(p.timezone, 'America/New_York'))::date AS won_day,
      COALESCE(o.raw->'attributions'->0, '{}'::jsonb) AS att,
      lower(COALESCE(o.raw->>'source', '')) AS src,
      COALESCE(o.monetary_value, 0) AS amount
    FROM public.ghl_opportunities o
    JOIN public.properties p ON p.id = o.property_id
    WHERE o.status = 'won'
      AND o.won_at IS NOT NULL
      AND (_property_ids IS NULL OR o.property_id = ANY(_property_ids))
      AND (o.won_at AT TIME ZONE COALESCE(p.timezone, 'America/New_York'))::date BETWEEN _from AND _to
  ),
  mapped AS (
    SELECT
      o.property_id,
      o.won_day,
      CASE
        WHEN o.att->>'utmGclid' IS NOT NULL
          OR o.att->>'gbraid' IS NOT NULL
          OR o.att->>'wbraid' IS NOT NULL
          OR o.att->>'utmSessionSource' = 'Paid Search'
          OR o.src LIKE '%google ads%'
          OR o.src LIKE '%paid%'
          THEN 'Google PPC'
        WHEN o.att->>'utmSessionSource' = 'Organic Search' OR o.src LIKE '%organic%' THEN 'Organic'
        WHEN o.att->>'utmSessionSource' = 'Direct traffic' OR o.src = 'website' THEN 'Direct'
        WHEN o.att->>'utmSessionSource' = 'Referral' THEN 'Referral'
        WHEN o.att->>'utmSessionSource' = 'Social media' OR o.att->>'medium' = 'facebook' THEN 'Facebook'
        ELSE 'Unattributed'
      END AS ad_source,
      CASE o.att->>'medium'
        WHEN 'form' THEN 'Form'
        WHEN 'conversation' THEN 'Call/Message'
        WHEN 'calendar' THEN 'Booked appointment'
        WHEN 'manual' THEN 'Manual CRM'
        WHEN 'zapier' THEN 'Imported'
        WHEN 'facebook' THEN 'Social'
        ELSE 'Unknown'
      END AS contact_method,
      o.amount
    FROM opp o
  )
  SELECT
    m.property_id,
    m.won_day,
    m.ad_source,
    m.contact_method,
    count(*)::bigint AS wins,
    COALESCE(sum(m.amount), 0)::numeric AS revenue
  FROM mapped m
  GROUP BY 1, 2, 3, 4;
END;
$function$
```

## 4.5 Speed to lead — `lead_perf_speed` (full definition) [DB]

```sql
CREATE OR REPLACE FUNCTION public.lead_perf_speed(_property_ids uuid[], _from timestamptz, _to timestamptz)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  _active_window int;
  _result jsonb;
BEGIN
  PERFORM public.lead_perf_check_access(_property_ids);

  SELECT COALESCE(MIN(COALESCE(pss.active_window_days, asd.active_window_days)), 30)
    INTO _active_window
  FROM public.agency_sla_defaults asd
  LEFT JOIN public.property_sla_settings pss
    ON _property_ids IS NOT NULL AND pss.property_id = ANY(_property_ids);

  WITH facts AS (
    SELECT *,
      EXTRACT(EPOCH FROM (first_human_outbound_at - lead_created_at)) AS outbound_response_seconds,
      EXTRACT(EPOCH FROM (first_human_engagement_at - lead_created_at)) AS engagement_seconds
    FROM public.ghl_lead_facts lf
    WHERE lf.lead_created_at >= _from AND lf.lead_created_at <= _to
      AND (_property_ids IS NULL OR lf.property_id = ANY(_property_ids))
  ),
  speed AS (
    SELECT
      COUNT(*) AS total_leads,
      COUNT(*) FILTER (WHERE first_human_outbound_at IS NOT NULL) AS responded,
      COUNT(*) FILTER (WHERE first_human_outbound_at IS NULL) AS never_responded,
      COUNT(*) FILTER (WHERE first_human_answered_inbound_at IS NOT NULL AND first_human_outbound_at IS NULL) AS answered_inbound_only,
      COUNT(*) FILTER (WHERE outbound_response_seconds <= 60)  AS under_1m,
      COUNT(*) FILTER (WHERE outbound_response_seconds <= 300) AS under_5m,
      COUNT(*) FILTER (WHERE outbound_response_seconds <= 900) AS under_15m,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY outbound_response_seconds)
        FILTER (WHERE outbound_response_seconds IS NOT NULL) AS median_human_raw,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY human_speed_to_lead_seconds_business)
        FILTER (WHERE human_speed_to_lead_seconds_business IS NOT NULL AND first_human_outbound_at IS NOT NULL) AS median_human_business,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY engagement_seconds)
        FILTER (WHERE engagement_seconds IS NOT NULL) AS median_human_engagement,
      percentile_cont(0.5) WITHIN GROUP (
        ORDER BY EXTRACT(EPOCH FROM (first_automation_response_at - lead_created_at))
      ) FILTER (WHERE first_automation_response_at IS NOT NULL) AS median_automation,
      percentile_cont(0.5) WITHIN GROUP (
        ORDER BY EXTRACT(EPOCH FROM (first_ai_response_at - lead_created_at))
      ) FILTER (WHERE first_ai_response_at IS NOT NULL) AS median_ai
    FROM facts
  ),
  waiting AS (
    SELECT COUNT(*) AS currently_waiting
    FROM public.ghl_lead_facts lf
    WHERE lf.is_open = true
      AND lf.first_human_outbound_at IS NULL
      AND lf.lead_created_at >= now() - make_interval(days => _active_window)
      AND (_property_ids IS NULL OR lf.property_id = ANY(_property_ids))
  )
  SELECT jsonb_build_object(
    'total_leads', s.total_leads,
    'responded', s.responded,
    'never_responded', s.never_responded,
    'answered_inbound_only', s.answered_inbound_only,
    'pct_never_responded', CASE WHEN s.total_leads > 0 THEN ROUND(100.0 * s.never_responded / s.total_leads, 2) ELSE 0 END,
    'pct_under_1m',  CASE WHEN s.total_leads > 0 THEN ROUND(100.0 * s.under_1m  / s.total_leads, 2) ELSE 0 END,
    'pct_under_5m',  CASE WHEN s.total_leads > 0 THEN ROUND(100.0 * s.under_5m  / s.total_leads, 2) ELSE 0 END,
    'pct_under_15m', CASE WHEN s.total_leads > 0 THEN ROUND(100.0 * s.under_15m / s.total_leads, 2) ELSE 0 END,
    'median_human_raw_seconds', s.median_human_raw,
    'median_human_business_seconds', s.median_human_business,
    'median_human_engagement_seconds', s.median_human_engagement,
    'median_automation_seconds', s.median_automation,
    'median_ai_seconds', s.median_ai,
    'human_vs_automation_gap_seconds',
      CASE WHEN s.median_human_raw IS NOT NULL AND s.median_automation IS NOT NULL
        THEN s.median_human_raw - s.median_automation ELSE NULL END,
    'currently_waiting', w.currently_waiting,
    'active_window_days', _active_window,
    'metric_definition', 'human response = first outbound human follow-up; answered inbound calls are counted separately and are not speed-to-lead responses'
  ) INTO _result
  FROM speed s, waiting w;

  RETURN _result;
END;
$function$
```

`lead_perf_handling` and `lead_perf_quality` follow the same shape;
`handling` resolves `stale_after_hours`/`critical_stale_after_hours` from
`property_sla_settings` falling back to `agency_sla_defaults` (24/48), and
`quality` returns the eleven data-quality counters listed in §6.

## 4.6 Metric catalogue

| Metric | Formula | Computed in | Consumed by |
|---|---|---|---|
| Total Leads | `bad + good + projected` | `leadModel.ts:21` **and** `v_lead_counts_daily` (SQL) | Command KPIs, funnel, verdict, Dashboard |
| Quality numerator | `good + projected` | `leadModel.ts:24` + SQL view | verdict, rollup |
| Quality rate | `(good + projected) / total` | `leadModel.ts:27` + SQL view + `lead_quality_rollup` | Location Verdict, Portfolio Verdict |
| Quality tier | `<8` low-sample; `≥.55` green; `≥.45` amber; else red | `leadModel.ts:51-56` | Verdict cards |
| CPL | `spend / totalLeads` | `scopedMetrics.ts:9`, `metrics.ts:77`, `data-sources.ts:44`, `lead_quality_rollup` (SQL), inline `JourneyFunnel.tsx:45-48` | Funnel, Dashboard |
| CPGL | `spend / good` (TS) **vs** `spend / (good+projected)` (SQL + funnel) | `scopedMetrics.ts:14`, `data-sources.ts:42`, SQL rollup, `JourneyFunnel.tsx` | Funnel, Dashboard |
| CTR / CPC / CPM | standard | `metrics.ts:78-79`, `scopedMetrics.ts:4,19`, `data-sources.ts:47-49` | Dashboard |
| Records | `daily_metrics.record_count` summed | `v_lead_counts_daily` → `useCommandData.ts:127-133` | Command "Records" KPI, funnel top |
| Verified Sale / Sales | count of `ghl_opportunities` where `status='won'`, bucketed by local day of `won_at` | `verified-sales.ts:13-52` | Command KPI, Sale Records, Runway, Heatmap |
| Media Efficiency Ratio | `blendedTotalLeads / ppcTotalLeads` | `JourneyFunnel.tsx:54` | Funnel |
| Revenue Runway target | `(baselineGoodLeads/30 × targetPeriodDays) × 0.3 × avgDealValue` | `verified-sales.ts:475-486` | Revenue Runway |
| Revenue forecast | `closedToDate + (goodLeadDailyRate × remainingDays × 0.3 × avgDealValue)` | `verified-sales.ts:580-584` | Revenue Runway |
| Avg deal value | mean of won `monetary_value` over 90d, expanding to 180d, min n=20 | `verified-sales.ts:401-435` | Revenue Runway |
| Budget pace | `spend / monthlyBudget`; projection `spend + avg(last 5 days) × daysRemaining` | `BudgetPacing.tsx:133-134,206-230` | Budget Pacing |
| Speed to lead (all variants) | see §4.5 | `lead_perf_speed` SQL | Lead Performance, Command Top Opportunities |
| Stale / critical stale | open lead whose `last_human_activity_at` (fallback `lead_created_at`) is older than 24h / 48h | `lead_perf_handling` SQL | Lead Performance |
| Attributed wins by source | see §4.4 | `ghl_won_attribution` SQL | Call Tracking source table |
| Connector staleness | `hoursSinceLastSuccess > 24 → stale` | `ApiHealth.tsx:58` **and** `AdminDataSources.tsx:61` | Admin health, source panel |

## 4.7 Thresholds, tiers, colors — where the constants live

See the full table in §7. Colors for quality tiers live in `leadModel.ts:62-73`
(`TIER_TEXT`, `TIER_DOT`); verdict colors are re-declared in
`PortfolioVerdict.tsx:41-45` (`statusClasses`) — a second color mapping for the
same three states.

## 4.8 Sample-size guards, suppression, empty states

- `< 8` leads → quality rate suppressed entirely; verdict forced to "good" with
  the reason "Low sample". [CODE — `PortfolioVerdict.tsx:51-56`]
- `8–14` leads → rate shown but tagged provisional; explicitly excluded from
  pass/fail. [CODE — `PortfolioVerdict.tsx:180,60-64`]
- Window shorter than 30 days **or** fewer than 15 leads → blue guidance banner
  telling the user to widen to 30 days. [CODE — `PortfolioVerdict.tsx:195-196`]
- `safeDelta` refuses to fabricate a percentage when the prior period is empty
  or when both periods are under 25. [CODE — `metrics.ts:63-73`]
- Avg deal value requires n ≥ 20 in 90 days, then n ≥ 20 in 180 days, else
  status `no_deal_value` and the target is not rendered. [CODE — `verified-sales.ts:427-435`]
- CTM coverage statuses (`ok / confirmed_zero / partial_coverage / missing_data`)
  gate whether Revenue Runway shows a target at all. [CODE — `verified-sales.ts:259,323-327`]
- "Improve Lead Quality" opportunity only fires at `base ≥ 15`. [CODE — `TopOpportunities.tsx:44-53`]

## 4.9 Duplicate computations — drift risks

1. **CPL/CPGL/CTR/CPC exist in three unlinked TS modules** — `metrics.ts:76-79`,
   `scopedMetrics.ts:4-22`, `data-sources.ts:40-49`. Different null handling
   (`null` vs `0`) and different names for the same ratio. None imports another.
2. **CPGL has two different denominators** — `good` in
   `scopedMetrics.ts:14`/`data-sources.ts:42`, versus `good + projected` in
   `lead_quality_rollup` (SQL) and `JourneyFunnel.tsx:45-48`. **These produce
   different numbers on the same data.**
3. **Quality aggregation re-implemented inside `PortfolioVerdict.tsx`** — the
   portfolio-benchmark query at `:93-125` sums `good/bad/projected` by hand
   instead of calling `canonicalQualityRate`, while the per-property loop at
   `:142-163` does use the canonical helpers. Two paths in one file.
4. **"Sales" means two different things by role** — owner view shows
   `active.sales`, everyone else shows `active.revenue`. Flagged in-code at
   `useCommandData.ts:188-191`. [CODE — `Command.tsx:132-156`]
5. **24-hour staleness rule duplicated verbatim** in `ApiHealth.tsx:58` and
   `AdminDataSources.tsx:61`.
6. **Percent-change formula duplicated** — `metrics.ts:pctChange` vs the inline
   `(count - avg)/avg × 100` in `SalesDayDrawer.tsx:21-22`.
7. **Verdict color mapping duplicated** — `leadModel.ts` tier colors vs
   `PortfolioVerdict.tsx:41-45`.
8. **Campaign-label filtering implemented twice** inside one file —
   `useCommandData.ts:72-86` (business) and `:208-229` (ads), with subtly
   different semantics: business builds a per-property map, ads flattens to one
   set across all scoped properties.

---

# 5. RULES AND DECISIONS LOCKED IN

## 5.1 The canonical lead model

**Rule.** Every real lead falls into exactly one of three mutually exclusive
tiers: **bad**, **good**, **sales (`projected_sale`)**. `spam` and `no_entry` are
*not* leads and sit outside the total. `projected` is never nested inside `good`,
never subtracted, and is not a forecast despite the column name.
**Total Leads = bad + good + projected. Quality = (good + projected) ÷ total.**

**Reasoning.** Sales are a quality outcome, so excluding them from the numerator
would penalize a location for converting. Nesting them inside `good` would
double-count.

**Documented in code:** `src/lib/leadModel.ts:1-30` (module docstring), mirrored
in SQL by `v_lead_counts_daily` and `lead_quality_rollup`. Strong. [CODE]

## 5.2 Quality thresholds and sample guards

Green ≥ 55%, amber ≥ 45%, else red. Absolute and fixed — deliberately **not**
derived from any single location, so no location becomes the de-facto benchmark.
Suppress below 8 leads; caveat between 8 and 14.
**Documented in code:** `leadModel.ts:33-56` with reasoning in comments. [CODE]

## 5.3 Ratio-of-sums

Always sum numerator and denominator across scope, then divide. Never average
per-row rates. **Documented in code:** `scopedMetrics.ts:1-2`. [CODE]

## 5.4 Unattributable numbers never render as confident figures

**Rule.** A number that cannot be traced to a real record must not be displayed
as if it were certain. No imputation, no defaulting to zero when zero would read
as a real result.

**Enforced in these places [CODE]:**
- `safeDelta` returns `no-prior` / `low-sample` instead of a fake percentage
  (`metrics.ts:57-73`).
- Quality rate suppressed below 8 leads; provisional between 8 and 14
  (`PortfolioVerdict.tsx:51-64`).
- Revenue Runway refuses to render a target when deal-value sample is under 20
  or CTM coverage is `missing_data` (`verified-sales.ts:427-435`, `:259`).
- Deal-value averaging excludes refunded/cancelled/duplicate/`≤0` records
  (`verified-sales.ts:401-407`).
- `lead_quality_rollup` returns `NULL`, not `0`, when the denominator is zero.

**Extensions agreed but NOT yet implemented [RECALL]:** revenue must be labeled
a *floor* wherever amount coverage is below 80%; where coverage is 0%
(Colorado Springs) it must read "No deal values recorded" and never `$0`;
expected value must be shown in **wins** rather than dollars below 80% coverage.
**None of this exists in code today.**

## 5.5 Disqualification tags

Configured in the **global** table `lead_perf_suppression_tags` (15 rows, not
per-property) [DB]:

`appointment booked`, `bad lead`, `bad number`, `booked`, `dnc`,
`do not contact`, `duplicate`, `enrolled`, `existing customer`,
`invalid number`, `not interested`, `sold`, `spam`, `test`, `wrong number`

All 15 have `disqualifies = true`. Matching is via `normalize_tag()`; the effect
lands on `ghl_lead_facts.is_disqualified`,
`suppresses_needs_first_response_by_tag`, and `disqualification_reason`, all
written by `rebuild_lead_facts()`.

**Known defect [RECALL, consistent with the DB contents]:** `sold` and
`booked` — successful outcomes — disqualify a lead, which removes converted
leads from denominators and can inflate close rates. Identified in audit,
**not yet fixed**.

## 5.6 CTM ↔ GHL attribution and reconciliation

- CTM classifies each call into a quality bucket via
  `property_call_score_mappings` and writes the aggregate into `daily_metrics`.
  This is the **only** source of good/bad lead counts.
- GHL supplies the CRM pipeline and the wins. `ghl_won_attribution` maps each win
  back to a media source using the GHL attribution blob — gclid/gbraid/wbraid or
  `utmSessionSource='Paid Search'` → Google PPC, and so on; everything else is
  `Unattributed`. [DB, §4.4]
- In the UI, `UNATTRIBUTED_SOURCE = "Unattributed"` is rolled up into
  `UNATTRIBUTED_ROLLUP_SOURCE = "Google PPC"` for display. [CODE —
  `verified-sales.ts:185-187`] This is a deliberate, and debatable, choice: wins
  we cannot attribute are shown as paid-search wins.
- **KPI reconciliation rule:** the Command header KPIs must match the source
  breakdown below them. Two exclusions implement this: `ad_source = 'GHL Won'`
  is excluded, and PPC rows are filtered against `campaign_labels` for shared ad
  accounts (NoVA, Winchester). [CODE — `useCommandData.ts:60-118`; RECALL: this
  was the fix for "194 vs 85 good leads" on NoVA]

## 5.7 Timezone rule

Sales are bucketed by **local calendar day**, using `localDayKey` /
`localDayBoundaryIso`, so a query's UTC boundaries cover the full local day.
[CODE — `verified-sales.ts:13-19`] [RECALL: introduced to fix "4 sold on July 10
in the table, 1 on the heatmap"]. The SQL side does the equivalent with
`won_at AT TIME ZONE properties.timezone`. **Undermined by all seven properties
carrying `America/New_York` regardless of actual location** (§8).

## 5.8 Sync failure policy

Any failed sync retries until it succeeds — recovery attempts every ~2 minutes —
then reverts to the normal cadence of every 4 hours. [RECALL: explicit
instruction] [CODE: `resync-failed` header and eligibility logic support this;
the actual cron registration is unverified, §9.]

## 5.9 Decisions made and then reversed [RECALL]

- **Imputing missing deal values** — proposed, **rejected**. Imputed dollars on a
  revenue card violate §5.4.
- **Restricting revenue to wins-that-have-amounts** — proposed, **rejected**,
  because it zeroes out Colorado Springs entirely (0% coverage).
- **Resolution:** split *conversion pace* (count-based, immune to missing
  amounts, drives the verdict) from *revenue* (actual recorded amounts only,
  displayed with a coverage statement, never drives the verdict).
- **Growth targets and benchmark close rates on the new card** — **rejected**.
  Every location is measured only against its own historical behavior. The card
  is to be renamed **Opportunity Conversion**. Note the current, still-live
  Revenue Runway card *does* use a hardcoded `BENCHMARK_CLOSE_RATE = 0.3`
  (`verified-sales.ts:257`), which directly contradicts this decision — the card
  was never replaced.
- **Retiring `sheet_sales`** — proposed, **blocked**: MoCo has no GHL connection,
  so the sheet is MoCo's only revenue source.
- **Win classification tiers (approved, not built):** VERIFIED (has stage history
  or contact activity) · IMPORTED (no signals but part of a dated import cluster;
  counts toward pace and close rate, never seeds the closure curve) · SUSPECT
  (no signals, no cluster, or created-to-won under 5 minutes; excluded from all
  numerators). The tier filter must be applied **symmetrically** to both the
  historical close-rate numerator and current wins. Plus an
  observability-horizon clause, because message history only starts 2026-05-14.
- **Central Illinois** — approved for full suppression with an "Not enough
  reliable data to model this location." empty state. Not built.
- **Deterministic duplicate resolution (approved, not built):** prefer VERIFIED,
  then assigned owner, then non-zero amount, then earliest `ghl_created_at`.

**Documentation status:** §5.1–5.4 and 5.7 are documented in code comments.
§5.5's defect, §5.6's rollup rationale, §5.8, and all of §5.9 exist **only in
conversation** — this file is now their only written home.

---

# 6. PAGES AND COMPONENTS

Routes are declared in `src/App.tsx`; navigation in
`src/components/layout/Sidebar.tsx`. [CODE]

| Route | Page | Shows | Reads | Scope modes | State |
|---|---|---|---|---|---|
| `/command` | `Command` | Executive Overview: 4 KPI spark cards, Journey Funnel, Portfolio/Location Verdict, then either owner performance cards + Top Opportunities, or the merged Dashboard+CallTracking report | `useCommandData` (`daily_metrics`, `v_lead_counts_daily`, `campaign_labels`, `ctm_calls`), `useSpeed` RPC, `verified-sales` | portfolio + single property; **Business/Ads toggle is owner-only** | Live |
| `/dashboard` | `Dashboard` ("PPC Overview") | Cost/impressions, CTR/clicks, conversions, by-source cost-per-good-lead | `daily_metrics` via `DashboardContext`, `useVerifiedSalesTotal` | **single property only** — falls back to the first property in agency mode | Live |
| `/calls` | `CallTracking` | Call KPIs, source outcome table with attributed wins | `ctm_calls`, `daily_metrics`, `ghl_won_attribution` | portfolio + property | Live |
| `/lead-performance` | `LeadPerformance` | Executive Scoreboard, Action Queue, Speed-to-Lead table, Pipeline Conversion, Agent Leaderboard, Operations Breakdown, Data Quality rail | `lead_perf_*` RPCs only | portfolio + property | Live; MoCo always empty |
| `/budget` | `BudgetPacing` | Monthly budget vs spend, pace, projection | `budget_accounts`, `daily_metrics`, `campaign_budgets`, `campaign_labels` | portfolio + property | Live; self-heals missing rows |
| `/sales` | `SaleRecords` | Sales Cadence heatmap, Revenue Runway, sortable records table with CSV export | `verified-sales` → `ghl_opportunities` + `ghl_contacts` | portfolio + property, date-range driven | Live; Runway pending replacement |
| `/keywords` | `Keywords` | Keyword rankings | `keyword_rankings` | property | **Live UI, zero data** |
| `/reports` | `Reports` | Report generation/listing | — | — | Live |
| `/assistant` | `Assistant` (Jarvis) | AI chat + generated reports | `ai_agent_*`, `ai_assistant_context()` | — | Live |
| `/properties/:slug` | `PropertyPage` | Single-property drilldown | — | property | Live |
| `/report/:token` | `PublicReport` | Client-facing token report | `*_by_report_token` RPCs | token-scoped | Live |
| `/login`, `/reset-password`, `/change-password` | auth pages | — | `user_security`, `set-own-password` fn | — | Live |
| `/admin/properties` | `AdminProperties` | Property CRUD + delete | `properties` + related | staff | Live |
| `/admin/users` | `AdminUsers` | User CRUD, invites, resend | `admin-users` fn | super_admin | Live |
| `/admin/data-sources` | `AdminDataSources` | Connector health, manual sync, historical backfill | `get_api_health_summary`, `ghl-backfill` | super_admin | Live |
| `/admin/google-sheets` | `AdminGoogleSheets` | Spreadsheet + tab mapping | `sheet_sync_config`, `properties.google_sheet_tab` | super_admin | Live |
| `/admin/pipeline-mapping` | `AdminPipelineMapping` | Confirm stage → canonical stage | `property_pipeline_mapping` | super_admin | Live; **0 of 218 confirmed** |
| `/admin/sla-settings` | `AdminSlaSettings` | SLA thresholds per property | `property_sla_settings` | super_admin | Live; **0 rows saved** |
| `/admin/settings` | `AdminSettings` | Misc settings | — | super_admin | Live |
| `/admin/client-reports` | `AdminClientReports` | Client report builder | — | staff | Live |

## Card inventory

**`src/components/command/`** — `KpiSparkCard` (value + delta + sparkline + a
`sourceTable` provenance tooltip), `JourneyFunnel` (funnel stages, MER, sub-KPIs
with target ratios), `PortfolioVerdict` (agency rollup table, or single-location
verdict with the 30-day guidance banner), `PerformanceCards`
(`CallHandlingCard`, `MissedCallFollowUpCard`, `CallQualityCard` — owner-only,
CTM-based), `TopOpportunities` (ranked action list), `PendingCard`.

**`src/components/lead-perf/`** — `ExecutiveScoreboard`, `ActionQueue`,
`SpeedToLeadTable`, `PipelineConversion`, `AgentLeaderboard`,
`OperationsBreakdown`, `DataQualityRail`, `DrillSheet`, `KpiTile`, `StatusPill`.
All render `lead_perf_*` RPC output; none computes its own aggregates.

**`src/components/sales/`** — `SalesHeatmap` (adaptive: monthly calendar for
7–31 days, rolling weeks for 32–120, compact annual beyond; Won-count vs Revenue
metric switch; month pager), `RevenueRunway`, `SalesDayDrawer`.

**`src/components/dashboard/`** — `KpiCard`, `ChartCard`, `DualAxisChart`,
`MultiLineChart`, `AccountStability`, `AccountChangeHistory`, `SectionDivider`.

**`src/components/layout/`** — `AppShell`, `TopBar`, `Sidebar`, `ScopeSelector`,
`PropertySwitcher`, `DateRangePicker`, `SourceHealthPanel`, `PublicShell`,
`AuthShell`, `PublicReportToolbar`.

---

# 7. CONFIGURATION

## 7.1 Config tables (properly configurable)

| Setting | Table | Current state |
|---|---|---|
| CPL / CPGL targets, monthly budget, good-lead goal | `property_targets` | 5 rows; **Central IL and DFW missing** |
| Monthly budget (pacing) | `budget_accounts` | 7 rows |
| Call score → quality bucket | `property_call_score_mappings` | 42 rows |
| Stage → canonical stage | `property_pipeline_mapping` | 218 rows, 0 confirmed |
| Disqualifying tags | `lead_perf_suppression_tags` | 15 rows, global |
| SLA global defaults | `agency_sla_defaults` | 1 row |
| SLA per-property overrides | `property_sla_settings` | **0 rows** |
| Campaign allow-list for shared ad accounts | `campaign_labels` | 5 rows (NoVA, Winchester) |
| Spreadsheet id / tab mapping | `sheet_sync_config`, `properties.google_sheet_tab` | 1 + 4 tabs |
| Metric labels / hidden metrics per property | `properties.metric_labels`, `hidden_metrics` | jsonb |

## 7.2 Hardcoded constants

**⚑ = should be configurable but is not.**

| Value | Meaning | Location |
|---|---|---|
| 0.55 / 0.45 | Quality tier green / amber | `leadModel.ts:33` |
| 8 | Low-sample suppression floor | `leadModel.ts:40` |
| 15 | Low-sample caveat floor | `leadModel.ts:47` |
| **0.3** ⚑ | Benchmark close rate, Revenue Runway | `verified-sales.ts:257` — contradicts §5.9 |
| 30 days | Good-lead baseline lookback | `verified-sales.ts:346-351` |
| 90 / 180 days ⚑ | Avg deal-value window, then expanded window | `verified-sales.ts:427-433` |
| 20 | Min n for avg deal value | `verified-sales.ts:430,434` |
| 5 min | React-Query staleTime for deal value | `verified-sales.ts:437` |
| 25 | `safeDelta` min base before showing % | `metrics.ts:69` |
| 200 / 400 ⚑ | Default CPL / CPGL when no targets row | `useCommandData.ts:46-47` |
| 0.45 / 0.4 / 1000 ⚑ | Default quality rate, projection rate, cost-per-projected — **`qualRate` and `projectionRate` stay hardcoded even when a `property_targets` row exists** | `useCommandData.ts:48-50,157-158` |
| 1.35 ⚑ | Amber cutoff for cost-metric ratio to target | `JourneyFunnel.tsx:264` |
| 0.2 ⚑ | Good-lead-share pass threshold | `JourneyFunnel.tsx:159` |
| 30 / 15 | Window-guidance banner triggers | `PortfolioVerdict.tsx:195-196` |
| 60% / 30% ⚑ | Speed-to-lead 5-minute targets | `TopOpportunities.tsx:56,59` |
| 10% / 25% ⚑ | Never-responded warn / critical | `TopOpportunities.tsx:65,68` |
| 0.6× ⚑ | Critical sales-rate multiplier | `TopOpportunities.tsx:80` |
| 24h | Data-integrity sync lookback | `TopOpportunities.tsx:95` |
| **24h ⚑ (×2)** | Connector "stale" threshold, duplicated | `ApiHealth.tsx:58`, `AdminDataSources.tsx:61` |
| 50% / 20%, 4h, 1h/15m, 60/30 ⚑ | Executive Scoreboard verdict + tile tones | `ExecutiveScoreboard.tsx:49-50,67,72,77` |
| 0.05 / 0.15 / 0.3 ⚑ | Budget pace color bands | `BudgetPacing.tsx:37-39` |
| 5 days ⚑ | Trailing-average window for spend projection | `BudgetPacing.tsx:133-134,206-221` |
| 300000 ms | Change-event clustering bucket | `AccountStability.tsx:225` |
| 7 / 30 days | Google Ads default window, GHL/CTM default window | `sync-google-ads:108`, `sync-ghl:252`, `sync-ctm:139` |
| 30 days | Window the orchestrator forces on all children | `scheduled-sync-all:53-54` |
| 730 days | Backfill default start | `ghl-backfill:127` |
| 90s / 300s | Per-invoke and per-pair sync timeouts | `scheduled-sync-all:78-81` |
| `[0, 30s, 120s]` | Retry waits | `scheduled-sync-all:77`, `resync-failed:32` |
| 5 min / 5h / 10 | Stuck-run threshold, missed-cycle threshold, candidates per tick | `resync-failed:32-37,92-124` |
| All `MAX_*` GHL page caps | See §2.2 | `sync-ghl:19-29` |
| 8 req/s | GHL rate limit | `sync-ghl:19` |
| 150 / page 50 | CTM page size and hard page cap | `sync-ctm:179-199` |
| `A1:Z10000` | Sheet read range | `sync-sheet-sales:93` |
| `"Google PPC"` | Hardcoded ad_source string in Google Ads sync and in ≥6 UI files | `sync-google-ads:235`, `useCommandData.ts:54`, others |
| `["Facebook","Direct","Google PPC","Organic"]` | Sources always rendered even at $0 | `Dashboard.tsx:20` |

## 7.3 Secrets / environment

Named in code but never read in this session: `CRON_SECRET`, `SERVICE_KEY`
(service role), `GA4_SERVICE_ACCOUNT_JSON`, `LOVABLE_API_KEY`,
`GOOGLE_SHEETS_API_KEY`, Google Ads OAuth client credentials, plus per-property
`property_data_sources.refresh_token` / `secret_token` stored in the database.
A vault-backed `get_cron_secret_v2()` provides the cron secret. [CODE]

---

# 8. KNOWN ISSUES

"Affecting displayed numbers" = does a user see a wrong number today.

## Critical — currently affecting displayed numbers

1. **MoCo has no GHL connection.** [DB] `property_data_sources` has only `ctm`
   and `google_ads` for MoCo. Consequences: 0 `ghl_lead_facts`, 0
   `ghl_opportunities`, therefore **0 verified sales and a completely blank Lead
   Performance page** for MoCo, against 163 good leads in `daily_metrics`.
   MoCo's only revenue source is the `MOCO 2026` sheet tab (20 rows, $21,930).
   **Affecting numbers: yes, severely.**

2. **$0 win amounts.** [DB] Amount coverage by property:

   | Property | Wins | With amount | Coverage | Recorded revenue |
   |---|---|---|---|---|
   | Colorado Springs | 40 | 0 | **0.0%** | $0 |
   | Central IL | 16 | 3 | **18.8%** | $2,330 |
   | Winchester | 639 | 399 | 62.4% | $1,004,540 |
   | NoVA | 628 | 540 | 86.0% | $756,880 |
   | Ashtabula | 137 | 118 | 86.1% | $141,518 |
   | DFW | 84 | 78 | 92.9% | $210,784 |

   Colorado Springs currently renders **$0 revenue**, which reads as "no sales"
   and is false. The agreed fix (floor labeling, coverage statement, "No deal
   values recorded") is **not implemented**. [RECALL: missingness is not random —
   Winchester shows a regime cliff around Nov 2025; blanks correlate with
   deleted/unassigned users; the value is not recoverable from the GHL `raw`
   payload.] **Affecting numbers: yes.**

3. **Unassigned wins.** [DB] Colorado Springs 40/40, Winchester 454/639,
   DFW 76/84, NoVA 173/628, Ashtabula 11/137, Central IL 0/16. [RECALL: the
   evidence splits three ways — CO Springs unassigned wins look real, DFW's are
   backfill imports, and Winchester/NoVA contain "instant won" records created
   and won within five minutes.] The three-tier filter is approved but
   **not built**, so all of these currently count. **Affecting numbers: yes.**

4. **Bulk-stamped won dates.** Root cause is in code:
   `won_at = lastStatusChangeAt ?? lastStageChangeAt ?? updatedAt`
   (`sync-ghl:624-625`). A bulk GHL edit rewrites `updatedAt`, so many wins land
   on one artificial day. [RECALL: Central IL has 12 of 13 zero-value wins
   stamped inside a single 7-minute window; DFW's dates are bulk-stamped despite
   93% amount coverage.] This distorts the Sales Cadence heatmap and any
   cycle-time model. **Affecting numbers: yes.**

5. **All seven properties are set to `America/New_York`,** including DFW
   (Central) and Central IL (Central). [DB] Every local-day bucketing rule —
   `localDayKey` in TypeScript and `AT TIME ZONE properties.timezone` in
   `ghl_won_attribution` — is therefore wrong by one hour of boundary for those
   two. **Affecting numbers: yes, at day boundaries.**

6. **CPGL is defined two different ways** — `spend / good` in TS helpers versus
   `spend / (good + projected)` in SQL and the funnel. Different pages can show
   different CPGL for the same data. **Affecting numbers: yes.** (§4.9)

7. **`sync-ctm` zeroes the whole date range before re-upserting**, outside any
   transaction (`sync-ctm:330-335`). A failure after the zero-out leaves a
   silently zeroed range. **Affecting numbers: intermittently, and invisibly.**

8. **GHL sync is failing continuously.** [DB] Last 24h: 61 successes, 1 failure,
   **6 runs stuck in `running`**. Recent errors include
   `invoke timeout after 90000ms` (Ashtabula, Central IL) and, for DFW,
   `conversations_messages: upsert ghl_messages: invalid input syntax for type json`
   repeated four times. `resync_failed` has logged 1,513 GHL attempts since
   2026-07-13 versus 252 for CTM. Stuck `running` rows go back to 2026-08-08.
   Because `sync-ghl` keeps `status='connected'` on failure, the UI does not
   surface this. **Affecting numbers: yes — CRM data is silently incomplete.**

9. **`sheet_sales` is stale.** [DB] Max `sale_date` 2026-07-06; the sync still
   runs. [RECALL: humans stopped updating the spreadsheet; it is not a sync
   failure.] Anything reading `sheet_sales` — including the owner-view "Sales"
   KPI — under-reports after 2026-07-06. **Affecting numbers: yes.**

## Resolved but worth recording

10. **`sheet_sales` Colorado Springs duplication — FIXED.** [RECALL, with [DB]
    confirmation of the current state] Colorado Springs' `google_sheet_tab` was
    set to `Winchester 2026`, importing 101 Winchester rows a second time under
    CO Springs and double-counting $214,190 in portfolio totals. 101 rows were
    deleted, the tab was nulled, and a unique partial index
    `properties_google_sheet_tab_unique` now prevents tab collisions. Current
    `sheet_sales` [DB]: NoVA 194 / $236,690 · Winchester 101 / $214,190 ·
    Ashtabula 23 / $34,770 · MoCo 20 / $21,930 = 338 rows. CO Springs: none.
    **The underlying hash defect remains** — `source_row_hash` does not include
    the property, so the same person on two tabs still collides. One residual
    case is known: "Kayla Davis" $1,440 on 2026-06-10 appears on both the
    Winchester and NoVA tabs; the operator has not yet said which is correct.

## Structural / dead code

11. **`sync-ga4` and `sync-keyword-com` are dead** — both write `client_id` and
    read `client_data_sources`, none of which exist. The `/keywords` page shows
    nothing. **Affecting numbers: no, they show nothing at all.**
12. **Zero of 218 pipeline stage mappings are user-confirmed.** [DB]
    `lead_perf_quality.unmapped_stages` counts only confirmed mappings, so it
    currently reports every stage as unmapped. **Affecting numbers: yes, on the
    Data Quality rail.**
13. **`property_settings`, `property_business_hours`, `ghl_tasks` are empty
    tables.** `agency_sla_defaults.business_hours_only = true` while
    `property_business_hours` has zero rows — so business-hours-adjusted
    speed-to-lead has no hours to work from. [DB] **Affecting numbers: likely,
    for `human_speed_to_lead_seconds_business`. Unverified — see §9.**
14. **`property_sla_settings` is empty**, so every SLA number comes from the
    single global row. The admin UI default for `attempts_7d` is 6 while the DB
    holds 5. [CODE vs DB]
15. **Legacy `GHL Won` ad_source rows** (113 rows, ending 2026-06-25) still sit
    in `daily_metrics`. Command excludes them; other surfaces may not.
    **Affecting numbers: possibly, outside Command.**
16. **`sync-ghl` has no role guard** while every sibling sync does. [CODE]
17. **`google-ads-change-history` accepts any authenticated user** with no role
    check. [CODE :44-56]
18. **Deprecated context exports** in `PropertyContext` and `PreviewModeContext`
    are still live and consumed by legacy components. [CODE]
19. **`ctm_call_id` falls back to a random UUID** when CTM supplies none, which
    will duplicate that call on every subsequent sync. [CODE :237]
20. **Google Ads budget/label snapshots delete-then-insert with swallowed
    errors** — a failed insert leaves the snapshot empty. [CODE]
21. **`ghl-backfill` aborts its resumable chain on any error** (returns
    `next: null`), so a transient failure requires restarting the backfill.
22. **Central IL has no `property_targets` row**, and neither does DFW, so both
    silently fall back to the hardcoded 200/400 defaults. [DB]

## Approved work not yet built [RECALL]

23. Opportunity Conversion card (replacing Revenue Runway).
24. $0-win data-quality guard and per-location operational counter.
25. Excluded-win (SUSPECT) counter.
26. Central Illinois "Not enough reliable data to model this location."
    suppression.
27. Three-tier win classification and symmetric application to close rate.
28. Lead-side behavioral validation (import-cluster detection).
29. Deterministic duplicate resolution ordering.
30. Regime-change caps on `ownCloseRate` (Winchester ~Nov–Dec 2025;
    Ashtabula ~Feb 2026, a sustained ~8-point drop).

### Three decisions still open [RECALL]

- The observability-horizon clause for tier classification (would reclassify
  Ashtabula's 97 and Winchester's 196 wins from SUSPECT to IMPORTED).
- Ashtabula 2025-08 and 2026-04: exclude the 150 flagged leads, or keep them.
- The stray Kayla Davis row: Winchester or NoVA.

---

# 9. WHAT I DO NOT KNOW

Stated plainly, not guessed.

1. **The live cron schedule.** `cron.job` is permission-denied for this
   connection and `get_sync_cron_schedule()` is too. I inferred a ~4-hour
   cadence from `sync_runs` timestamps. I cannot confirm that
   `resync-failed-every-2m` is actually registered and active.
2. **`rebuild_lead_facts()` internals.** 16.3 KB of PL/pgSQL that produces every
   column of `ghl_lead_facts` — the entire speed/handling/stale layer. I did not
   read its body this session. Its exact definitions of "human attempt",
   "meaningful activity", business-hours adjustment, and staleness are
   unverified.
3. **`lead_perf_drill` (10.3 KB) and `lead_perf_agents` (4.1 KB).** Not read.
   The Action Queue and Agent Leaderboard numbers are therefore undocumented here.
4. **Whether business-hours speed-to-lead works at all** given
   `property_business_hours` has zero rows. I did not trace what
   `rebuild_lead_facts` does when no hours exist.
5. **Pages not read line-by-line:** `Keywords.tsx`, `Reports.tsx`,
   `PropertyPage.tsx`, `CallTracking.tsx` (page), `SaleRecords.tsx`,
   `AdminSettings.tsx`, `AdminClientReports.tsx`, `AdminProperties.tsx`,
   `AdminUsers.tsx`, `Assistant.tsx`, plus `AccountStability.tsx`,
   `PerformanceCards.tsx`, `SalesHeatmap.tsx`, `OperationsBreakdown.tsx`,
   `PipelineConversion.tsx`, `DataQualityRail.tsx` in full. There are almost
   certainly more inline magic numbers in those files than §7 lists.
6. **The Jarvis / AI assistant stack.** `supabase/functions/jarvis`,
   `ai-assistant`, `ai_assistant_context()`, and the report schema were not
   examined. Which model, which prompts, and what it is allowed to assert are
   all unknown to me right now — and given rule §5.4, an AI surface that can
   state numbers deserves its own audit.
7. **RLS policy contents.** I have policy *counts* per table, not the policy
   expressions. I have not verified that viewer scoping is actually airtight.
8. **Migration history.** I read the live schema, not the migration files, so I
   cannot date when each table or function was introduced or changed.
9. **Backfill audit trail.** Only one run is logged as `trigger_source='backfill'`
   (2026-08-06). The Ashtabula history back to 2025-07 and the DFW history back
   to 2026-03 must have arrived some other way — earlier backfills before
   `trigger_source` existed, or GHL's own search window. I cannot reconstruct
   which, over what range, or when.
10. **Whether `sync-ctm`'s zero-out has ever actually corrupted a range.** The
    hazard is real in code; I did not search history for evidence it fired.
11. **Original intent behind several columns:** `daily_metrics.medicaid`,
    `no_entry` versus `spam` semantics, `properties.metric_labels` /
    `hidden_metrics` usage, and `ghl_events_raw`'s role (610 rows, no visible
    writer among the syncs I inventoried).
12. **Whether the "30-day sync" badge on Lead Performance reflects the configured
    `active_window_days` or is hardcoded copy.**
13. **Who the actual end users are by name/role**, how often they look at this,
    and which numbers they act on. I know the role model from code, not the
    human workflow.
14. **Anything from conversation before the visible history window.** Items
    marked [RECALL] come from a compacted summary, not a verbatim transcript.
    Specific figures inside [RECALL] passages — the 348/946/260 tier counts, the
    4,087 Ashtabula exclusions, the 889 DFW opportunities — were **not**
    re-verified in this session and should be re-derived before anyone builds
    against them.

---

## Maintenance checklist

When you change any of the following, update the named section here in the same
change:

- A sync function's fields, window, caps, or retry behavior → §2, §7.2
- A table, view, or SQL function → §3, and paste the new SQL into §4 if it feeds
  a displayed metric
- A formula, threshold, or tier → §4, §7
- A business rule or a reversed decision → §5
- A page or card → §6
- A bug found, fixed, or worked around → §8
- Something you looked into and still could not determine → §9
---

## §10 Change log (maintained going forward)

### 2026-08-10 — Phase 1, item 1 (GHL sync stability)

**Shipped**
- `sync-ghl`: added `sanitizeJson()` applied inside `upsertChunked()`. Strips
  `\u0000` and unpaired surrogates from every key/value before upsert. This was
  the cause of DFW's `invalid input syntax for type json` on `ghl_messages`
  (1,115 failed runs 2026-08-07 → 2026-08-08).
- `resync-failed`: added a **stuck-run reaper**. Any `sync_runs` row still
  `status='running'` 15 minutes after `started_at` is closed as `failure` with
  `error_message='stuck run reaped…'`, making the pair eligible for recovery.
- Data fix: the 6 runs stuck in `running` since 2026-08-08 were reaped.

**Reported, not implemented (awaiting approval)**
- Connection-state honesty mechanism for `property_data_sources.status`
  (proposal: add `degraded` + `consecutive_failures`/`last_success_at`).
- Timeout diagnosis: the 90s ceiling is `PER_INVOKE_TIMEOUT_MS` in
  `scheduled-sync-all`; the fix is reducing per-run work (phase splitting),
  not raising the ceiling.

**Cancelled by user (do not build):** three-tier win classification,
regime-change caps on `ownCloseRate`, import-cluster lead detection, anything
using days-to-close. All were derived from a failing sync and must be
re-derived after Phase 3.

**Decision (locked):** unattributed wins roll into "Google PPC". To be moved
behind a per-property config flag with a visible label on any card using it.
