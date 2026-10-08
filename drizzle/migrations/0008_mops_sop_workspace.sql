-- Nested SOP workspace: versioned master templates, client statuses, history, attachments, imports.
CREATE TABLE mops.sop_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE,
  name text NOT NULL,
  description text,
  sort int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE mops.sop_template_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES mops.sop_templates(id) ON DELETE CASCADE,
  version_no int,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved')),
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  published_by uuid,
  UNIQUE (template_id, version_no)
);
CREATE UNIQUE INDEX sop_one_draft ON mops.sop_template_versions(template_id) WHERE status = 'draft';

CREATE TABLE mops.sop_nodes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id uuid NOT NULL REFERENCES mops.sop_template_versions(id) ON DELETE CASCADE,
  parent_id uuid REFERENCES mops.sop_nodes(id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE,
  stable_key text NOT NULL,
  asana_gid text,
  kind text NOT NULL DEFAULT 'task' CHECK (kind IN ('section','task','subtask')),
  title text NOT NULL,
  body_md text,
  sort int NOT NULL DEFAULT 0,
  area text CHECK (area IN ('discovery','access','google_ads','call_tracking','website','launch')),
  is_critical boolean NOT NULL DEFAULT false,
  legacy_req_key text,
  applicability_rule jsonb,
  verification text NOT NULL DEFAULT 'manual',
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (version_id, stable_key)
);
CREATE UNIQUE INDEX sop_nodes_gid ON mops.sop_nodes(version_id, asana_gid) WHERE asana_gid IS NOT NULL;
CREATE INDEX sop_nodes_parent ON mops.sop_nodes(parent_id);

CREATE TABLE mops.client_template_pins (
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  template_id uuid NOT NULL REFERENCES mops.sop_templates(id) ON DELETE CASCADE,
  version_id uuid NOT NULL REFERENCES mops.sop_template_versions(id),
  pinned_at timestamptz NOT NULL DEFAULT now(),
  pinned_by uuid,
  PRIMARY KEY (property_id, template_id)
);

CREATE TABLE mops.client_sop_status (
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  stable_key text NOT NULL,
  status text NOT NULL DEFAULT 'not_started' CHECK (status IN ('not_started','unknown','awaiting_access','in_progress','awaiting_verification','verified','blocked','not_applicable')),
  note text,
  evidence text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  PRIMARY KEY (property_id, stable_key)
);

CREATE TABLE mops.sop_status_history (
  id bigserial PRIMARY KEY,
  property_id uuid NOT NULL,
  stable_key text NOT NULL,
  version_id uuid,
  status text NOT NULL,
  note text,
  evidence text,
  actor uuid,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sop_hist_idx ON mops.sop_status_history(property_id, stable_key, at DESC);

CREATE TABLE mops.sop_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES mops.sop_templates(id) ON DELETE CASCADE,
  stable_key text NOT NULL,
  property_id uuid REFERENCES public.properties(id) ON DELETE CASCADE,
  file_name text NOT NULL,
  mime text,
  size_bytes int,
  storage_path text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  deleted_at timestamptz
);

