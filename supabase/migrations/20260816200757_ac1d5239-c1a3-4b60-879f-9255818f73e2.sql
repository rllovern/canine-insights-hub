CREATE TABLE public.sync_watermarks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  source text NOT NULL,
  phase text NOT NULL DEFAULT 'all',
  last_fresh_at timestamptz,
  last_attempt_at timestamptz,
  last_error text,
  cursor_json jsonb,
  next_attempt_at timestamptz,
  consecutive_failures integer NOT NULL DEFAULT 0,
  paused_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (property_id, source, phase)
);

GRANT SELECT ON public.sync_watermarks TO authenticated;
GRANT ALL ON public.sync_watermarks TO service_role;

ALTER TABLE public.sync_watermarks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff can read sync watermarks"
  ON public.sync_watermarks FOR SELECT
  TO authenticated
  USING (public.is_staff(auth.uid()));

CREATE TRIGGER sync_watermarks_set_updated_at
  BEFORE UPDATE ON public.sync_watermarks
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX idx_sync_watermarks_next_attempt ON public.sync_watermarks (next_attempt_at);

-- Freshness view used by the health surfaces.
CREATE OR REPLACE FUNCTION public.get_sync_freshness()
RETURNS TABLE(
  property_id uuid,
  property_name text,
  source text,
  phase text,
  last_fresh_at timestamptz,
  last_attempt_at timestamptz,
  consecutive_failures integer,
  paused_reason text,
  next_attempt_at timestamptz,
  last_error text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT w.property_id, p.name, w.source, w.phase, w.last_fresh_at, w.last_attempt_at,
         w.consecutive_failures, w.paused_reason, w.next_attempt_at, w.last_error
  FROM public.sync_watermarks w
  JOIN public.properties p ON p.id = w.property_id
  WHERE public.is_staff(auth.uid()) OR public.can_access_property(auth.uid(), w.property_id)
$$;