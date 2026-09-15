# Read-only system audit — RSK9 Insights

All facts below were read from the live database and the repository on 2026-09-15. No files, migrations, functions, or data were changed.

---

## 1. Database schema

49 tables, all in `public`. Notation: `NN` = NOT NULL, `d=` = default. Approximate row counts are exact `count(*)` where shown.

### Source-of-data map

- **Google Ads data**: `daily_metrics` (cost/impressions/clicks rows with `ad_source = 'Google PPC'`), `campaign_budgets`, `campaign_labels`, `budget_accounts` (manually entered budgets), `property_data_sources` rows with `source='google_ads'`.
- **CallTrackingMetrics data**: `ctm_calls`, plus the lead-quality columns of `daily_metrics` (`record_count`, `leads`, `good_leads`, `bad_leads`, `spam`, `no_entry`, `projected_sale`, `verified_sale`, `medicaid`), `property_call_score_mappings`.
- **GoHighLevel data**: `ghl_contacts`, `ghl_opportunities`, `ghl_opportunities_retired`, `ghl_opportunity_stage_history`, `ghl_opportunity_miss_streaks`, `ghl_messages`, `ghl_appointments`, `ghl_tasks`, `ghl_users`, `ghl_pipelines`, `ghl_pipeline_stages`, `ghl_events_raw`, `ghl_lead_facts` (derived), `property_pipeline_mapping`, `metric_restatements`, `reconcile_runs`.
- **Properties / locations / accounts**: `properties` is the single location table. Related: `property_settings`, `property_targets`, `property_data_sources`, `property_sla_settings`, `property_business_hours`, `property_call_score_mappings`, `viewer_property_access`, `budget_accounts`.
- **GA4 / keyword.com**: code exists (`sync-ga4`, `sync-keyword-com`, tables `keyword_rankings`, `keyword_share_of_voice`) but **no connection rows exist and both tables are empty (0 rows)**.

### Tables

**agency_sla_defaults** — single-row agency-wide SLA defaults. 1 row.
`id boolean NN d=true | first_response_seconds integer NN d=300 | attempts_24h integer NN d=3 | attempts_7d integer NN d=5 | stale_after_hours integer NN d=24 | critical_stale_after_hours integer NN d=48 | business_hours_only boolean NN d=true | after_hours_mode text NN d='pause_until_open' | active_window_days integer NN d=30 | updated_at timestamptz NN d=now()`
PK (id). No FKs, no extra indexes.

**ai_agent_messages** — chat messages for the Bob assistant. 170 rows.
`id uuid NN d=gen_random_uuid() | session_id uuid NN | role text NN | content text | parts_json jsonb | tool_calls_json jsonb | evidence_json jsonb | created_at timestamptz NN d=now() | tool_backed boolean | tool_run_count integer NN d=0`
PK (id); FK session_id → ai_agent_sessions(id) ON DELETE CASCADE. Index `(session_id, created_at)`.

**ai_agent_reports** — saved assistant reports. 5 rows.
`id uuid NN d=gen_random_uuid() | user_id uuid NN | session_id uuid | property_id uuid | report_type text NN | title text NN | date_range_start date | date_range_end date | schema_json jsonb NN | evidence_json jsonb | saved boolean NN d=false | created_at timestamptz NN d=now() | scope_json jsonb | comparison_range_start date | comparison_range_end date | status_json jsonb | caveats_json jsonb | confidence_json jsonb | saved_at timestamptz | deleted_at timestamptz`
PK (id); FKs property_id → properties(id) CASCADE, session_id → ai_agent_sessions(id) SET NULL, user_id → auth.users(id) CASCADE. Indexes: `(property_id, created_at DESC)`; `(user_id, saved, created_at DESC) WHERE deleted_at IS NULL`; `(property_id, report_type, created_at DESC) WHERE deleted_at IS NULL`; `(user_id, created_at DESC)`.

**ai_agent_sessions** — assistant conversation sessions. 56 rows.
`id uuid NN d=gen_random_uuid() | user_id uuid NN | property_id uuid | title text | page_context text | date_range_start date | date_range_end date | status text NN d='active' | created_at timestamptz NN d=now() | updated_at timestamptz NN d=now()`
PK (id); FKs property_id → properties SET NULL, user_id → auth.users CASCADE. Index `(user_id, updated_at DESC)`.

**ai_agent_tool_runs** — tool-call log for the assistant. 113 rows.
`id uuid NN d=gen_random_uuid() | session_id uuid | tool_name text NN | input_json jsonb | output_json jsonb | status text NN d='success' | duration_ms integer | error_message text | created_at timestamptz NN d=now()`
PK (id); FK session_id → ai_agent_sessions CASCADE. Index `(session_id, created_at)`.

**budget_accounts** — manually maintained monthly budgets per label. 10 rows.
`id uuid NN d=gen_random_uuid() | property_id uuid NN | campaign_label text | notes text | monthly_budget numeric NN d=0 | sort_order integer NN d=0 | created_at timestamptz NN d=now() | updated_at timestamptz NN d=now()`
PK (id); FK property_id → properties CASCADE. Index `(property_id)`.

**campaign_budgets** — Google Ads daily budget snapshot. 39 rows, last synced 2026-09-15 18:18Z.
`id uuid NN d=gen_random_uuid() | property_id uuid NN | campaign text NN | daily_budget numeric NN d=0 | status text | synced_at timestamptz NN d=now()`
PK (id); UNIQUE (property_id, campaign); FK property_id → properties CASCADE. Index `(property_id)`.

**campaign_labels** — Google Ads campaign↔label map. 5 rows, last synced 2026-09-15 17:04Z.
`property_id uuid NN | campaign text NN | label_name text NN | synced_at timestamptz NN d=now()`
PK (property_id, campaign, label_name); FK property_id → properties CASCADE. Index `(property_id)`.

**ctm_calls** — CallTrackingMetrics call records. 4,176 rows, latest call 2026-09-15 17:11Z.
`id uuid NN d=gen_random_uuid() | property_id uuid NN | ctm_call_id text NN | called_at timestamptz NN | duration_seconds integer | tracking_source text | channel text | campaign_name text | ad_group text | caller_number text | call_score_label text | call_score_bucket text | raw_payload jsonb | synced_at timestamptz NN d=now()`
PK (id); UNIQUE (property_id, ctm_call_id); FK property_id → properties CASCADE. Indexes `(property_id, channel, called_at DESC)`, `(property_id, called_at DESC)`.

**daily_metrics** — one row per (location, day, ad source, campaign); holds both ad spend and lead-quality counts. 4,004 rows, latest date 2026-09-15.
`id uuid NN d=gen_random_uuid() | property_id uuid NN | date date NN | ad_source text NN | campaign text NN | cost numeric NN d=0 | impressions integer NN d=0 | clicks integer NN d=0 | record_count integer NN d=0 | no_entry integer NN d=0 | leads integer NN d=0 | good_leads integer NN d=0 | bad_leads integer NN d=0 | spam integer NN d=0 | projected_sale integer NN d=0 | medicaid integer NN d=0 | sessions integer NN d=0 | users integer NN d=0 | created_at timestamptz NN d=now() | verified_sale integer NN d=0`
PK (id); UNIQUE (property_id, date, ad_source, campaign); FK property_id → properties CASCADE. Index `(property_id, date)`.

**ghl_appointments** — CRM appointments. 1,213 rows.
`id uuid NN d=gen_random_uuid() | property_id uuid NN | ghl_event_id text NN | calendar_id text | contact_id text | opportunity_id text | assigned_user_id text | starts_at timestamptz | ends_at timestamptz | appointment_status ghl_appointment_status NN d='unknown' | appointment_status_raw text | status_is_derived boolean NN d=false | raw jsonb | created_at timestamptz NN d=now() | updated_at timestamptz NN d=now()`
PK (id); UNIQUE (property_id, ghl_event_id); FK property_id → properties CASCADE. Indexes on `(property_id)`, `(property_id, assigned_user_id)`, `(property_id, contact_id)`, `(property_id, opportunity_id)`, `(property_id, starts_at)`.

