
ALTER TABLE public.ai_agent_reports
  ADD COLUMN IF NOT EXISTS scope_json jsonb,
  ADD COLUMN IF NOT EXISTS comparison_range_start date,
  ADD COLUMN IF NOT EXISTS comparison_range_end date,
  ADD COLUMN IF NOT EXISTS status_json jsonb,
  ADD COLUMN IF NOT EXISTS caveats_json jsonb,
  ADD COLUMN IF NOT EXISTS confidence_json jsonb,
  ADD COLUMN IF NOT EXISTS saved_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

CREATE INDEX IF NOT EXISTS ai_agent_reports_saved_idx
  ON public.ai_agent_reports (user_id, saved, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS ai_agent_reports_type_idx
  ON public.ai_agent_reports (property_id, report_type, created_at DESC)
  WHERE deleted_at IS NULL;

-- Keep saved_at in sync when saved flips true
CREATE OR REPLACE FUNCTION public.ai_agent_reports_set_saved_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.saved = true AND (OLD IS NULL OR OLD.saved = false) THEN
    NEW.saved_at = COALESCE(NEW.saved_at, now());
  ELSIF NEW.saved = false THEN
    NEW.saved_at = NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ai_agent_reports_saved_at_trg ON public.ai_agent_reports;
CREATE TRIGGER ai_agent_reports_saved_at_trg
  BEFORE INSERT OR UPDATE OF saved ON public.ai_agent_reports
  FOR EACH ROW EXECUTE FUNCTION public.ai_agent_reports_set_saved_at();
