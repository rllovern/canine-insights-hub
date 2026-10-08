-- Questionnaire submission stays the prerequisite for onboarding work in the SOP workspace too.
CREATE FUNCTION mops.sop_gate() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.stable_key <> 'discovery_questionnaire' AND EXISTS (
    SELECT 1 FROM mops.client_lifecycle l
    WHERE l.property_id = NEW.property_id AND l.classification = 'onboarding' AND l.questionnaire_submitted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'The questionnaire must be submitted before onboarding work can start';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION mops.sop_gate() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER sop_status_gate BEFORE INSERT OR UPDATE ON mops.client_sop_status FOR EACH ROW EXECUTE FUNCTION mops.sop_gate();