CREATE TABLE mops.sop_import_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES mops.sop_templates(id) ON DELETE CASCADE,
  version_id uuid NOT NULL,
  source text,
  file_name text,
  summary jsonb,
  actor uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['sop_templates','sop_template_versions','sop_nodes','client_template_pins','client_sop_status','sop_status_history','sop_attachments','sop_import_batches'] LOOP
    EXECUTE format('REVOKE ALL ON mops.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('ALTER TABLE mops.%I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;
REVOKE ALL ON SEQUENCE mops.sop_status_history_id_seq FROM PUBLIC, anon, authenticated;

-- Status history is append-only.
CREATE FUNCTION mops.sop_history_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN RAISE EXCEPTION 'SOP status history is append-only'; END $$;
CREATE TRIGGER sop_history_append_only BEFORE UPDATE OR DELETE ON mops.sop_status_history FOR EACH ROW EXECUTE FUNCTION mops.sop_history_guard();

CREATE FUNCTION mops.sop_log_status() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status AND NEW.note IS NOT DISTINCT FROM OLD.note AND NEW.evidence IS NOT DISTINCT FROM OLD.evidence THEN RETURN NEW; END IF;
  INSERT INTO mops.sop_status_history (property_id, stable_key, version_id, status, note, evidence, actor)
  SELECT NEW.property_id, NEW.stable_key,
    (SELECT p.version_id FROM mops.client_template_pins p JOIN mops.sop_nodes n ON n.version_id = p.version_id AND n.stable_key = NEW.stable_key WHERE p.property_id = NEW.property_id LIMIT 1),
    NEW.status, NEW.note, NEW.evidence, NEW.updated_by;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION mops.sop_log_status() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER sop_status_log AFTER INSERT OR UPDATE ON mops.client_sop_status FOR EACH ROW EXECUTE FUNCTION mops.sop_log_status();

-- Questionnaire automation keeps writing client_requirements; mirror it into SOP statuses.
CREATE FUNCTION mops.sop_mirror_requirement() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE st text;
BEGIN
  IF coalesce(current_setting('mops.sop_write', true), '') = '1' THEN RETURN NEW; END IF;
  st := CASE WHEN NEW.status = 'not_started' AND coalesce(NEW.note,'') ILIKE 'unknown%' THEN 'unknown' ELSE NEW.status END;
  INSERT INTO mops.client_sop_status (property_id, stable_key, status, note, updated_at)
  VALUES (NEW.property_id, NEW.req_key, st, NEW.note, NEW.updated_at)
  ON CONFLICT (property_id, stable_key) DO UPDATE SET status = EXCLUDED.status, note = EXCLUDED.note, updated_at = EXCLUDED.updated_at
  WHERE client_sop_status.status IS DISTINCT FROM EXCLUDED.status OR client_sop_status.note IS DISTINCT FROM EXCLUDED.note;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION mops.sop_mirror_requirement() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER sop_mirror AFTER INSERT OR UPDATE ON mops.client_requirements FOR EACH ROW EXECUTE FUNCTION mops.sop_mirror_requirement();

-- Seed version 1 from the existing requirement catalog (descriptions stay empty = "missing").
INSERT INTO mops.sop_templates (key, name, description, sort) VALUES
  ('discovery', 'Business Discovery', 'Questionnaire and discovery before any setup work.', 0),
  ('google_ads', 'Google Ads onboarding', 'Account access, Google Ads configuration, budget and billing.', 1),
  ('ctm', 'CallTrackingMetrics onboarding', 'Platform access, call tracking setup, website and forms.', 2);
INSERT INTO mops.sop_template_versions (template_id, version_no, status, note, published_at)
  SELECT id, 1, 'approved', 'Initial version created from the existing onboarding checklist', now() FROM mops.sop_templates;

CREATE TEMP TABLE _sec (tkey text, skey text, title text, area text, sort int) ON COMMIT DROP;
INSERT INTO _sec VALUES
  ('discovery','sec_questionnaire','Questionnaire','discovery',0),
  ('google_ads','sec_gads_access','Account access','access',0),
  ('google_ads','sec_gads_config','Google Ads configuration','google_ads',1),
  ('google_ads','sec_billing','Budget & billing','launch',2),
  ('ctm','sec_ctm_access','Platform access','access',0),
  ('ctm','sec_ctm_setup','Call tracking setup','call_tracking',1),
  ('ctm','sec_web_forms','Website & forms','website',2);
INSERT INTO mops.sop_nodes (version_id, stable_key, kind, title, sort, area)
  SELECT v.id, s.skey, 'section', s.title, s.sort, s.area
  FROM _sec s JOIN mops.sop_templates t ON t.key = s.tkey JOIN mops.sop_template_versions v ON v.template_id = t.id AND v.version_no = 1;

INSERT INTO mops.sop_nodes (version_id, parent_id, stable_key, kind, title, sort, area, verification, is_critical)
  SELECT sec.version_id, sec.id, 'discovery_questionnaire', 'task', 'Onboarding questionnaire submitted', 0, 'discovery', 'auto', true
  FROM mops.sop_nodes sec WHERE sec.stable_key = 'sec_questionnaire';

INSERT INTO mops.sop_nodes (version_id, parent_id, stable_key, kind, title, sort, area, legacy_req_key, verification, body_md, is_critical)
  SELECT sec.version_id, sec.id, c.key, 'task', c.title, c.sort,
    CASE WHEN c.key IN ('gads_kickoff','ctm_handoff','billing_active') THEN 'launch'
         WHEN c.area = 'access' THEN 'access' WHEN c.area = 'google_ads' THEN 'google_ads' WHEN c.area = 'ctm' THEN 'call_tracking'
         WHEN c.area IN ('ghl_forms','website') THEN 'website' ELSE 'launch' END,
    c.key, c.verification, c.instructions,
    c.key IN ('access_google_ads','access_ctm','gads_ctm','gads_conversions','gads_budget','ctm_config','ctm_testing','form_e2e','billing_active')
  FROM mops.requirement_catalog c
  JOIN mops.sop_nodes sec ON sec.stable_key = CASE
    WHEN c.key IN ('access_google_ads','access_ga4','access_gtm','access_search_console','access_gbp') THEN 'sec_gads_access'
    WHEN c.key IN ('access_ctm','access_ghl','access_website') THEN 'sec_ctm_access'
    WHEN c.area = 'google_ads' THEN 'sec_gads_config'
    WHEN c.area = 'billing' THEN 'sec_billing'
    WHEN c.area = 'ctm' THEN 'sec_ctm_setup'
    ELSE 'sec_web_forms' END;

-- Pin every existing client to version 1 and carry over any existing statuses unchanged.
INSERT INTO mops.client_template_pins (property_id, template_id, version_id)
  SELECT l.property_id, v.template_id, v.id FROM mops.client_lifecycle l CROSS JOIN mops.sop_template_versions v WHERE v.version_no = 1
  ON CONFLICT DO NOTHING;
INSERT INTO mops.client_sop_status (property_id, stable_key, status, note, updated_at)
  SELECT property_id, req_key, CASE WHEN status = 'not_started' AND coalesce(note,'') ILIKE 'unknown%' THEN 'unknown' ELSE status END, note, updated_at
  FROM mops.client_requirements ON CONFLICT DO NOTHING;

COMMENT ON TABLE mops.requirement_catalog IS 'DEPRECATED for display: superseded by mops.sop_nodes (version 1 seeded from here). Still read by questionnaire automation.';

-- Clone a version's node tree into another version.
CREATE FUNCTION mops.sop_clone_version(_src uuid, _dst uuid) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  WITH m AS (SELECT id AS old_id, gen_random_uuid() AS new_id FROM mops.sop_nodes WHERE version_id = _src)
  INSERT INTO mops.sop_nodes (id, version_id, parent_id, stable_key, asana_gid, kind, title, body_md, sort, area, is_critical, legacy_req_key, applicability_rule, verification)
  SELECT m.new_id, _dst, pm.new_id, n.stable_key, n.asana_gid, n.kind, n.title, n.body_md, n.sort, n.area, n.is_critical, n.legacy_req_key, n.applicability_rule, n.verification
  FROM mops.sop_nodes n JOIN m ON m.old_id = n.id LEFT JOIN m pm ON pm.old_id = n.parent_id
$$;
REVOKE ALL ON FUNCTION mops.sop_clone_version(uuid,uuid) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION mops.sop_nodes_json(_vid uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', id, 'parent_id', parent_id, 'stable_key', stable_key, 'asana_gid', asana_gid, 'kind', kind,
    'title', title, 'body_md', body_md, 'sort', sort, 'area', area, 'is_critical', is_critical, 'legacy_req_key', legacy_req_key,
    'applicability_rule', applicability_rule, 'verification', verification) ORDER BY sort, title), '[]'::jsonb)
  FROM mops.sop_nodes WHERE version_id = _vid