**ghl_contacts** — CRM contacts mirror. 31,116 rows.
`id uuid NN d=gen_random_uuid() | property_id uuid NN | ghl_location_id text NN | ghl_contact_id text NN | first_name text | last_name text | email text | phone text | source text | assigned_to text | tags ARRAY | pipeline_stage text | ghl_created_at timestamptz | first_response_at timestamptz | speed_to_lead_seconds integer | raw jsonb NN d='{}' | created_at timestamptz NN d=now() | updated_at timestamptz NN d=now() | first_human_response_at timestamptz | latest_human_response_at timestamptz | assigned_user_id text | has_opportunity boolean NN d=false | latest_opportunity_id text | duplicate_group_id text | retired_at timestamptz`
PK (id); UNIQUE (property_id, ghl_contact_id); FK property_id → properties CASCADE. Indexes `(property_id, assigned_user_id)`, `(property_id, duplicate_group_id)`, `(property_id) WHERE retired_at IS NULL`, `(property_id, ghl_created_at DESC)`.

**ghl_events_raw** — raw CRM payload archive. 610 rows.
`id uuid NN d=gen_random_uuid() | property_id uuid NN | ghl_location_id text NN | object_type text NN | ghl_object_id text NN | occurred_at timestamptz | raw jsonb NN | ingested_at timestamptz NN d=now()`
PK (id); UNIQUE (property_id, object_type, ghl_object_id); FK property_id → properties CASCADE. Index `(property_id, object_type, occurred_at DESC)`.

**ghl_lead_facts** — derived per-lead fact table driving Lead Performance. 31,527 rows, last updated 2026-09-15 19:02Z.
`id uuid NN d=gen_random_uuid() | property_id uuid NN | contact_id text NN | opportunity_id text | assigned_user_id text | pipeline_id text | stage_id text | canonical_stage ghl_canonical_stage | lead_created_at timestamptz NN | first_any_response_at timestamptz | first_human_response_at timestamptz | first_automation_response_at timestamptz | first_ai_response_at timestamptz | first_human_response_channel text | human_speed_to_lead_seconds_raw integer | human_speed_to_lead_seconds_business integer | human_attempt_count integer NN d=0 | automation_touch_count integer NN d=0 | ai_touch_count integer NN d=0 | total_touch_count integer NN d=0 | appointment_booked_at timestamptz | appointment_showed_at timestamptz | appointment_no_show_at timestamptz | won_at timestamptz | lost_at timestamptz | lost_reason_raw text | lost_reason_normalized text | monetary_value numeric | is_open boolean NN d=true | is_stale boolean NN d=false | last_human_activity_at timestamptz | last_activity_at timestamptz | created_at timestamptz NN d=now() | updated_at timestamptz NN d=now() | first_human_outbound_at timestamptz | first_human_answered_inbound_at timestamptz | first_human_engagement_at timestamptz | first_human_engagement_type text | human_call_duration_seconds integer | needs_first_response boolean NN d=true | handled_by_stage boolean NN d=false | needs_first_response_reason text | tag_names ARRAY | suppressing_tag_names ARRAY | suppresses_needs_first_response_by_tag boolean NN d=false | is_disqualified boolean NN d=false | disqualification_reason text | last_meaningful_activity_at timestamptz | last_meaningful_activity_type text | contact_record_updated_at timestamptz | last_synced_at timestamptz`
PK (id); UNIQUE (property_id, contact_id, opportunity_id); FK property_id → properties CASCADE. Indexes `(property_id)`, `(property_id, assigned_user_id)`, `(property_id, contact_id)`, `(property_id, is_open)`, `(property_id, lead_created_at DESC)`, `(property_id, canonical_stage)`, `(property_id, is_stale)`.

**ghl_messages** — CRM conversation messages. 441,576 rows (largest table), latest 2026-09-15 18:57Z.
`id uuid NN d=gen_random_uuid() | property_id uuid NN | ghl_message_id text NN | conversation_id text | contact_id text | direction text | channel text | message_type text | ghl_user_id text | response_source ghl_response_source NN d='unknown' | source_raw text | sent_at timestamptz | body_preview text | meta jsonb | raw jsonb | created_at timestamptz NN d=now() | updated_at timestamptz NN d=now()`
PK (id); UNIQUE (property_id, ghl_message_id); FK property_id → properties CASCADE. Indexes `(property_id)`, `(property_id, contact_id)`, `(property_id, response_source)`, `(property_id, sent_at)`, `(property_id, ghl_user_id)`.

**ghl_opportunities** — CRM opportunities/deals. 22,234 rows, latest update 2026-09-15 18:56Z.
`id uuid NN d=gen_random_uuid() | property_id uuid NN | ghl_opportunity_id text NN | contact_id text | pipeline_id text | stage_id text | status ghl_opportunity_status NN d='unknown' | status_raw text | monetary_value numeric | assigned_to text | lost_reason_raw text | lost_reason_normalized text | won_at timestamptz | lost_at timestamptz | ghl_created_at timestamptz | ghl_updated_at timestamptz | raw jsonb | created_at timestamptz NN d=now() | updated_at timestamptz NN d=now()`
PK (id); UNIQUE (property_id, ghl_opportunity_id); FK property_id → properties CASCADE. Indexes `(property_id)`, `(property_id, assigned_to)`, `(property_id, contact_id)`, `(property_id, stage_id)`, `(property_id, status)`.

**ghl_opportunities_retired** — soft-deleted opportunities removed upstream. 53 rows.
Same columns as `ghl_opportunities` plus `deleted_at timestamptz NN d=now() | deleted_cause text NN d='ghl_deleted' | surviving_opportunity_id text | surviving_status text | reconcile_run_id uuid`.
PK (id). No FK. Indexes `(ghl_opportunity_id)`, `(property_id, deleted_at DESC)`.

**ghl_opportunity_miss_streaks** — tracks opportunities missing from live pulls. 9 rows.
`property_id uuid NN | ghl_opportunity_id text NN | miss_count integer NN d=0 | first_missed_at timestamptz NN d=now() | last_missed_at timestamptz NN d=now() | last_run_id uuid`
PK (property_id, ghl_opportunity_id); FK property_id → properties CASCADE.

**ghl_opportunity_stage_history** — stage transitions. 1,449 rows.
`id uuid NN d=gen_random_uuid() | property_id uuid NN | opportunity_id uuid NN | from_stage_id text | to_stage_id text | changed_at timestamptz NN d=now() | source ghl_stage_history_source NN d='sync_diff' | created_at timestamptz NN d=now()`
PK (id); FKs opportunity_id → ghl_opportunities(id), property_id → properties. Indexes `(opportunity_id, changed_at)`, `(property_id)`.

**ghl_pipeline_stages** — 311 rows. `id uuid NN d=gen_random_uuid() | property_id uuid NN | pipeline_id uuid NN | ghl_pipeline_id text NN | ghl_stage_id text NN | name text | position integer | raw jsonb | created_at timestamptz NN d=now() | updated_at timestamptz NN d=now()`
PK (id); UNIQUE (property_id, ghl_stage_id); FKs pipeline_id → ghl_pipelines(id), property_id → properties. Indexes `(pipeline_id)`, `(property_id)`.

**ghl_pipelines** — 33 rows. `id uuid NN d=gen_random_uuid() | property_id uuid NN | ghl_pipeline_id text NN | name text | raw jsonb | created_at timestamptz NN d=now() | updated_at timestamptz NN d=now()`
PK (id); UNIQUE (property_id, ghl_pipeline_id); FK property_id → properties. Index `(property_id)`.

