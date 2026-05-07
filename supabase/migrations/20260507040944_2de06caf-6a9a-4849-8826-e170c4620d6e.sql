
-- Extend properties with label/visibility config
ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS metric_labels jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS hidden_metrics jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS brand_color text;

-- Reusable updated_at trigger
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

-- ===== daily_metrics =====
CREATE TABLE public.daily_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  date date NOT NULL,
  ad_source text NOT NULL,
  campaign text NOT NULL,
  cost numeric NOT NULL DEFAULT 0,
  impressions integer NOT NULL DEFAULT 0,
  clicks integer NOT NULL DEFAULT 0,
  record_count integer NOT NULL DEFAULT 0,
  no_entry integer NOT NULL DEFAULT 0,
  leads integer NOT NULL DEFAULT 0,
  good_leads integer NOT NULL DEFAULT 0,
  bad_leads integer NOT NULL DEFAULT 0,
  spam integer NOT NULL DEFAULT 0,
  admissions integer NOT NULL DEFAULT 0,
  medicaid integer NOT NULL DEFAULT 0,
  sessions integer NOT NULL DEFAULT 0,
  users integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (property_id, date, ad_source, campaign)
);
CREATE INDEX idx_daily_metrics_property_date ON public.daily_metrics(property_id, date);
ALTER TABLE public.daily_metrics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Internal full access daily_metrics" ON public.daily_metrics
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'internal'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'internal'::app_role));

CREATE POLICY "Viewer can read assigned daily_metrics" ON public.daily_metrics
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'viewer'::app_role) AND public.viewer_can_access(auth.uid(), property_id));

-- ===== property_settings =====
CREATE TABLE public.property_settings (
  property_id uuid PRIMARY KEY REFERENCES public.properties(id) ON DELETE CASCADE,
  visible_metrics jsonb NOT NULL DEFAULT '["calls","good_leads","admissions","cost_per_good_lead","cost_per_intake"]'::jsonb,
  data_sources jsonb NOT NULL DEFAULT '["google_ads","ctm","ga4"]'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.property_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Internal manages property_settings" ON public.property_settings
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'internal'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'internal'::app_role));

CREATE POLICY "Viewer reads assigned property_settings" ON public.property_settings
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'viewer'::app_role) AND public.viewer_can_access(auth.uid(), property_id));

CREATE TRIGGER trg_property_settings_updated BEFORE UPDATE ON public.property_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ===== property_call_score_mappings =====
CREATE TABLE public.property_call_score_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  score_label text NOT NULL,
  bucket text NOT NULL CHECK (bucket IN ('admission','good','medicaid','bad','spam','repeat','ignore')),
  priority integer NOT NULL DEFAULT 100,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (property_id, score_label)
);
CREATE INDEX idx_pcsm_property ON public.property_call_score_mappings(property_id);
ALTER TABLE public.property_call_score_mappings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Internal manages score mappings" ON public.property_call_score_mappings
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'internal'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'internal'::app_role));

CREATE POLICY "Viewer reads assigned score mappings" ON public.property_call_score_mappings
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'viewer'::app_role) AND public.viewer_can_access(auth.uid(), property_id));

CREATE TRIGGER trg_pcsm_updated BEFORE UPDATE ON public.property_call_score_mappings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ===== sync_runs =====
CREATE TABLE public.sync_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid REFERENCES public.properties(id) ON DELETE CASCADE,
  source text NOT NULL,
  status text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  error text,
  stats jsonb
);
CREATE INDEX idx_sync_runs_property ON public.sync_runs(property_id, started_at DESC);
ALTER TABLE public.sync_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Internal manages sync_runs" ON public.sync_runs
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'internal'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'internal'::app_role));

-- ===== keyword_rankings =====
CREATE TABLE public.keyword_rankings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  keyword_id bigint NOT NULL,
  keyword text NOT NULL,
  search_engine text,
  region text,
  ranking_url text,
  position integer,
  previous_position integer,
  search_volume integer,
  captured_at date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (property_id, keyword_id, captured_at)
);
CREATE INDEX idx_kr_property_date ON public.keyword_rankings(property_id, captured_at DESC);
ALTER TABLE public.keyword_rankings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Internal manages keyword_rankings" ON public.keyword_rankings
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'internal'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'internal'::app_role));
CREATE POLICY "Viewer reads assigned keyword_rankings" ON public.keyword_rankings
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'viewer'::app_role) AND public.viewer_can_access(auth.uid(), property_id));