$$;
REVOKE ALL ON FUNCTION mops.sop_nodes_json(uuid) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION mops.sop_latest(_tid uuid) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT id FROM mops.sop_template_versions WHERE template_id = _tid AND status = 'approved' ORDER BY version_no DESC LIMIT 1
$$;
REVOKE ALL ON FUNCTION mops.sop_latest(uuid) FROM PUBLIC, anon, authenticated, service_role;

-- New clients (no pin yet) are pinned to the latest approved version of every template.
CREATE FUNCTION mops.sop_ensure_pins(_pid uuid) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  INSERT INTO mops.client_template_pins (property_id, template_id, version_id)
  SELECT _pid, t.id, mops.sop_latest(t.id) FROM mops.sop_templates t WHERE mops.sop_latest(t.id) IS NOT NULL
  ON CONFLICT DO NOTHING
$$;
REVOKE ALL ON FUNCTION mops.sop_ensure_pins(uuid) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION mops.sop_auto(_pid uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE ev jsonb := mops.evidence(_pid); l record; res jsonb := '{}'::jsonb; k text;
BEGIN
  SELECT classification, questionnaire_submitted_at, questionnaire_status INTO l FROM mops.client_lifecycle WHERE property_id = _pid;
  res := jsonb_build_object('discovery_questionnaire',
    CASE WHEN l.questionnaire_submitted_at IS NOT NULL OR l.questionnaire_status = 'submitted' THEN 'verified'
         WHEN l.classification = 'legacy' THEN 'unknown'
         WHEN l.questionnaire_status IN ('sent','in_progress') THEN 'in_progress' ELSE 'not_started' END);
  FOR k IN SELECT key FROM mops.requirement_catalog LOOP
    IF mops.auto_status(k, ev) IS NOT NULL THEN res := res || jsonb_build_object(k, mops.auto_status(k, ev)); END IF;
  END LOOP;
  RETURN res;
END $$;
REVOKE ALL ON FUNCTION mops.sop_auto(uuid) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION mops.sop_answers(_pid uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT s.answers FROM public.onboarding_submissions s LEFT JOIN public.onboarding_invites i ON i.id = s.invite_id
  WHERE coalesce(s.property_id, i.property_id) = _pid AND s.submitted_at IS NOT NULL ORDER BY s.updated_at DESC LIMIT 1
$$;
REVOKE ALL ON FUNCTION mops.sop_answers(uuid) FROM PUBLIC, anon, authenticated, service_role;

-- Private SOP entry point. Same contract as mops_api: grant re-checked for the token-derived actor; every call audited.
CREATE FUNCTION public.mops_sop_api(_actor uuid, _endpoint text, _op text, _args jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  pid uuid := nullif(_args->>'property_id','')::uuid;
  tid uuid := nullif(_args->>'template_id','')::uuid;
  vid uuid;
  nid uuid;
  res jsonb;
  n record;
  a jsonb;
  tmp jsonb := '{}'::jsonb;
  par uuid;
  newk text;
  cnt_c int := 0; cnt_u int := 0;
BEGIN
  IF NOT mops.check_grant(_actor) THEN
    INSERT INTO mops.audit_log (actor, endpoint, op, outcome) VALUES (_actor, _endpoint, _op, 'denied');
    RETURN jsonb_build_object('error','not_found');
  END IF;
  INSERT INTO mops.audit_log (actor, endpoint, op, target, outcome)
    VALUES (_actor, _endpoint, _op, coalesce(pid::text, tid::text, _args->>'id'), 'allowed');

  IF _op = 'sop_templates' THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'id', t.id, 'key', t.key, 'name', t.name, 'description', t.description,
      'versions', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', v.id, 'version_no', v.version_no, 'status', v.status, 'note', v.note, 'published_at', v.published_at, 'created_at', v.created_at) ORDER BY v.version_no DESC NULLS FIRST), '[]'::jsonb) FROM mops.sop_template_versions v WHERE v.template_id = t.id),
      'latest_id', mops.sop_latest(t.id),
      'missing', (SELECT count(*) FROM mops.sop_nodes x WHERE x.version_id = mops.sop_latest(t.id) AND x.kind <> 'section' AND coalesce(trim(x.body_md),'') = ''),
      'tasks', (SELECT count(*) FROM mops.sop_nodes x WHERE x.version_id = mops.sop_latest(t.id) AND x.kind <> 'section')
    ) ORDER BY t.sort), '[]'::jsonb) INTO res FROM mops.sop_templates t;
    RETURN jsonb_build_object('templates', res);

  ELSIF _op = 'sop_tree' THEN
    vid := nullif(_args->>'version_id','')::uuid;
    IF vid IS NULL THEN RETURN jsonb_build_object('error','version_id required'); END IF;
    RETURN jsonb_build_object('version', (SELECT to_jsonb(v) FROM mops.sop_template_versions v WHERE v.id = vid), 'nodes', mops.sop_nodes_json(vid),
      'attachments', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'stable_key', x.stable_key, 'file_name', x.file_name, 'mime', x.mime, 'size_bytes', x.size_bytes)), '[]'::jsonb)
        FROM mops.sop_attachments x JOIN mops.sop_template_versions v ON v.template_id = x.template_id AND v.id = vid WHERE x.deleted_at IS NULL AND x.property_id IS NULL));

  ELSIF _op = 'sop_draft_ensure' THEN
    SELECT id INTO vid FROM mops.sop_template_versions WHERE template_id = tid AND status = 'draft';
    IF vid IS NULL THEN
      INSERT INTO mops.sop_template_versions (template_id, status) VALUES (tid, 'draft') RETURNING id INTO vid;
      IF mops.sop_latest(tid) IS NOT NULL THEN PERFORM mops.sop_clone_version(mops.sop_latest(tid), vid); END IF;
    END IF;
    RETURN jsonb_build_object('version_id', vid);

  ELSIF _op = 'sop_draft_discard' THEN
    DELETE FROM mops.sop_template_versions WHERE template_id = tid AND status = 'draft';
    RETURN jsonb_build_object('ok', true);

  ELSIF _op IN ('sop_node_create','sop_node_update','sop_node_delete','sop_node_move') THEN
    IF _op = 'sop_node_create' THEN vid := (_args->>'version_id')::uuid;
    ELSE SELECT version_id INTO vid FROM mops.sop_nodes WHERE id = (_args->>'id')::uuid; END IF;
    IF NOT EXISTS (SELECT 1 FROM mops.sop_template_versions WHERE id = vid AND status = 'draft') THEN
      RETURN jsonb_build_object('error','Only drafts can be edited. Start a draft first.');
    END IF;
    IF _op = 'sop_node_create' THEN
      par := nullif(_args->>'parent_id','')::uuid;
      IF par IS NOT NULL AND NOT EXISTS (SELECT 1 FROM mops.sop_nodes WHERE id = par AND version_id = vid) THEN RETURN jsonb_build_object('error','Parent not in this draft'); END IF;
      INSERT INTO mops.sop_nodes (version_id, parent_id, stable_key, kind, title, body_md, sort, area, is_critical)
      VALUES (vid, par, 'n_' || replace(gen_random_uuid()::text,'-',''),
        coalesce(_args->>'kind', CASE WHEN par IS NULL THEN 'section' ELSE 'task' END),
        coalesce(nullif(trim(_args->>'title'),''), 'Untitled'), nullif(_args->>'body_md',''),
        coalesce((_args->>'sort')::int, (SELECT coalesce(max(sort),0) + 10 FROM mops.sop_nodes WHERE version_id = vid AND parent_id IS NOT DISTINCT FROM par)),
        coalesce(_args->>'area', (SELECT area FROM mops.sop_nodes WHERE id = par)), coalesce((_args->>'is_critical')::boolean, false))
      RETURNING mops.sop_nodes.id INTO nid;
      RETURN jsonb_build_object('id', nid);
    ELSIF _op = 'sop_node_update' THEN
      UPDATE mops.sop_nodes SET
        title = CASE WHEN _args ? 'title' THEN coalesce(nullif(trim(_args->>'title'),''), title) ELSE title END,
        body_md = CASE WHEN _args ? 'body_md' THEN nullif(_args->>'body_md','') ELSE body_md END,
        kind = coalesce(_args->>'kind', kind),
        area = CASE WHEN _args ? 'area' THEN nullif(_args->>'area','') ELSE area END,
        is_critical = coalesce((_args->>'is_critical')::boolean, is_critical),
        applicability_rule = CASE WHEN _args ? 'applicability_rule' THEN nullif(_args->'applicability_rule','null'::jsonb) ELSE applicability_rule END,
        updated_at = now()
      WHERE id = (_args->>'id')::uuid;
      RETURN jsonb_build_object('ok', true);
    ELSIF _op = 'sop_node_delete' THEN
      DELETE FROM mops.sop_nodes WHERE id = (_args->>'id')::uuid;
      RETURN jsonb_build_object('ok', true);
    ELSE
      nid := (_args->>'id')::uuid;
      par := nullif(_args->>'parent_id','')::uuid;
      IF par IS NOT NULL THEN
        IF NOT EXISTS (SELECT 1 FROM mops.sop_nodes WHERE id = par AND version_id = vid) THEN RETURN jsonb_build_object('error','Parent not in this draft'); END IF;
        IF EXISTS (WITH RECURSIVE up AS (SELECT id, parent_id FROM mops.sop_nodes WHERE id = par UNION ALL SELECT s.id, s.parent_id FROM mops.sop_nodes s JOIN up ON s.id = up.parent_id) SELECT 1 FROM up WHERE id = nid) THEN
          RETURN jsonb_build_object('error','A task cannot be moved inside itself');
        END IF;
      END IF;
      UPDATE mops.sop_nodes SET parent_id = par, sort = coalesce((_args->>'sort')::int, sort),
        kind = CASE WHEN par IS NULL THEN 'section' WHEN (SELECT parent_id FROM mops.sop_nodes WHERE id = par) IS NULL THEN 'task' ELSE 'subtask' END,
        updated_at = now() WHERE id = nid;
      RETURN jsonb_build_object('ok', true);
    END IF;

  ELSIF _op = 'sop_publish' THEN
    SELECT id INTO vid FROM mops.sop_template_versions WHERE template_id = tid AND status = 'draft';
    IF vid IS NULL THEN RETURN jsonb_build_object('error','No draft to publish'); END IF;
    UPDATE mops.sop_template_versions SET status = 'approved', published_at = now(), published_by = _actor, note = nullif(_args->>'note',''),
      version_no = (SELECT coalesce(max(version_no),0) + 1 FROM mops.sop_template_versions WHERE template_id = tid)
    WHERE id = vid;
    RETURN jsonb_build_object('version_id', vid);

  ELSIF _op = 'sop_client' THEN
    IF pid IS NULL THEN RETURN jsonb_build_object('error','property_id required'); END IF;
    PERFORM mops.sop_ensure_pins(pid);
    RETURN jsonb_build_object(
      'classification', (SELECT classification FROM mops.client_lifecycle WHERE property_id = pid),
      'pins', (SELECT coalesce(jsonb_agg(jsonb_build_object('template_id', p.template_id, 'template_name', t.name, 'template_key', t.key, 'sort', t.sort,
          'version_id', p.version_id, 'version_no', v.version_no, 'latest_id', mops.sop_latest(p.template_id),
          'latest_no', (SELECT version_no FROM mops.sop_template_versions WHERE id = mops.sop_latest(p.template_id)),
          'nodes', mops.sop_nodes_json(p.version_id)) ORDER BY t.sort), '[]'::jsonb)
        FROM mops.client_template_pins p JOIN mops.sop_templates t ON t.id = p.template_id JOIN mops.sop_template_versions v ON v.id = p.version_id WHERE p.property_id = pid),
      'statuses', (SELECT coalesce(jsonb_object_agg(stable_key, jsonb_build_object('status', status, 'note', note, 'evidence', evidence, 'updated_at', updated_at)), '{}'::jsonb) FROM mops.client_sop_status WHERE property_id = pid),
      'auto', mops.sop_auto(pid),
      'answers', mops.sop_answers(pid),
      'attachments', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'stable_key', x.stable_key, 'file_name', x.file_name, 'mime', x.mime, 'size_bytes', x.size_bytes, 'client', x.property_id IS NOT NULL)), '[]'::jsonb)
        FROM mops.sop_attachments x WHERE x.deleted_at IS NULL AND (x.property_id IS NULL OR x.property_id = pid)));

  ELSIF _op = 'sop_portfolio' THEN
    PERFORM mops.sop_ensure_pins(l.property_id) FROM mops.client_lifecycle l;
    RETURN jsonb_build_object(
      'versions', (SELECT coalesce(jsonb_object_agg(vv.version_id, mops.sop_nodes_json(vv.version_id)), '{}'::jsonb) FROM (SELECT DISTINCT version_id FROM mops.client_template_pins) vv),
      'clients', (SELECT coalesce(jsonb_agg(jsonb_build_object(
          'property_id', l.property_id, 'classification', l.classification,
          'pins', (SELECT coalesce(jsonb_agg(version_id), '[]'::jsonb) FROM mops.client_template_pins WHERE property_id = l.property_id),
          'statuses', (SELECT coalesce(jsonb_object_agg(stable_key, jsonb_build_object('status', status)), '{}'::jsonb) FROM mops.client_sop_status WHERE property_id = l.property_id),
          'auto', mops.sop_auto(l.property_id),
          'answers', mops.sop_answers(l.property_id))), '[]'::jsonb) FROM mops.client_lifecycle l));

  ELSIF _op = 'sop_status_set' THEN
    IF pid IS NULL OR coalesce(_args->>'stable_key','') = '' THEN RETURN jsonb_build_object('error','property_id and stable_key required'); END IF;
    IF NOT EXISTS (SELECT 1 FROM mops.client_template_pins p JOIN mops.sop_nodes x ON x.version_id = p.version_id AND x.stable_key = _args->>'stable_key' AND x.kind <> 'section' WHERE p.property_id = pid) THEN
      RETURN jsonb_build_object('error','Task is not part of this client''s procedures');
    END IF;
    PERFORM set_config('mops.sop_write', '1', true);
    INSERT INTO mops.client_sop_status (property_id, stable_key, status, note, evidence, updated_at, updated_by)
    VALUES (pid, _args->>'stable_key', coalesce(_args->>'status','not_started'), nullif(_args->>'note',''), nullif(_args->>'evidence',''), now(), _actor)
    ON CONFLICT (property_id, stable_key) DO UPDATE SET
      status = CASE WHEN _args ? 'status' THEN EXCLUDED.status ELSE client_sop_status.status END,
      note = CASE WHEN _args ? 'note' THEN EXCLUDED.note ELSE client_sop_status.note END,
      evidence = CASE WHEN _args ? 'evidence' THEN EXCLUDED.evidence ELSE client_sop_status.evidence END,
      updated_at = now(), updated_by = _actor
    RETURNING to_jsonb(client_sop_status.*) INTO res;
    IF EXISTS (SELECT 1 FROM mops.requirement_catalog WHERE key = _args->>'stable_key') AND _args ? 'status' THEN
      INSERT INTO mops.client_requirements (property_id, req_key, status, severity, note)
      VALUES (pid, _args->>'stable_key', CASE WHEN res->>'status' = 'unknown' THEN 'not_started' ELSE res->>'status' END,
              CASE WHEN res->>'status' = 'not_applicable' THEN 'warning' ELSE 'blocking' END, res->>'note')
      ON CONFLICT (property_id, req_key) DO UPDATE SET status = EXCLUDED.status, note = coalesce(EXCLUDED.note, client_requirements.note), updated_at = now();
    END IF;
    PERFORM set_config('mops.sop_write', '', true);
    UPDATE mops.client_lifecycle SET last_activity_at = now() WHERE property_id = pid;
    RETURN res;

  ELSIF _op = 'sop_history' THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object('status', h.status, 'note', h.note, 'evidence', h.evidence, 'at', h.at, 'version_no', v.version_no, 'by_you', h.actor IS NOT NULL) ORDER BY h.at DESC), '[]'::jsonb) INTO res
    FROM mops.sop_status_history h LEFT JOIN mops.sop_template_versions v ON v.id = h.version_id
    WHERE h.property_id = pid AND h.stable_key = _args->>'stable_key';
    RETURN jsonb_build_object('history', res);

  ELSIF _op = 'sop_apply_update' THEN
    vid := mops.sop_latest(tid);
    IF pid IS NULL OR vid IS NULL THEN RETURN jsonb_build_object('error','property_id and template_id required'); END IF;
    INSERT INTO mops.audit_log (actor, endpoint, op, target, outcome, detail)
      VALUES (_actor, _endpoint, 'sop_apply_update', pid::text, 'allowed', jsonb_build_object('template_id', tid, 'from', (SELECT version_id FROM mops.client_template_pins WHERE property_id = pid AND template_id = tid), 'to', vid));
    INSERT INTO mops.client_template_pins (property_id, template_id, version_id, pinned_by) VALUES (pid, tid, vid, _actor)
    ON CONFLICT (property_id, template_id) DO UPDATE SET version_id = EXCLUDED.version_id, pinned_at = now(), pinned_by = _actor;
    RETURN jsonb_build_object('version_id', vid);

  ELSIF _op = 'sop_import_commit' THEN
    SELECT id INTO vid FROM mops.sop_template_versions WHERE template_id = tid AND status = 'draft';
    IF vid IS NULL THEN RETURN jsonb_build_object('error','Start a draft before importing'); END IF;
    FOR a IN SELECT * FROM jsonb_array_elements(coalesce(_args->'actions','[]'::jsonb)) LOOP
      IF a->>'action' = 'create' THEN
        par := coalesce(nullif(a->>'parent_id','')::uuid, nullif(tmp->>(a->>'parent_ref'),'')::uuid);
        IF par IS NOT NULL AND NOT EXISTS (SELECT 1 FROM mops.sop_nodes WHERE id = par AND version_id = vid) THEN RAISE EXCEPTION 'Import parent not in draft'; END IF;
        newk := 'n_' || replace(gen_random_uuid()::text,'-','');
        INSERT INTO mops.sop_nodes (version_id, parent_id, stable_key, asana_gid, kind, title, body_md, sort, area)
        VALUES (vid, par, newk, nullif(a->>'asana_gid',''),
          CASE WHEN par IS NULL THEN 'section' WHEN (SELECT parent_id FROM mops.sop_nodes WHERE id = par) IS NULL THEN 'task' ELSE 'subtask' END,
          coalesce(nullif(trim(a->>'title'),''),'Untitled'), nullif(a->>'body_md',''),
          coalesce((a->>'sort')::int, (SELECT coalesce(max(sort),0) + 10 FROM mops.sop_nodes WHERE version_id = vid AND parent_id IS NOT DISTINCT FROM par)),
          coalesce(nullif(a->>'area',''), (SELECT area FROM mops.sop_nodes WHERE id = par)))
        RETURNING mops.sop_nodes.id INTO nid;
        IF a->>'ref' IS NOT NULL THEN tmp := tmp || jsonb_build_object(a->>'ref', nid); END IF;
        cnt_c := cnt_c + 1;
      ELSIF a->>'action' = 'update' THEN
        UPDATE mops.sop_nodes SET
          body_md = CASE WHEN a ? 'body_md' THEN nullif(a->>'body_md','') ELSE body_md END,
          asana_gid = coalesce(nullif(a->>'asana_gid',''), asana_gid), updated_at = now()
        WHERE id = (a->>'node_id')::uuid AND version_id = vid;
        IF NOT FOUND THEN RAISE EXCEPTION 'Import target not in draft'; END IF;
        cnt_u := cnt_u + 1;
      ELSIF a->>'action' = 'link' THEN
        UPDATE mops.sop_nodes SET asana_gid = coalesce(nullif(a->>'asana_gid',''), asana_gid) WHERE id = (a->>'node_id')::uuid AND version_id = vid;
      END IF;
    END LOOP;
    INSERT INTO mops.sop_import_batches (template_id, version_id, source, file_name, summary, actor)
      VALUES (tid, vid, _args->>'source', _args->>'file_name', coalesce(_args->'summary','{}'::jsonb) || jsonb_build_object('created', cnt_c, 'updated', cnt_u), _actor);
    RETURN jsonb_build_object('created', cnt_c, 'updated', cnt_u);

  ELSIF _op = 'sop_attach_add' THEN
    INSERT INTO mops.sop_attachments (template_id, stable_key, property_id, file_name, mime, size_bytes, storage_path, created_by)
    VALUES (tid, _args->>'stable_key', pid, left(_args->>'file_name', 200), _args->>'mime', (_args->>'size_bytes')::int,
      coalesce(tid::text,'x') || '/' || gen_random_uuid()::text, _actor)
    RETURNING jsonb_build_object('id', id, 'storage_path', storage_path) INTO res;
    RETURN res;

  ELSIF _op = 'sop_attach_get' THEN
    SELECT jsonb_build_object('storage_path', storage_path, 'file_name', file_name) INTO res FROM mops.sop_attachments WHERE id = (_args->>'id')::uuid AND deleted_at IS NULL;
    RETURN coalesce(res, jsonb_build_object('error','not_found'));

  ELSIF _op = 'sop_attach_delete' THEN
    UPDATE mops.sop_attachments SET deleted_at = now() WHERE id = (_args->>'id')::uuid;
    RETURN jsonb_build_object('ok', true);
  END IF;

  RETURN jsonb_build_object('error','unknown_op');