**ghl_tasks** — CRM tasks. **0 rows** (table exists, never populated).
`id uuid NN d=gen_random_uuid() | property_id uuid NN | ghl_task_id text NN | contact_id text | assigned_user_id text | status text | task_type text | title text | due_at timestamptz | completed_at timestamptz | counts_as_attempt boolean NN d=false | raw jsonb | created_at timestamptz NN d=now() | updated_at timestamptz NN d=now()`
PK (id); UNIQUE (property_id, ghl_task_id); FK property_id → properties. Indexes `(property_id)`, `(property_id, assigned_user_id)`, `(property_id, contact_id)`.

**ghl_users** — CRM users/agents. 104 rows. `id uuid NN d=gen_random_uuid() | property_id uuid NN | ghl_user_id text NN | name text | email text | role text | is_active boolean NN d=true | raw jsonb | created_at timestamptz NN d=now() | updated_at timestamptz NN d=now()`
PK (id); UNIQUE (property_id, ghl_user_id); FK property_id → properties. Index `(property_id)`.

**keyword_rankings** — keyword.com rank tracking. **0 rows.**
`id uuid NN d=gen_random_uuid() | property_id uuid NN | keyword_id bigint NN | keyword text NN | search_engine text | region text | ranking_url text | position integer | previous_position integer | search_volume integer | captured_at date NN | created_at timestamptz NN d=now()`
PK (id); UNIQUE (property_id, keyword_id, captured_at); FK property_id → properties. Index `(property_id, captured_at DESC)`.

**keyword_share_of_voice** — **0 rows.** `id uuid NN d=gen_random_uuid() | property_id uuid NN | domain text NN | is_own_domain boolean NN d=false | sov_score numeric NN | captured_at date NN | created_at timestamptz NN d=now()`
PK (id); UNIQUE (property_id, domain, captured_at); FK property_id → properties. Index `(property_id, captured_at DESC)`.

**lead_perf_suppression_tags** — tags that suppress/disqualify leads. 15 rows.
`tag_normalized text NN | label text NN | reason_label text NN d='Excluded by tag' | disqualifies boolean NN d=true | created_at timestamptz NN d=now() | updated_at timestamptz NN d=now()`
PK (tag_normalized).

**metric_restatements** — audit of restated historical metrics. 21 rows.
`id uuid NN d=gen_random_uuid() | property_id uuid NN | metric text NN | period_start date NN | period_end date NN | prior_value numeric NN | new_value numeric NN | delta numeric | cause text NN | cause_detail text | opportunity_id text | surviving_opportunity_id text | surviving_status text | reconcile_run_id uuid | created_at timestamptz NN d=now()`
PK (id); FKs property_id → properties, reconcile_run_id → reconcile_runs(id). Index `(property_id, period_start, period_end)`.

**onboarding_invites** — 1 row. `id uuid NN d=gen_random_uuid() | property_id uuid | location_label text NN | contact_name text | contact_email text NN | token text NN | status text NN d='not_started' | prefill jsonb NN d='{}' | expires_at timestamptz NN d=(now()+90 days) | revoked_at timestamptz | last_sent_at timestamptz | created_by uuid | created_at timestamptz NN d=now() | updated_at timestamptz NN d=now()`
PK (id); UNIQUE (token); FK property_id → properties. Index `(property_id)`.

**onboarding_submissions** — 1 row. `id uuid NN d=gen_random_uuid() | invite_id uuid NN | property_id uuid | answers jsonb NN d='{}' | section_state jsonb NN d='{}' | current_section integer NN d=0 | status text NN d='in_progress' | submitted_at timestamptz | approved_at timestamptz | approved_by uuid | created_at timestamptz NN d=now() | updated_at timestamptz NN d=now()`
PK (id); UNIQUE (invite_id); FKs invite_id → onboarding_invites, property_id → properties. Index `(status)`.

**onboarding_files** — 0 rows. `id uuid NN d=gen_random_uuid() | submission_id uuid NN | kind text NN d='trainer_photo' | ref_key text | storage_path text NN | file_name text | mime_type text | size_bytes integer | width integer | height integer | created_at timestamptz NN d=now()`
PK (id); FK submission_id → onboarding_submissions. Index `(submission_id)`.

**onboarding_flags** — 0 rows. `id uuid NN d=gen_random_uuid() | submission_id uuid NN | flag_type text NN | severity text NN d='warning' | field_key text | detail text | resolved_at timestamptz | created_at timestamptz NN d=now()`
PK (id); FK submission_id → onboarding_submissions. Index `(submission_id)`.

**onboarding_field_applications** — 0 rows. `id uuid NN d=gen_random_uuid() | submission_id uuid NN | field_key text NN | target_table text NN | target_column text | value_json jsonb | applied_by uuid | applied_at timestamptz NN d=now()`
PK (id); FK submission_id → onboarding_submissions.

**properties** — the location/client table. 7 rows.
`id uuid NN d=gen_random_uuid() | name text NN | slug text NN | logo_url text | primary_color text | timezone text NN d='America/New_York' | is_active boolean NN d=true | public_report_token text | created_at timestamptz NN d=now() | metric_labels jsonb NN d='{}' | hidden_metrics jsonb NN d='[]' | brand_color text | default_lead_owner_user_id text`
PK (id); UNIQUE (slug); UNIQUE (public_report_token).
Note: 7 rows in `properties`, but 10 google_ads / 9 ctm / 9 ghl connection rows exist — some connection rows reference locations beyond the 7 (see §11).

**property_business_hours** — **0 rows.** `id uuid NN d=gen_random_uuid() | property_id uuid NN | day_of_week smallint NN | opens_at time | closes_at time | is_closed boolean NN d=false | created_at timestamptz NN d=now() | updated_at timestamptz NN d=now()`
PK (id); UNIQUE (property_id, day_of_week); FK property_id → properties.

**property_call_score_mappings** — 54 rows. `id uuid NN d=gen_random_uuid() | property_id uuid NN | score_label text NN | bucket text NN | priority integer NN d=100 | created_at timestamptz NN d=now() | updated_at timestamptz NN d=now()`
PK (id); UNIQUE (property_id, score_label); FK property_id → properties. Index `(property_id)`.

**property_data_sources** — per-location integration credentials and health. 28 rows.
`id uuid NN d=gen_random_uuid() | property_id uuid NN | source text NN | is_connected boolean NN d=false | config jsonb | last_synced_at timestamptz | external_account_id text | login_customer_id text | refresh_token text | status text NN d='disconnected' | last_error text | updated_at timestamptz NN d=now() | campaign_label_filter text | secret_token text | consecutive_failures integer NN d=0 | last_success_at timestamptz | last_failure_at timestamptz | last_failed_phase text | backoff_until timestamptz`
PK (id); UNIQUE (property_id, source); FK property_id → properties.

**property_pipeline_mapping** — 311 rows. `id uuid NN d=gen_random_uuid() | property_id uuid NN | ghl_stage_id text NN | ghl_pipeline_id text | canonical_stage ghl_canonical_stage NN | suggested_canonical_stage ghl_canonical_stage | confirmed_by_user boolean NN d=false | confirmed_by uuid | confirmed_at timestamptz | created_at timestamptz NN d=now() | updated_at timestamptz NN d=now() | counts_as_human_handled boolean NN d=false | suppresses_needs_first_response boolean NN d=false`
PK (id); UNIQUE (property_id, ghl_stage_id); FK property_id → properties. Index `(property_id)`.

**property_settings** — **0 rows.** `property_id uuid NN | visible_metrics jsonb NN d='["calls","good_leads","admissions","cost_per_good_lead","cost_per_intake"]' | data_sources jsonb NN d='["google_ads","ctm","ga4"]' | updated_at timestamptz NN d=now() | good_lead_close_rate numeric NN d=0.30`
PK (property_id); FK property_id → properties.

**property_sla_settings** — **0 rows** (all locations fall back to `agency_sla_defaults`). `property_id uuid NN | first_response_seconds integer | attempts_24h integer | attempts_7d integer | stale_after_hours integer | critical_stale_after_hours integer | business_hours_only boolean | after_hours_mode text | timezone text | active_window_days integer | created_at timestamptz NN d=now() | updated_at timestamptz NN d=now()`
PK (property_id); FK property_id → properties.

