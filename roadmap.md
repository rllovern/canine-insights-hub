# Roadmap — Agency-wide Lead Reconciliation

- [x] Schema: location status (mode: off/monitor/live, manual_hold), preflight runs/results, discovered forms, call discrepancies
- [x] Preflight module (read-only checks, never auto-reactivates manual holds; passes -> monitoring-only + "needs validation")
- [x] Form discovery + classification (unknown source stays unknown; unclassified visible, never sent)
- [x] Engine: per-form config from discovered forms; monitor mode never posts
- [x] Call discrepancy monitor (expectation unverified unless configured; no writes)
- [x] Scheduler: all locations in monitor/live; daily preflight inside 5-min job
- [x] Alerts: connection failure, schedule stopped, preflight fail, review needed
- [x] Lead Reconciliation UI (overview, filters, location drill-down)
- [x] Tests, deploy, run preflight on all 10 locations, report
