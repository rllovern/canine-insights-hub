# Ads Agent Phase 0 — remaining steps

The approved plan stands. Code-side work is done (health function, page, route, nav, cleanup of Bob references, config.toml, obsolete function directories). This plan covers the steps still blocked by the backend's scheduled maintenance window (ends ~21:45 UTC) plus the two secrets.

## Remaining build steps

1. **Secrets** — two values you supply through the secure form (see the chat answer for where each comes from):
   - `ADS_AGENT_REFRESH_TOKEN` — a brand-new Google OAuth refresh token for the Ads Agent, per your Part D decision 7. Not the existing manager-account token.
   - `GOOGLE_ADS_DEVELOPER_TOKEN_LEVEL` — just tells me `basic` or `standard`. Recorded only; nothing reads it this phase.
2. **Database migration** — the ten `agent_` tables, grants, RLS policies, the `agent_audit_log` SELECT/INSERT policy split, the `agent_audit_log_immutable` trigger, and the seeded unfrozen kill-switch row (retry once maintenance ends; already attempted once and rejected by the outage, so re-run after verifying no tables were half-created).
3. **Data changes** — delete the 6 zero-cost Winchester rows, delete the Bob demo auth user with its role and access rows.
4. **Backend deployment** — deploy `ads-agent-health`; delete the deployed `jarvis-auth-debug` and `seed-bob` functions.
5. **Documentation** — write `docs/SYSTEM_AUDIT.md` (restored audit with Part B corrections marked inline, plus the verified no-mutate evidence).
6. **Verification** — build check, then confirm the page loads and the health endpoint returns the expected empty-policy response.