**property_targets** — 5 rows. `id uuid NN d=gen_random_uuid() | property_id uuid NN | period_start date NN | cpl_target numeric | monthly_ad_budget numeric | monthly_good_leads_goal integer | created_at timestamptz NN d=now() | updated_at timestamptz NN d=now() | cpgl_target numeric`
PK (id); UNIQUE (property_id, period_start); FK property_id → properties. Index `(property_id, period_start DESC)`.

**reconcile_runs** — weekly CRM reconciliation runs. 26 rows. `id uuid NN d=gen_random_uuid() | property_id uuid | source text NN d='ghl' | status text NN d='running' | walk_complete boolean NN d=false | live_count integer | stored_count integer | missing_count integer | retired_count integer NN d=0 | pages integer | error text | notes jsonb | started_at timestamptz NN d=now() | finished_at timestamptz | created_at timestamptz NN d=now()`
PK (id); FK property_id → properties. Index `(property_id, started_at DESC)`.

**sheet_sales_archived** — retired Google Sheets sales import. 338 rows, read-only.
`id uuid NN d=gen_random_uuid() | property_id uuid NN | sale_date date NN | full_name text | email text | phone text | city_state text | first_session date | deal_value numeric | creation_date date | sold_date date | notes text | source_row_hash text NN | synced_at timestamptz NN d=now() | created_at timestamptz NN d=now() | updated_at timestamptz NN d=now()`
PK (id); UNIQUE (property_id, source_row_hash); FK property_id → properties. Index `(property_id, sale_date)`.

**sync_runs** — per-attempt sync log. 36,234 rows, latest 2026-09-15 19:02Z.
`id uuid NN d=gen_random_uuid() | property_id uuid | source text NN | status text NN | started_at timestamptz NN d=now() | finished_at timestamptz | error text | stats jsonb | error_message text | acknowledged_at timestamptz | attempt integer NN d=1 | run_group_id uuid | trigger_source text NN d='unknown' | phase text`
PK (id); FK property_id → properties. Indexes `(property_id, source, started_at DESC)` ×2 (duplicate index definitions exist), `(property_id, started_at DESC)`, `(source, started_at DESC)`.

**sync_watermarks** — 48 rows. `id uuid NN d=gen_random_uuid() | property_id uuid NN | source text NN | phase text NN d='all' | last_fresh_at timestamptz | last_attempt_at timestamptz | last_error text | cursor_json jsonb | next_attempt_at timestamptz | consecutive_failures integer NN d=0 | paused_reason text | created_at timestamptz NN d=now() | updated_at timestamptz NN d=now()`
PK (id); UNIQUE (property_id, source, phase); FK property_id → properties. Index `(next_attempt_at)`.

**user_nav_preferences** — 1 row. `user_id uuid NN | order_keys text[] NN d='{}' | updated_at timestamptz NN d=now()` PK (user_id); FK user_id → auth.users.

**user_roles** — 14 rows. `id uuid NN d=gen_random_uuid() | user_id uuid NN | role app_role NN | created_at timestamptz NN d=now()` PK (id); UNIQUE (user_id, role); FK user_id → auth.users.

**user_security** — 13 rows. `user_id uuid NN | must_change_password boolean NN d=true | created_at timestamptz NN d=now() | updated_at timestamptz NN d=now() | last_password_reset_at timestamptz` PK (user_id).

**user_tour_state** — 17 rows. `user_id uuid NN | tour_key text NN d='dashboard-v1' | completed_at timestamptz | dismissed_at timestamptz | last_step integer NN d=0 | created_at timestamptz NN d=now() | updated_at timestamptz NN d=now()` PK (user_id, tour_key); FK user_id → auth.users.

**viewer_property_access** — 10 rows. `id uuid NN d=gen_random_uuid() | user_id uuid NN | property_id uuid NN | created_at timestamptz NN d=now()` PK (id); UNIQUE (user_id, property_id); FKs to auth.users and properties.

### Enum types
`app_role`: internal, viewer, super_admin, admin, owner, location_owner
`ghl_appointment_status`: booked, confirmed, showed, no_show, cancelled, rescheduled, unknown
`ghl_canonical_stage`: new, contacted, engaged, appointment, showed, won, lost, ignore
`ghl_opportunity_status`: open, won, lost, abandoned, unknown
`ghl_response_source`: human, automation, ai, system, unknown, customer
`ghl_stage_history_source`: sync_diff, webhook, manual_backfill

---

## 2. Row level security

**RLS is enabled on all 49 public tables.** Policies verbatim (`USING` / `WITH CHECK`):

Most data tables follow one of two patterns:

- **Pattern A (property-scoped read + super-admin write)** — applied to `budget_accounts`, `campaign_budgets`, `campaign_labels`, `ctm_calls`, `daily_metrics`, `ghl_contacts`, `ghl_events_raw`, `keyword_rankings`, `keyword_share_of_voice`, `property_call_score_mappings`, `property_settings`, `property_targets`:
  - `read <table>` — SELECT — USING `can_access_property(auth.uid(), property_id)`
  - `super admin write <table>` — ALL — USING `is_super_admin(auth.uid())`, CHECK `is_super_admin(auth.uid())`
  (roles = `public` for all of these except `budget_accounts`, whose two policies are scoped to `authenticated`.)

- **Pattern B (lead-perf read + super-admin write)** — applied to `ghl_appointments`, `ghl_lead_facts`, `ghl_messages`, `ghl_opportunities`, `ghl_opportunity_stage_history`, `ghl_pipelines`, `ghl_pipeline_stages`, `ghl_tasks`, `ghl_users`, `property_business_hours`, `property_pipeline_mapping`, `property_sla_settings`:
  - `<table> read` — SELECT — roles `authenticated` — USING `lead_perf_can_read(auth.uid(), property_id)`
  - `<table> super admin write` — ALL — roles `public` — USING/CHECK `is_super_admin(auth.uid())`

Table-specific policies:

- **agency_sla_defaults**: `agency_sla read` SELECT USING `true`; `agency_sla super admin write` ALL USING/CHECK `is_super_admin(auth.uid())`.
- **ai_agent_messages**: `session owner insert messages` INSERT (authenticated) CHECK `EXISTS (SELECT 1 FROM ai_agent_sessions s WHERE s.id = ai_agent_messages.session_id AND s.user_id = auth.uid())`; `session owner read messages` SELECT USING same EXISTS with `(s.user_id = auth.uid() OR is_super_admin(auth.uid()))`.
- **ai_agent_reports**: `owner delete reports` DELETE USING `user_id = auth.uid()`; `owner insert reports` INSERT CHECK `user_id = auth.uid()`; `owner read reports` SELECT USING `(user_id = auth.uid()) OR is_staff(auth.uid())`; `owner update reports` UPDATE USING/CHECK `user_id = auth.uid()`.
- **ai_agent_sessions**: delete/insert/update as above on `user_id = auth.uid()`; `owner read sessions` SELECT USING `(user_id = auth.uid()) OR is_super_admin(auth.uid())`.
- **ai_agent_tool_runs**: `session owner read tool runs` SELECT USING `EXISTS (SELECT 1 FROM ai_agent_sessions s WHERE s.id = ai_agent_tool_runs.session_id AND (s.user_id = auth.uid() OR is_staff(auth.uid())))`. No insert/update/delete policy (service role only).
- **ghl_opportunities_retired**: `Service manages retired opportunities` ALL (service_role) USING/CHECK `true`; `Staff read retired opportunities` SELECT (authenticated) USING `can_access_property(auth.uid(), property_id)`.
- **ghl_opportunity_miss_streaks**: `Service manages miss streaks` ALL (service_role) USING/CHECK `true`; `Staff read miss streaks` SELECT USING `can_access_property(auth.uid(), property_id)`.
- **lead_perf_suppression_tags**: `suppression tags readable` SELECT (authenticated) USING `true`; `suppression tags super admin write` ALL USING/CHECK `is_super_admin(auth.uid())`.
- **metric_restatements**: `Service manages restatements` ALL (service_role) USING/CHECK `true`; `Staff read restatements` SELECT USING `can_access_property(auth.uid(), property_id)`.
- **onboarding_invites / onboarding_submissions / onboarding_files / onboarding_flags / onboarding_field_applications** (identical set on each, roles `authenticated`):
  - `Staff and owners create …` INSERT CHECK `is_all_properties_reader(auth.uid())`
  - `Staff and owners read …` SELECT USING `is_all_properties_reader(auth.uid())`
  - `Staff and owners update …` UPDATE USING/CHECK `is_all_properties_reader(auth.uid())`
  - `Super admins delete …` DELETE USING `is_super_admin(auth.uid())`