-- ===== keyword_share_of_voice =====
CREATE TABLE public.keyword_share_of_voice (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  domain text NOT NULL,
  is_own_domain boolean NOT NULL DEFAULT false,
  sov_score numeric NOT NULL,
  captured_at date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (property_id, domain, captured_at)
);
CREATE INDEX idx_sov_property_date ON public.keyword_share_of_voice(property_id, captured_at DESC);
ALTER TABLE public.keyword_share_of_voice ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Internal manages sov" ON public.keyword_share_of_voice
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'internal'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'internal'::app_role));
CREATE POLICY "Viewer reads assigned sov" ON public.keyword_share_of_voice
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'viewer'::app_role) AND public.viewer_can_access(auth.uid(), property_id));

-- ===== Public report RPCs =====
CREATE OR REPLACE FUNCTION public.get_daily_metrics_by_report_token(_token text, _from date, _to date)
RETURNS SETOF public.daily_metrics
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT dm.* FROM public.daily_metrics dm
  JOIN public.properties p ON p.id = dm.property_id
  WHERE p.public_report_token = _token AND p.is_active = true
    AND dm.date >= _from AND dm.date <= _to
  ORDER BY dm.date ASC
$$;

CREATE OR REPLACE FUNCTION public.get_score_mappings_by_report_token(_token text)
RETURNS SETOF public.property_call_score_mappings
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT m.* FROM public.property_call_score_mappings m
  JOIN public.properties p ON p.id = m.property_id
  WHERE p.public_report_token = _token AND p.is_active = true
$$;

CREATE OR REPLACE FUNCTION public.get_keyword_rankings_by_report_token(_token text, _from date, _to date)
RETURNS SETOF public.keyword_rankings
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT k.* FROM public.keyword_rankings k
  JOIN public.properties p ON p.id = k.property_id
  WHERE p.public_report_token = _token AND p.is_active = true
    AND k.captured_at >= _from AND k.captured_at <= _to
$$;

GRANT EXECUTE ON FUNCTION public.get_daily_metrics_by_report_token(text, date, date) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_score_mappings_by_report_token(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_keyword_rankings_by_report_token(text, date, date) TO anon, authenticated;

-- Settings rows + 90 days of seed data for existing properties
INSERT INTO public.property_settings (property_id)
SELECT id FROM public.properties ON CONFLICT DO NOTHING;

DO $$
DECLARE
  p record; d date; src text;
  sources text[] := array['Google PPC','Organic','Website','Yelp','Facebook','Other'];
  src_w numeric; imp int; clk int; rec int; gl int; bl int; sp int; ne int; adm int;
  base_cost numeric; camp text;
BEGIN
  FOR p IN SELECT id FROM public.properties LOOP
    FOR d IN SELECT generate_series(current_date - 89, current_date, '1 day')::date LOOP
      FOREACH src IN ARRAY sources LOOP
        src_w := CASE src
          WHEN 'Google PPC' THEN 1.0 WHEN 'Organic' THEN 0.6 WHEN 'Website' THEN 0.4
          WHEN 'Yelp' THEN 0.25 WHEN 'Facebook' THEN 0.5 ELSE 0.15 END;
        FOR camp IN SELECT unnest(CASE src
          WHEN 'Google PPC' THEN array['Brand - Search','Generic - Search','Display - Remarketing']
          WHEN 'Facebook' THEN array['FB - Lead Gen','FB - Awareness']
          ELSE array[src || ' - Default'] END) LOOP
          imp := (random()*4000*src_w + 200)::int;
          clk := (imp * (0.02 + random()*0.05))::int;
          base_cost := CASE WHEN src='Google PPC' THEN clk*(1.2+random()*2.5) ELSE clk*(0.4+random()*1.0) END;
          rec := (clk * (0.05 + random()*0.15))::int;
          ne := (rec*0.1)::int; sp := (rec*0.08)::int; bl := (rec*0.18)::int;
          gl := greatest(0, rec - ne - sp - bl);
          adm := (gl * (0.15 + random()*0.2))::int;
          INSERT INTO public.daily_metrics(property_id,date,ad_source,campaign,cost,impressions,clicks,record_count,no_entry,leads,good_leads,bad_leads,spam,admissions,sessions,users)
          VALUES (p.id,d,src,camp,base_cost,imp,clk,rec,ne,gl+bl,gl,bl,sp,adm,(imp*0.3)::int,(imp*0.22)::int)
          ON CONFLICT (property_id, date, ad_source, campaign) DO NOTHING;
        END LOOP;
      END LOOP;
    END LOOP;
  END LOOP;
END$$;
