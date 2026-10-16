# Roadmap — Agency-wide Lead Reconciliation

- [ ] Schema: location status (mode: off/monitor/live, manual_hold), preflight runs/results, discovered forms, call discrepancies
- [ ] Preflight module (read-only checks, never auto-reactivates manual holds; passes -> monitoring-only + "needs validation")
- [ ] Form discovery + classification (unknown source stays unknown; unclassified visible, never sent)
- [ ] Engine: per-form config from discovered forms; monitor mode never posts
- [ ] Call discrepancy monitor (expectation unverified unless configured; no writes)
- [ ] Scheduler: all locations in monitor/live; daily preflight inside 5-min job
- [ ] Alerts: connection failure, schedule stopped, preflight fail, review needed
- [ ] Lead Reconciliation UI (overview, filters, location drill-down)
- [ ] Tests, deploy, run preflight on all 10 locations, report