- **properties**: `read properties` SELECT USING `can_access_property(auth.uid(), id)`; `super admin delete properties` DELETE USING `is_super_admin(auth.uid())`; `super admin insert properties` INSERT CHECK `is_super_admin(auth.uid())`; `super admin update properties` UPDATE USING/CHECK `is_super_admin(auth.uid())`.
- **property_data_sources**: `staff read data sources` SELECT USING `is_staff(auth.uid())`; `super admin write data sources` ALL USING/CHECK `is_super_admin(auth.uid())`. (Credentials are therefore readable by any staff user through the Data API.)
- **reconcile_runs**: `Service manages reconcile runs` ALL (service_role) USING/CHECK `true`; `Staff read reconcile runs` SELECT USING `(property_id IS NULL) OR can_access_property(auth.uid(), property_id)`.
- **sheet_sales_archived**: `sheet_sales_read_accessible_properties` SELECT (authenticated) USING `can_access_property(auth.uid(), property_id)`. No write policy.
- **sync_runs**: `staff read sync_runs` SELECT USING `is_all_properties_reader(auth.uid())`; `super admin write sync_runs` ALL USING/CHECK `is_super_admin(auth.uid())`.
- **sync_watermarks**: `Staff can read sync watermarks` SELECT (authenticated) USING `is_staff(auth.uid())`. No write policy.
- **user_nav_preferences**: `own row select` SELECT USING `auth.uid() = user_id`; `own row write` ALL USING/CHECK `auth.uid() = user_id`.
- **user_roles**: `Users can read own roles` SELECT (authenticated) USING `user_id = auth.uid()`; `super admin read all roles` SELECT USING `is_super_admin(auth.uid())`; `super admin insert roles` INSERT CHECK `is_super_admin(auth.uid())`; `super admin update roles` UPDATE USING/CHECK `is_super_admin(auth.uid())`; `super admin delete roles` DELETE USING `is_super_admin(auth.uid())`.
- **user_security**: `Users can read their own security row` SELECT USING `auth.uid() = user_id`; `Super admins can read all security rows` SELECT USING `is_super_admin(auth.uid())`. No write policy (service role only).
- **user_tour_state**: `Users manage their own tour state` ALL (authenticated) USING/CHECK `auth.uid() = user_id`.
- **viewer_property_access**: `Viewer can read own assignments` SELECT USING `user_id = auth.uid()`; `super admin write viewer assignments` ALL USING/CHECK `is_super_admin(auth.uid())`.

**Claim/role dependency**: every policy resolves through `auth.uid()` (the JWT `sub`) passed to SECURITY DEFINER helpers — `is_super_admin`, `is_staff`, `is_all_properties_reader`, `can_access_property`, `user_can_access_property`, `viewer_can_access`, `lead_perf_can_read` — which all read `public.user_roles` and `public.viewer_property_access`. No custom JWT claims are used.

---

## 3. Authentication and roles

- **Auth provider**: Supabase Auth (Lovable Cloud), email/password only. No social/OAuth provider is configured in the app code; `src/pages/Login.tsx` and the invite/recovery flows are password-based. Custom branded auth emails are sent via an auth email hook (Resend).
- **Role representation**: separate table `public.user_roles(user_id, role app_role)` with UNIQUE (user_id, role). No role column on any profile table; no JWT custom claims. `AuthContext` reads only the first role row for the signed-in user.
- **Admin / super admin concept**: yes. `app_role` includes `super_admin`, `admin`, `owner`, `location_owner`, `viewer`, `internal`.
  - Server-side checks are SECURITY DEFINER SQL functions used inside RLS and inside edge functions: `is_super_admin(uuid)`, `is_staff(uuid)` (super_admin + admin), `is_all_properties_reader(uuid)`, `can_access_property(uuid, uuid)`, `lead_perf_can_read(uuid, uuid)`.
  - Edge functions that mutate or expose privileged data call these via RPC after resolving the caller's JWT (`admin-users` → `is_super_admin`; `google-ads-oauth`, `list-mcc-customers`, `list-ctm-accounts`, `list-google-ads-labels`, `save-ghl-connection`, `ghl-*`, `lead-perf-*`, `test-ctm` → `is_all_properties_reader`).
  - Frontend enforcement is additional, not sole: `src/components/RequireAuth.tsx` (`requireSuperAdmin`, `requireStaff`, `requireStaffOrOwner`) and `PreviewModeContext` (`effectiveRole` lets a super admin preview as another role). Frontend checks are cosmetic; the database policies are authoritative.
  - **Exception**: `supabase/functions/jarvis/index.ts` and `jarvis-auth-debug` contain no role-check call (see §10).

### Users (14 total; emails redacted)

| # | Role | Created | Last sign-in |
|---|---|---|---|
| 1 | super_admin | 2026-04-30 | 2026-08-24 |
| 2 | owner (demo "Bob" account) | 2026-06-26 | never |
| 3 | admin | 2026-07-10 | 2026-08-25 |
| 4 | owner | 2026-08-10 | 2026-08-11 |
| 5 | owner | 2026-08-11 | 2026-08-11 |
| 6 | owner | 2026-08-11 | 2026-08-14 |
| 7 | owner | 2026-08-25 | 2026-08-31 |
| 8 | owner | 2026-08-25 | never |
| 9 | owner | 2026-08-25 | 2026-08-25 |
| 10 | location_owner | 2026-08-28 | 2026-08-28 |
| 11 | location_owner | 2026-08-28 | 2026-08-28 |
| 12 | location_owner | 2026-08-28 | 2026-08-29 |
| 13 | location_owner | 2026-09-02 | 2026-09-14 |
| 14 | location_owner | 2026-09-02 | never |

Totals: 1 super_admin, 1 admin, 7 owner, 5 location_owner. No `viewer` or `internal` rows exist.

---

## 4. Edge functions (31)

Cron jobs (pg_cron + pg_net, all active):

| jobid | schedule | target |
|---|---|---|
| 6 | `0 */4 * * *` (every 4 h) | `scheduled-sync-all` |
| 7 | `*/2 * * * *` (every 2 min) | `resync-failed` |
| 8 | `0 3 * * 0` (Sundays 03:00 UTC) | `ghl-reconcile-retire` |

