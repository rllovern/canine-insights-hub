-- Keep the supplied kind when the parent row is not yet visible (bulk version cloning).
CREATE OR REPLACE FUNCTION mops.sop_node_kind() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE pp uuid;
BEGIN
  IF NEW.parent_id IS NULL THEN NEW.kind := 'section'; RETURN NEW; END IF;
  SELECT parent_id INTO pp FROM mops.sop_nodes WHERE id = NEW.parent_id;
  IF FOUND THEN NEW.kind := CASE WHEN pp IS NULL THEN 'task' ELSE 'subtask' END; END IF;
  RETURN NEW;
END $$;