END $$;
REVOKE ALL ON FUNCTION public.mops_sop_api(uuid,text,text,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mops_sop_api(uuid,text,text,jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.mops_privilege_audit()
 RETURNS TABLE(finding text) LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $function$
  SELECT 'schema usage: ' || r FROM unnest(ARRAY['anon','authenticated']) r WHERE has_schema_privilege(r, 'mops', 'USAGE')
  UNION ALL
  SELECT 'table ' || c.relname || ' ' || r || ' ' || p FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN unnest(ARRAY['anon','authenticated']) r CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE']) p
    WHERE n.nspname = 'mops' AND c.relkind = 'r' AND has_table_privilege(r, c.oid, p)
  UNION ALL
  SELECT 'rls off: ' || c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'mops' AND c.relkind = 'r' AND NOT c.relrowsecurity
  UNION ALL
  SELECT 'public fn executable by ' || r || ': ' || f FROM unnest(ARRAY['public.mops_api(uuid,text,text,jsonb)','public.mops_sop_api(uuid,text,text,jsonb)','public.mops_audit_event(uuid,text,text,jsonb)','public.mops_ingest_changes(text,jsonb,timestamptz,boolean,text)','public.mops_change_sync_state()','public.mops_privilege_audit()']) f
    CROSS JOIN unnest(ARRAY['anon','authenticated']) r WHERE has_function_privilege(r, f::regprocedure, 'EXECUTE')
  UNION ALL
  SELECT 'unexpected function reading mops: ' || n.nspname || '.' || p.proname
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname NOT IN ('mops','pg_catalog','information_schema') AND p.prosrc ILIKE '%mops.%'
      AND p.proname NOT IN ('mops_api','mops_sop_api','mops_my_access','mops_audit_event','mops_ingest_changes','mops_change_sync_state','mops_privilege_audit')
  UNION ALL
  SELECT 'active grants != 1' WHERE (SELECT count(*) FROM mops.access_grants WHERE revoked_at IS NULL) <> 1
$function$;
REVOKE ALL ON FUNCTION public.mops_privilege_audit() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mops_privilege_audit() TO service_role;