| Function | Purpose | Trigger | External APIs | Auth to external API | Caller verification | Errors / retries |
|---|---|---|---|---|---|---|
| `scheduled-sync-all` | Orchestrates all per-location syncs | cron `0 */4 * * *` | none directly (invokes children) | n/a | Bearer must equal service-role key, `CRON_SECRET`, or vault `cron_secret_v2` | 3 attempts (0/30s/120s) per non-GHL pair, 5-min pair cap, 90 s per invoke; GHL run as 8 phases × ≤8 invokes with a 10-min wall budget; writes `sync_runs` + health counters |
| `resync-failed` | 2-minute recovery pass | cron `*/2 * * * *` | none directly | n/a | service key or `CRON_SECRET` | one pair/tick, 7-day window, `backoff_until` spacing, hard-failure classifier pauses auth/config failures |
| `ghl-reconcile-retire` | Weekly soft-delete of opportunities gone upstream | cron `0 3 * * 0` | GoHighLevel | per-location PIT bearer | service key / `is_all_properties_reader` | writes `reconcile_runs`, `metric_restatements` |
| `sync-google-ads` | Pulls campaign spend, budgets, labels | HTTP (from orchestrator) | `googleads.googleapis.com` v23, `oauth2.googleapis.com/token` | OAuth refresh token → access token + `developer-token` header (+ `login-customer-id`) | service key or `CRON_SECRET` | sets `property_data_sources.status='error'` + `last_error`; no in-function retry |
| `sync-ctm` | Pulls calls + lead-quality counts | HTTP | `api.calltrackingmetrics.com/api/v1` | HTTP Basic (`api_token:api_secret`) | service key / `CRON_SECRET` / `is_all_properties_reader` | paginated; errors recorded to `sync_runs` |
| `sync-ghl` | Phase-chunked CRM mirror | HTTP | `services.leadconnectorhq.com` (`Version: 2021-07-28`) | Bearer private-integration token per location | service key + per-connection `secret_token` | per-phase cursors, phase-level failure isolation, retires permanently missing contacts |
| `sync-ga4` | GA4 sessions/users | HTTP | `analyticsdata.googleapis.com/v1beta` | Service-account JWT (`GA4_SERVICE_ACCOUNT_JSON`) | service key / `CRON_SECRET` / `is_all_properties_reader` | **no ga4 connection rows exist — never runs** |
| `sync-keyword-com` | Rank tracking | HTTP | `app.keyword.com/api/v2` | Bearer token from connection config | service key / `CRON_SECRET` / `is_all_properties_reader` | **no keyword_com connection rows exist — never runs** |
| `google-ads-oauth-url` | Builds Google consent URL (scope `https://www.googleapis.com/auth/adwords`) | HTTP | accounts.google.com | client id | `is_all_properties_reader` | returns error JSON |
| `google-ads-oauth` | Exchanges code for refresh token | HTTP | oauth2.googleapis.com | client id/secret | `is_all_properties_reader` | stores refresh token on the connection row |
| `list-mcc-customers` | Lists child accounts under the manager account | HTTP | Google Ads v23 | MCC refresh token + developer token | `is_all_properties_reader` | error JSON |
| `list-google-ads-labels` | Lists campaign labels | HTTP | Google Ads v23 | as above | `is_all_properties_reader` | error JSON |
| `google-ads-change-history` | Reads `change_event` for the Account Stability card | HTTP | Google Ads v23 | as above | service key path only (no explicit role RPC) | best-effort name lookups swallow errors |
| `list-ctm-accounts`, `test-ctm` | CTM account discovery / credential test | HTTP | CTM v1 | Basic auth | `is_all_properties_reader` (+ `getClaims`) | returns status/body |
| `save-ghl-connection`, `check-ghl-access`, `ghl-probe`, `ghl-backfill`, `ghl-reconcile-opportunities` | CRM connection management, diagnostics, backfill, reconcile | HTTP | GoHighLevel | per-location PIT bearer | service key + `is_all_properties_reader` | per-call error JSON |
| `lead-perf-validate`, `lead-perf-lead-debug` | Lead-performance data audits | HTTP | none | n/a | `is_all_properties_reader` | JSON diagnostics |
| `admin-users` | Create/invite/update users and roles | HTTP (`verify_jwt = false`) | Supabase Admin API | service key | `getClaims` + `is_super_admin` RPC | JSON errors |
| `set-own-password` | Password change with `must_change_password` clear | HTTP | none | n/a | `getClaims` for own user | JSON errors |
| `auth-email-hook` | Branded auth emails | Supabase auth hook (`verify_jwt = false`) | `api.resend.com/emails` | `RESEND_API_KEY` | hook signature only | logs failures |
| `jarvis` | "Bob" AI assistant, streaming, tool-calling | HTTP from browser | `ai.gateway.lovable.dev/v1` | `LOVABLE_API_KEY` | **no role check in the function** | streaming error frames; tool runs logged |
| `ai-assistant` | Older non-streaming assistant | HTTP | `ai.gateway.lovable.dev/v1/chat/completions` | `LOVABLE_API_KEY` | `getClaims` only | JSON error |
| `jarvis-auth-debug` | Debug helper | HTTP | none | n/a | **none** | — |
| `onboarding-public` | Public questionnaire load/save/submit | HTTP (anonymous) | none | n/a | invite token only (by design) + throttling | JSON errors |
| `seed-bob` | Seeds the demo account (`verify_jwt = false`) | HTTP manual | none | n/a | **none** | — |
| `sync-sheet-sales` | Listed in `config.toml` with `verify_jwt = false` but **the function directory does not exist** (retired) | — | — | — | — | — |

**Runtime / timeouts**: `sync_runs` shows real timeouts. In the last 24 h: 6 NoVA and 2 NorCal GHL runs failed with `child sync timed out after 60s`; 6 Winchester/Ohio runs were reaped as `stuck run reaped: no completion recorded within 15 minutes`. Typical successful CTM and Google Ads runs finish in a few seconds; GHL phases run tens of seconds each.

---

## 5. Google Ads integration

- **Credential storage**: agency-level secrets in the Lovable Cloud secret store — `GOOGLE_ADS_DEVELOPER_TOKEN`, `GOOGLE_ADS_MCC_CUSTOMER_ID`, `GOOGLE_ADS_MCC_REFRESH_TOKEN`, `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`. Per-connection overrides live in `property_data_sources.refresh_token` (plain column) — **currently 0 of 10 google_ads rows have their own refresh token**, so every account uses the MCC refresh token. Supabase Vault is used only for `cron_secret_v2`.
- **OAuth scopes granted**: exactly one — `https://www.googleapis.com/auth/adwords` (`google-ads-oauth-url/index.ts:11`).
- **Refresh token**: yes, `GOOGLE_ADS_MCC_REFRESH_TOKEN`. Refreshed on every call by POSTing `grant_type=refresh_token` to `https://oauth2.googleapis.com/token`; access tokens are not cached between invocations.
- **Developer token access level**: **does not exist** anywhere in the codebase or database — nothing records test/basic/standard.
- **API version / transport**: `v23`, REST, `POST /v23/customers/{cid}/googleAds:searchStream` via plain `fetch`. No client library.
- **Customer IDs accessed** (all with `login-customer-id: 2189989288`, the manager account):
  7427148817 (Ashtabula), 5535582282 (Central IL), 5498415254 (DFW), 7133441374 (MoCo), 7440802278 (NorCal), 7141927848 (Ohio), 4453720082 (Colorado Springs), 9627559898 (NoVA **and** Winchester — the same account shared by two locations), 4263891603 (Summerville SC). Yes, a manager account is in the chain for every request.
- **GAQL queries in the codebase** (verbatim):

`sync-google-ads/index.ts` — label resolution:
```
SELECT campaign.id, label.name FROM campaign_label WHERE label.name = '${escaped}'
```
`sync-google-ads/index.ts` — metrics:
```
SELECT
  segments.date,
  campaign.name,
  metrics.cost_micros,
  metrics.impressions,
  metrics.clicks,
  metrics.conversions
FROM campaign
WHERE segments.date BETWEEN '${from}' AND '${to}'
${campaignIdAllowlist ? `AND campaign.id IN (...)` : ""}
```
`sync-google-ads/index.ts` — budgets:
```
SELECT campaign.id, campaign.name, campaign.status, campaign_budget.amount_micros
FROM campaign
WHERE campaign.status != 'REMOVED'
${campaignIdAllowlist ? `AND campaign.id IN (...)` : ""}
```
`sync-google-ads/index.ts` — label map:
```
SELECT campaign.name, label.name
FROM campaign_label
WHERE campaign.status != 'REMOVED'
${campaignIdAllowlist ? `AND campaign.id IN (...)` : ""}
```
`list-google-ads-labels/index.ts`:
```
SELECT label.name, label.resource_name, campaign.id, campaign.name FROM campaign_label
```
`list-mcc-customers/index.ts`:
```
SELECT
  customer_client.id,
  customer_client.descriptive_name,
  customer_client.currency_code,
  customer_client.status,
  customer_client.manager
FROM customer_client
WHERE customer_client.manager = false
```
`google-ads-change-history/index.ts`:
```
SELECT
  change_event.change_date_time,
  change_event.user_email,
  change_event.client_type,
  change_event.change_resource_type,
  change_event.change_resource_name,
  change_event.resource_change_operation,
  change_event.changed_fields,
  change_event.campaign,
  change_event.ad_group
FROM change_event
WHERE change_event.change_date_time BETWEEN '${sinceStr}' AND '${nowStr}'
ORDER BY change_event.change_date_time DESC
LIMIT ${limit}
```
plus two name lookups:
```
SELECT campaign.id, campaign.name FROM campaign WHERE campaign.id IN (...)
SELECT ad_group.id, ad_group.name FROM ad_group WHERE ad_group.id IN (...)
```

