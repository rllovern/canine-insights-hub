-- Node kind always follows its depth: top level = section, under a section = task, deeper = subtask.
CREATE FUNCTION mops.sop_node_kind() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  NEW.kind := CASE
    WHEN NEW.parent_id IS NULL THEN 'section'
    WHEN (SELECT parent_id FROM mops.sop_nodes WHERE id = NEW.parent_id) IS NULL THEN 'task'
    ELSE 'subtask' END;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION mops.sop_node_kind() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER sop_node_kind BEFORE INSERT OR UPDATE OF parent_id ON mops.sop_nodes FOR EACH ROW EXECUTE FUNCTION mops.sop_node_kind();