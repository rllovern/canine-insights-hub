CREATE OR REPLACE FUNCTION mops.generate_requirements(_pid uuid, _answers jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  forms_na boolean := jsonb_typeof(_answers->'booking_method') = 'array'
                      AND jsonb_array_length(_answers->'booking_method') > 0
                      AND NOT (_answers->'booking_method' ? 'Web form then callback');
  ctm_existing boolean := _answers->>'has_call_tracking' = 'Yes' AND coalesce(_answers->>'call_tracking_vendor','') ~* '(ctm|calltrackingmetrics|call tracking metrics)';
  ghl_existing boolean := _answers->>'has_crm' = 'Yes' AND coalesce(_answers->>'crm_name','') ~* '(ghl|go ?high ?level|highlevel|lead ?connector)';
BEGIN
  -- Assets: existing -> access needed; missing -> create; unknown -> discovery.
  INSERT INTO mops.client_assets (property_id, platform, exists_state, access_status, external_id, note)
  SELECT _pid, p.platform, p.ex, p.acc, nullif(p.ext,''), p.note
  FROM (VALUES
    ('google_ads', CASE _answers->>'has_google_ads' WHEN 'Yes' THEN 'yes' WHEN 'No' THEN 'no' ELSE 'unknown' END,
                   CASE _answers->>'has_google_ads' WHEN 'Yes' THEN 'needed' WHEN 'No' THEN 'create_new' ELSE 'unknown' END, _answers->>'google_ads_cid', NULL),
    ('ga4', CASE _answers->>'has_ga4' WHEN 'Yes' THEN 'yes' WHEN 'No' THEN 'no' ELSE 'unknown' END,
            CASE _answers->>'has_ga4' WHEN 'Yes' THEN 'needed' WHEN 'No' THEN 'create_new' ELSE 'unknown' END, _answers->>'ga4_id', NULL),
    ('gtm', CASE _answers->>'has_gtm' WHEN 'Yes' THEN 'yes' WHEN 'No' THEN 'no' ELSE 'unknown' END,
            CASE _answers->>'has_gtm' WHEN 'Yes' THEN 'needed' WHEN 'No' THEN 'create_new' ELSE 'unknown' END, _answers->>'gtm_id', NULL),
    ('ctm', CASE WHEN ctm_existing THEN 'yes' WHEN _answers->>'has_call_tracking' IN ('Yes','No') THEN 'no' ELSE 'unknown' END,
            CASE WHEN ctm_existing THEN 'needed' WHEN _answers->>'has_call_tracking' IN ('Yes','No') THEN 'create_new' ELSE 'unknown' END,
            NULL, CASE WHEN _answers->>'has_call_tracking' = 'Yes' AND NOT ctm_existing THEN 'Currently uses ' || coalesce(_answers->>'call_tracking_vendor','another vendor') END),
    ('ghl', CASE WHEN ghl_existing THEN 'yes' WHEN _answers->>'has_crm' IN ('Yes','No') THEN 'no' ELSE 'unknown' END,
            CASE WHEN ghl_existing THEN 'needed' WHEN _answers->>'has_crm' IN ('Yes','No') THEN 'create_new' ELSE 'unknown' END,
            NULL, CASE WHEN _answers->>'has_crm' = 'Yes' AND NOT ghl_existing THEN 'Currently uses ' || coalesce(_answers->>'crm_name','another CRM') END),
    ('website', CASE WHEN coalesce(_answers->>'website_url','') <> '' THEN 'yes' ELSE 'unknown' END,
                CASE WHEN coalesce(_answers->>'website_url','') <> '' THEN 'needed' ELSE 'unknown' END, _answers->>'website_url', _answers->>'website_platform'),
    ('gbp', CASE WHEN coalesce(_answers->>'gbp_url','') <> '' THEN 'yes' ELSE 'unknown' END,
            CASE WHEN coalesce(_answers->>'gbp_url','') <> '' THEN 'needed' ELSE 'unknown' END, _answers->>'gbp_url', NULL),
    ('search_console', 'unknown', 'unknown', NULL, NULL)
  ) AS p(platform, ex, acc, ext, note)
  ON CONFLICT (property_id, platform) DO NOTHING;

  -- Requirements. Existing rows (manual overrides) are never touched.
  INSERT INTO mops.client_requirements (property_id, req_key, status, severity, note)
  SELECT _pid, c.key, x.status,
         CASE WHEN x.status = 'not_applicable' THEN 'warning'
              WHEN c.area IN ('access','google_ads','ctm','billing') THEN 'blocking' ELSE 'warning' END,
         x.note
  FROM mops.requirement_catalog c
  CROSS JOIN LATERAL (
    SELECT
      CASE
        WHEN c.area = 'ghl_forms' AND forms_na THEN 'not_applicable'
        WHEN c.key = 'access_google_ads' AND _answers->>'has_google_ads' = 'Yes' THEN 'awaiting_access'
        WHEN c.key = 'access_ga4' AND _answers->>'has_ga4' = 'Yes' THEN 'awaiting_access'
        WHEN c.key = 'access_gtm' AND _answers->>'has_gtm' = 'Yes' THEN 'awaiting_access'
        WHEN c.key = 'access_ctm' AND ctm_existing THEN 'awaiting_access'
        WHEN c.key = 'access_ghl' AND ghl_existing THEN 'awaiting_access'
        WHEN c.key = 'access_website' AND coalesce(_answers->>'website_url','') <> '' THEN 'awaiting_access'
        WHEN c.key = 'access_gbp' AND coalesce(_answers->>'gbp_url','') <> '' THEN 'awaiting_access'
        ELSE 'not_started'
      END AS status,
      CASE
        WHEN c.area = 'ghl_forms' AND forms_na THEN 'Not applicable: questionnaire says leads do not book through web forms.'
        WHEN c.key = 'access_google_ads' THEN CASE _answers->>'has_google_ads' WHEN 'Yes' THEN 'Existing account ' || coalesce(_answers->>'google_ads_cid','') || ': request access.' WHEN 'No' THEN 'No existing account: create under the corporate manager account.' ELSE 'Unknown: confirm whether an account exists.' END
        WHEN c.key = 'access_ga4' THEN CASE _answers->>'has_ga4' WHEN 'Yes' THEN 'Existing property: request access.' WHEN 'No' THEN 'No existing property: create new.' ELSE 'Unknown: check the website for Analytics.' END
        WHEN c.key = 'access_gtm' THEN CASE _answers->>'has_gtm' WHEN 'Yes' THEN 'Existing container: request access.' WHEN 'No' THEN 'No existing container: create new.' ELSE 'Unknown: check the website for Tag Manager.' END
        WHEN c.key = 'access_ctm' THEN CASE WHEN ctm_existing THEN 'Existing CTM account: request access.' WHEN _answers->>'has_call_tracking' = 'Yes' THEN 'Uses ' || coalesce(_answers->>'call_tracking_vendor','another vendor') || ': create CTM and plan replacement.' WHEN _answers->>'has_call_tracking' = 'No' THEN 'No call tracking: create CTM account.' ELSE 'Unknown: confirm current call tracking.' END
        WHEN c.key = 'access_ghl' THEN CASE WHEN ghl_existing THEN 'Existing GoHighLevel: request connection.' WHEN _answers->>'has_crm' = 'Yes' THEN 'Uses ' || coalesce(_answers->>'crm_name','another CRM') || ': set up GoHighLevel and plan migration.' WHEN _answers->>'has_crm' = 'No' THEN 'No CRM: set up GoHighLevel.' ELSE 'Unknown: confirm current CRM.' END
        WHEN c.key = 'access_website' THEN CASE WHEN coalesce(_answers->>'website_url','') <> '' THEN 'Existing site (' || coalesce(_answers->>'website_platform','platform unknown') || '): request access.' ELSE 'Unknown: confirm the website.' END
        WHEN c.key = 'access_gbp' THEN CASE WHEN coalesce(_answers->>'gbp_url','') <> '' THEN 'Existing profile: request access.' ELSE 'No profile link given: confirm whether one exists or must be created.' END
        WHEN c.key = 'access_search_console' THEN 'Unknown: check whether the site is verified.'
        ELSE NULL
      END AS note
  ) x
  ON CONFLICT (property_id, req_key) DO NOTHING;

  -- Record automatic not-applicable decisions for traceability.
  INSERT INTO mops.requirement_decisions (property_id, req_key, resolution, reason)
  SELECT _pid, r.req_key, 'auto_not_applicable', r.note
  FROM mops.client_requirements r
  WHERE r.property_id = _pid AND r.status = 'not_applicable' AND r.note LIKE 'Not applicable:%'
    AND NOT EXISTS (SELECT 1 FROM mops.requirement_decisions d WHERE d.property_id = _pid AND d.req_key = r.req_key);
END $$;
REVOKE ALL ON FUNCTION mops.generate_requirements(uuid, jsonb) FROM PUBLIC, anon, service_role;