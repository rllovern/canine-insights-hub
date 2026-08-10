-- 1. Retired opportunities archive -------------------------------------------
CREATE TABLE public.ghl_opportunities_retired (LIKE public.ghl_opportunities INCLUDING DEFAULTS);
ALTER TABLE public.ghl_opportunities_retired
  ADD CONSTRAINT ghl_opportunities_retired_pkey PRIMARY KEY (id),
  ADD COLUMN deleted_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN deleted_cause text NOT NULL DEFAULT 'ghl_deleted',
  ADD COLUMN surviving_opportunity_id text,
  ADD COLUMN surviving_status text,
  ADD COLUMN reconcile_run_id uuid,
  ADD CONSTRAINT ghl_opportunities_retired_cause_chk CHECK (deleted_cause IN (
    'ghl_deleted','ghl_recreated_surviving_won','ghl_recreated_surviving_not_won','manual'
  ));
CREATE INDEX ghl_opportunities_retired_property_idx ON public.ghl_opportunities_retired (property_id, deleted_at DESC);
CREATE INDEX ghl_opportunities_retired_oppid_idx ON public.ghl_opportunities_retired (ghl_opportunity_id);

GRANT SELECT ON public.ghl_opportunities_retired TO authenticated;
GRANT ALL ON public.ghl_opportunities_retired TO service_role;
ALTER TABLE public.ghl_opportunities_retired ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff read retired opportunities" ON public.ghl_opportunities_retired
  FOR SELECT TO authenticated USING (public.can_access_property(auth.uid(), property_id));
CREATE POLICY "Service manages retired opportunities" ON public.ghl_opportunities_retired
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 2. Reconcile run log ---------------------------------------------------------
CREATE TABLE public.reconcile_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid REFERENCES public.properties(id) ON DELETE CASCADE,
  source text NOT NULL DEFAULT 'ghl',
  status text NOT NULL DEFAULT 'running',
  walk_complete boolean NOT NULL DEFAULT false,
  live_count integer,
  stored_count integer,
  missing_count integer,
  retired_count integer NOT NULL DEFAULT 0,
  pages integer,
  error text,
  notes jsonb,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX reconcile_runs_property_idx ON public.reconcile_runs (property_id, started_at DESC);
GRANT SELECT ON public.reconcile_runs TO authenticated;
GRANT ALL ON public.reconcile_runs TO service_role;
ALTER TABLE public.reconcile_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff read reconcile runs" ON public.reconcile_runs
  FOR SELECT TO authenticated
  USING (property_id IS NULL OR public.can_access_property(auth.uid(), property_id));
CREATE POLICY "Service manages reconcile runs" ON public.reconcile_runs
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 3. Miss streak tracker (two consecutive clean passes before retirement) -------
CREATE TABLE public.ghl_opportunity_miss_streaks (
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  ghl_opportunity_id text NOT NULL,
  miss_count integer NOT NULL DEFAULT 0,
  first_missed_at timestamptz NOT NULL DEFAULT now(),
  last_missed_at timestamptz NOT NULL DEFAULT now(),
  last_run_id uuid,
  PRIMARY KEY (property_id, ghl_opportunity_id)
);
GRANT SELECT ON public.ghl_opportunity_miss_streaks TO authenticated;
GRANT ALL ON public.ghl_opportunity_miss_streaks TO service_role;
ALTER TABLE public.ghl_opportunity_miss_streaks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff read miss streaks" ON public.ghl_opportunity_miss_streaks
  FOR SELECT TO authenticated USING (public.can_access_property(auth.uid(), property_id));
CREATE POLICY "Service manages miss streaks" ON public.ghl_opportunity_miss_streaks
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 4. Restatement log -----------------------------------------------------------
CREATE TABLE public.metric_restatements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  metric text NOT NULL,
  period_start date NOT NULL,
  period_end date NOT NULL,
  prior_value numeric NOT NULL,
  new_value numeric NOT NULL,
  delta numeric GENERATED ALWAYS AS (new_value - prior_value) STORED,
  cause text NOT NULL,
  cause_detail text,
  opportunity_id text,
  surviving_opportunity_id text,
  surviving_status text,
  reconcile_run_id uuid REFERENCES public.reconcile_runs(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT metric_restatements_cause_chk CHECK (cause IN (
    'ghl_deleted','ghl_recreated_surviving_won','ghl_recreated_surviving_not_won','manual'
  ))
);
CREATE INDEX metric_restatements_property_period_idx
  ON public.metric_restatements (property_id, period_start, period_end);
GRANT SELECT ON public.metric_restatements TO authenticated;
GRANT ALL ON public.metric_restatements TO service_role;
ALTER TABLE public.metric_restatements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff read restatements" ON public.metric_restatements
  FOR SELECT TO authenticated USING (public.can_access_property(auth.uid(), property_id));
CREATE POLICY "Service manages restatements" ON public.metric_restatements
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 5. Lookups -------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_restatements(_property_ids uuid[], _from date, _to date)
RETURNS SETOF public.metric_restatements
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT r.* FROM public.metric_restatements r
  WHERE (_property_ids IS NULL OR r.property_id = ANY(_property_ids))
    AND public.can_access_property(auth.uid(), r.property_id)
    AND r.period_start <= _to AND r.period_end >= _from
  ORDER BY r.created_at DESC;
$$;

CREATE OR REPLACE FUNCTION public.get_restatements_by_report_token(_token text, _from date, _to date)
RETURNS SETOF public.metric_restatements
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT r.* FROM public.metric_restatements r
  JOIN public.properties p ON p.id = r.property_id
  WHERE p.public_report_token = _token
    AND r.period_start <= _to AND r.period_end >= _from
  ORDER BY r.created_at DESC;
$$;

GRANT EXECUTE ON FUNCTION public.get_restatements(uuid[], date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_restatements_by_report_token(text, date, date) TO anon, authenticated;