- **Mutate operations**: **do not exist.** No `:mutate`, no `mutateOperations`, no commented-out write calls anywhere in the repo. The integration is strictly read-only.
- **Sync cadence / staleness**: full sync every 4 hours over a rolling 30-day window, plus the 2-minute recovery pass (7-day window). All 10 google_ads connections show `last_success_at` on 2026-09-15 between 14:32Z and 18:18Z; maximum Google Ads staleness at audit time was about 4.5 hours (Summerville, 14:32Z). `daily_metrics` latest date = today; `campaign_budgets` is a full delete-and-reinsert snapshot per sync.

---

## 6. Other integrations

### CallTrackingMetrics
- **Credentials**: per-location, stored in `property_data_sources.config` JSON — keys `account_id`, `api_token`, `api_secret`, `number_filter` (and `account_name` on 4 rows). 9 connections, all `connected`. Env fallbacks `CTM_ACCOUNT_ID`, `CTM_API_ACCESS_KEY`, `CTM_API_SECRET_KEY` are referenced in code but **are not present in the secret store**.
- **Auth**: HTTP Basic `btoa(api_token:api_secret)`.
- **Endpoints**: `GET https://api.calltrackingmetrics.com/api/v1/accounts/{id}/calls/search.json?...` (paginated, with `fields=tag_list,tags,score,sale,source,custom_fields,reporting_tags,scoring_tags,tracking_number,called_at,start_time,converted,conversion_value`); `GET /api/v1/accounts/{id}` for connection tests; account listing for discovery.
- **Cadence**: every 4 h via `scheduled-sync-all` (30-day window) + 2-minute recovery. All 9 connections succeeded on 2026-09-15 (16:52Z–18:16Z). 100 successful CTM runs and 0 failures in the last 24 h.
- **Health tracking**: `property_data_sources` (`status`, `last_error`, `consecutive_failures`, `last_success_at`, `last_failure_at`, `backoff_until`), `sync_runs`, `sync_watermarks`, surfaced by `get_api_health_summary()` and `get_sync_freshness()` in `src/pages/admin/ApiHealth.tsx` / `AdminDataSources.tsx`.

### GoHighLevel
- **Credentials**: per-location private integration token in `property_data_sources.secret_token` (8 of 9 rows populated) and `config.location_id`. A global fallback secret `GHL_PRIVATE_INTEGRATION_TOKEN` exists in the secret store.
- **Auth**: `Authorization: Bearer <PIT>` plus `Version: 2021-07-28` against `https://services.leadconnectorhq.com`.
- **Endpoints**: contacts search (`POST /contacts/search`), conversations/messages, opportunities (recent + full), appointments, pipelines, users; deep links to `https://app.gohighlevel.com/v2/location/...` are generated for drill-downs.
- **Cadence**: every 4 h, run as 8 ordered phases — `users, pipelines, opportunities_recent, contacts, conversations, opportunities, appointments, finalize` — each up to 8 cursor-paged invocations, 10-minute wall budget per location; plus the 2-minute recovery pass and a Sunday 03:00 UTC reconciliation.
- **Health tracking**: same tables as CTM, plus `sync_watermarks` per phase, `reconcile_runs`, `ghl_opportunity_miss_streaks`, `metric_restatements`, and hard-failure pausing in `resync-failed`.

---

## 7. Frontend structure

- **Routing**: `react-router-dom` v6 with `BrowserRouter`, all routes declared in `src/App.tsx`.
  - Public: `/`, `/login`, `/reset-password`, `/report/:token`, `/onboarding/:token`, `*` (NotFound).
  - Authenticated, outside the shell: `/change-password`, `/admin/client-reports`, `/admin/client-reports/:propertyId` (both `requireStaff`).
  - Inside `<RequireAuth><AppShell/></RequireAuth>`: `/command`, `/dashboard`, `/calls`, `/keywords`, `/properties/:slug`, `/assistant`, `/reports`, `/budget`, `/lead-performance`, `/sales`, `/admin/properties` (staff), `/admin/pipeline-mapping`, `/admin/sla-settings`, `/admin/data-sources`, `/admin/users`, `/admin/settings`, `/admin/bob-logs` (all super-admin), `/admin/onboarding` (`requireStaffOrOwner`).
  - Most in-shell pages are additionally wrapped in `<ViewerBlock>`.
- **Layout / navigation**: `src/components/layout/AppShell.tsx` (outlet + `Sidebar`, `MobileNav`, `TopBar`, `DateRangePicker`, `ScopeSelector`, `PropertySwitcher`, `SourceHealthPanel`). Nav items are declared in `src/components/layout/navItems.ts` as `COMMAND_ITEM`, `MONITOR_ITEMS`, `DELIVER_ITEMS`, `ADMIN_ITEMS`, `BUDGET_ITEM`, `SALES_ITEM`, `ONBOARDING_ITEM`, with `staffOnly` / `superAdminOnly` flags and drag-order persistence.
  - **A new top-level route is registered in two places**: a `<Route>` in `src/App.tsx` (inside the `AppShell` route for a normal page) and an entry in the appropriate array in `navItems.ts` (rendered by both `Sidebar.tsx` and `MobileNav.tsx`).
- **Guarding**: `src/components/RequireAuth.tsx` — checks session, `mustChangePassword` redirect to `/change-password`, then `requireSuperAdmin` / `requireStaff` / `requireStaffOrOwner` against `PreviewModeContext`'s `effectiveRole`; unauthenticated users go to `/login`, unauthorised go to `/command`. `ViewerBlock` additionally hides pages from viewer-type roles.
- **Component library / styling**: shadcn/ui (Radix primitives) + Tailwind CSS v3 with semantic tokens in `src/index.css` and `tailwind.config.ts`; icons from `lucide-react`; charts from `recharts`; PDF export via `jspdf`.
- **Existing shared components**
  - Tables: `ui/table.tsx`, `ui/pagination.tsx`, `lead-perf/SpeedToLeadTable.tsx`, `lead-perf/AgentLeaderboard.tsx`.
  - Cards: `ui/card.tsx`, `dashboard/KpiCard.tsx`, `dashboard/ChartCard.tsx`, `data/KPICard.tsx`, `command/KpiSparkCard.tsx`, `command/PerformanceCards.tsx`, `command/PendingCard.tsx`, `lead-perf/KpiTile.tsx`.
  - Modals / overlays: `ui/dialog.tsx`, `ui/alert-dialog.tsx` (confirmation dialogs), `ui/sheet.tsx`, `ui/drawer.tsx`, `ui/popover.tsx`, `ui/hover-card.tsx`, `lead-perf/DrillSheet.tsx`, `sales/SalesDayDrawer.tsx`, `bob/BobDrawer.tsx`, `data/CTMConnectionDialog.tsx`, `data/GHLConnectionDialog.tsx`, `data/CTMImportDialog.tsx`, `data/MCCImportDialog.tsx`, `bob/BobIntroDialog.tsx`.
  - Toasts: both systems are mounted — `ui/toaster.tsx` + `hooks/use-toast.ts` and `ui/sonner.tsx` (sonner).
  - Other shared: `ui/form.tsx` (react-hook-form + zod), `ui/skeleton.tsx`, `ui/spinner.tsx`, `ui/chart.tsx`, `ui/badge.tsx`, `data/PageHeader.tsx`, `data/EmptyState.tsx`, `ui/Delta.tsx`, `tour/TourOverlay.tsx`.
