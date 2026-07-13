
ALTER TABLE public.sync_runs
  ADD COLUMN IF NOT EXISTS attempt integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS run_group_id uuid,
  ADD COLUMN IF NOT EXISTS trigger_source text NOT NULL DEFAULT 'unknown';

CREATE INDEX IF NOT EXISTS idx_sync_runs_prop_source_started
  ON public.sync_runs (property_id, source, started_at DESC);
