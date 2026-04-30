
CREATE TABLE public.ctm_calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  ctm_call_id text NOT NULL,
  called_at timestamptz NOT NULL,
  duration_seconds int,
  tracking_source text,
  channel text,
  campaign_name text,
  ad_group text,
  caller_number text,
  call_score_label text,
  call_score_bucket text,
  raw_payload jsonb,
  synced_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (property_id, ctm_call_id)
);

CREATE INDEX idx_ctm_calls_property_called_at ON public.ctm_calls (property_id, called_at DESC);
CREATE INDEX idx_ctm_calls_channel ON public.ctm_calls (property_id, channel, called_at DESC);

ALTER TABLE public.ctm_calls ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Internal full access ctm_calls"
  ON public.ctm_calls
  FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'internal'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'internal'::app_role));

CREATE POLICY "Viewer can select assigned ctm_calls"
  ON public.ctm_calls
  FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'viewer'::app_role)
    AND public.viewer_can_access(auth.uid(), property_id)
  );

-- Public read by share token
CREATE OR REPLACE FUNCTION public.get_ctm_calls_by_report_token(
  _token text,
  _from timestamptz,
  _to timestamptz
)
RETURNS SETOF public.ctm_calls
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.*
  FROM public.ctm_calls c
  JOIN public.properties p ON p.id = c.property_id
  WHERE p.public_report_token = _token
    AND p.is_active = true
    AND c.called_at >= _from
    AND c.called_at <= _to
$$;

GRANT EXECUTE ON FUNCTION public.get_ctm_calls_by_report_token(text, timestamptz, timestamptz) TO anon, authenticated;