- **State management / data fetching**: React context for cross-cutting state (`AuthContext`, `PreviewModeContext`, `PropertyContext`, `ScopeContext`, `DateRangeContext`, `DashboardContext`, `PublicTokenContext`, `BobContext`, `BobIntroContext`, `TourContext`) plus `@tanstack/react-query` v5 (one `QueryClient` in `App.tsx`). Data is fetched directly from the Supabase JS client (`@/integrations/supabase/client`), mostly through SECURITY DEFINER RPCs (`lead_perf_*`, `ai_assistant_context*`, `public_report_*`, `get_*_by_report_token`) and table selects; some hooks (`useCommandData`, `lead-perf/hooks.ts`) use plain `useEffect` + `useState` rather than react-query.

---

## 8. Existing AI usage

- Yes. Two edge functions call an LLM, both server-side; **no LLM is called from the browser**.
  - `supabase/functions/jarvis/index.ts` — the "Bob" assistant. Uses `npm:@ai-sdk/openai-compatible@2` against base URL `https://ai.gateway.lovable.dev/v1`, model **`google/gemini-3-flash-preview`** (two call sites: main stream and a secondary pass). Streaming with tool-calling; runs logged to `ai_agent_sessions`, `ai_agent_messages`, `ai_agent_tool_runs`.
  - `supabase/functions/ai-assistant/index.ts` — older non-streaming assistant, `POST https://ai.gateway.lovable.dev/v1/chat/completions`, model `google/gemini-3-flash-preview`.
- **API key**: `LOVABLE_API_KEY`, read with `Deno.env.get` inside the edge functions; it is a managed Lovable Cloud secret and is never exposed to the browser.

---

## 9. Secrets and environment

**Server-only secrets in the secret store (9):** `CRON_SECRET`, `GHL_PRIVATE_INTEGRATION_TOKEN`, `GOOGLE_ADS_DEVELOPER_TOKEN`, `GOOGLE_ADS_MCC_CUSTOMER_ID`, `GOOGLE_ADS_MCC_REFRESH_TOKEN`, `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_SHEETS_API_KEY` (connector-managed), `LOVABLE_API_KEY` (platform-managed).

**Platform-injected server-only:** `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`.

**Referenced in edge-function code but NOT present in the secret store** (so those code paths fall back or fail): `CTM_ACCOUNT_ID`, `CTM_API_ACCESS_KEY`, `CTM_API_SECRET_KEY`, `GA4_SERVICE_ACCOUNT_JSON`, `RESEND_API_KEY`, `JARVIS_DEBUG`.

**Vault:** one entry, `cron_secret_v2`, read only by `get_cron_secret_v2()` (service_role execute).

**Exposed to the browser** (in `.env`, prefixed `VITE_`): `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` (anon key), `VITE_SUPABASE_PROJECT_ID`. Frontend also reads `import.meta.env.DEV`.

**Credentials stored as ordinary table columns (not secrets):** `property_data_sources.refresh_token`, `.secret_token`, and `config.api_token` / `config.api_secret` — readable by any `is_staff` user through the SELECT policy on that table.

---

## 10. Known issues

**Currently failing or degraded**
- **MoCo GoHighLevel** — `status = 'paused'`, `is_connected = false`, **252 consecutive failures**, `last_success_at` is NULL, last error `Missing GHL location_id or token`. This location's CRM data has never synced.
- **NoVA GoHighLevel** — `consecutive_failures = 160` while `status` still reads `connected`; `last_success_at = 2026-08-18 20:43Z`, i.e. **~28 days stale**, despite successful individual phase runs being recorded. The status flag and the failure counter disagree.
- Last 24 h `sync_runs`: 944 GHL successes vs **18 GHL failures** — 6 NoVA and 2 NorCal `child sync timed out after 60s`; 5 Winchester and 1 Ohio `stuck run reaped: no completion recorded within 15 minutes` (phases `contacts`, `conversations`, `opportunities_recent`); 3 Winchester failures returning a Cloudflare HTML error page instead of JSON; 1 Central IL `GHL /contacts/search 400: Failed to fetch details`.
- CTM: 100 runs, 0 failures. Google Ads: 55 runs, 0 failures.

**Empty / dead paths**
- `ghl_tasks`, `keyword_rankings`, `keyword_share_of_voice`, `property_settings`, `property_sla_settings`, `property_business_hours`, and all `onboarding_files/flags/field_applications` tables are **0 rows**. `sync-ga4` and `sync-keyword-com` exist but have no connection rows, so they never execute.
- `supabase/config.toml` declares `functions.sync-sheet-sales` but that function directory does not exist.

**TODO / FIXME comments**: **do not exist** — a repository-wide search for TODO/FIXME/HACK in `src` and `supabase/functions` returns nothing.

**Fragile points observed**
1. Integration credentials (Google refresh tokens, GHL private tokens, CTM token/secret) live in ordinary `property_data_sources` columns and JSON, readable by every staff user via RLS; only super admins can write them.
2. `sync-ghl` phase runs are capped by wall-clock budgets; when a location exceeds them the run simply ends, which is how NoVA can be a month stale while individual runs report success.
3. `status` on `property_data_sources` is set independently of `consecutive_failures`, so a source can be simultaneously "connected" and 160 failures deep (NoVA).
4. `campaign_budgets` is refreshed by deleting all rows for a location then reinserting; a failure between the two leaves that location with no budget rows.
5. Two Google Ads locations (NoVA and Winchester) share customer ID 9627559898, so separation depends entirely on `campaign_label_filter`, which is set on **none** of the 10 connections at present.
6. `jarvis` and `jarvis-auth-debug` perform no role check inside the function; `seed-bob` runs with `verify_jwt = false` and no caller check.
7. `daily_metrics` is written by three different syncs, each merging around the other's columns by hand in application code rather than by column ownership in the database.
8. GAQL strings are interpolated (`label.name = '${escaped}'`, campaign ID lists); escaping is a single `replace(/'/g, "\\'")`.
9. `sync_runs` has grown to 36k rows with no retention policy, and carries two functionally identical indexes on `(property_id, source, started_at DESC)`.
10. 78 pre-existing security-linter warnings about callable SECURITY DEFINER functions (34 public-execute, 44 authenticated-execute) have been reported on every migration and remain unresolved.

---

## 11. Scale

- **Google Ads accounts tracked**: 10 connection rows covering **9 distinct customer IDs** (NoVA and Winchester share 9627559898), all under one manager account (2189989288).
- **Locations**: 7 rows in `properties`; 9 CTM and 9 GHL connections, 10 Google Ads connections.
- **Campaigns**: 41 distinct campaign names present in `daily_metrics`; 39 active campaign rows in the current `campaign_budgets` snapshot.
- **Rough daily write volume** (rows touched in the last 24 h):
  - `daily_metrics`: 39 new rows/day (plus upserts over the rolling 30-day window, ~4,000 rows re-touched per full cycle).
  - `ghl_messages`: ~1,461 new rows/day.
  - `ghl_opportunities`: ~16,666 rows updated/day (near-full re-upsert per cycle).
  - `ghl_contacts`: 31,116 rows updated/day (the whole table is re-touched each cycle).
  - `ghl_lead_facts`: 31,527 rows rebuilt/day.
  - `ctm_calls`: ~49 new rows/day.
  - `sync_runs`: ~1,100 log rows/day (6 cycles/day × 9 locations × phases, plus 720 recovery ticks).
