
CREATE TABLE public.property_targets (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  property_id UUID NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  period_start DATE NOT NULL,
  cpl_target NUMERIC,
  monthly_ad_budget NUMERIC,
  monthly_good_leads_goal INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (property_id, period_start)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.property_targets TO authenticated;
GRANT ALL ON public.property_targets TO service_role;

ALTER TABLE public.property_targets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "internal manage property_targets"
  ON public.property_targets FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'internal'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'internal'::app_role));

CREATE POLICY "viewers read accessible property_targets"
  ON public.property_targets FOR SELECT
  TO authenticated
  USING (public.viewer_can_access(auth.uid(), property_id));

CREATE TRIGGER property_targets_set_updated_at
  BEFORE UPDATE ON public.property_targets
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX property_targets_property_period_idx
  ON public.property_targets (property_id, period_start DESC);
