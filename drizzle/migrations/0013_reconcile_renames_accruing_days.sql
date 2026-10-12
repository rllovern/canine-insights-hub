CREATE OR REPLACE FUNCTION public.reconcile_campaign_renames(_property_id uuid, _current jsonb, _dry_run boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  pair record; cid text; cur_name text; m int; r int; mc numeric; out jsonb := '[]'::jsonb;
BEGIN
  FOR cid, cur_name IN SELECT key, value #>> '{}' FROM jsonb_each(_current) LOOP
    IF NOT _dry_run THEN
      UPDATE daily_metrics SET campaign_id = cid
      WHERE property_id = _property_id AND ad_source = 'Google PPC' AND campaign = cur_name AND campaign_id IS DISTINCT FROM cid;
    END IF;
  END LOOP;

  FOR pair IN
    WITH cur AS (SELECT key AS cid, value #>> '{}' AS name FROM jsonb_each(_current)),
    by_id AS (
      SELECT DISTINCT d.campaign AS old_name, c.name AS new_name, c.cid, 'campaign_id' AS method
      FROM daily_metrics d JOIN cur c ON c.cid = d.campaign_id
      WHERE d.property_id = _property_id AND d.ad_source = 'Google PPC' AND d.campaign <> c.name
    ),
    legacy AS (
      SELECT o.campaign AS old_name, c.name AS new_name, c.cid, 'identical_cost' AS method
      FROM daily_metrics o
      JOIN daily_metrics n ON n.property_id = o.property_id AND n.ad_source = o.ad_source AND n.date = o.date
      JOIN cur c ON c.name = n.campaign
      WHERE o.property_id = _property_id AND o.ad_source = 'Google PPC' AND o.campaign_id IS NULL
        AND o.campaign NOT IN (SELECT name FROM cur) AND coalesce(o.campaign,'') <> ''
        AND o.cost > 0 AND round(o.cost::numeric,2) = round(n.cost::numeric,2)
      GROUP BY 1,2,3 HAVING count(*) >= 3
    )
    SELECT * FROM by_id
    UNION SELECT * FROM legacy l
    WHERE NOT EXISTS (
      SELECT 1 FROM daily_metrics o JOIN daily_metrics n ON n.property_id=o.property_id AND n.ad_source=o.ad_source AND n.date=o.date
      WHERE o.property_id=_property_id AND o.ad_source='Google PPC' AND o.campaign=l.old_name AND n.campaign=l.new_name
        AND round(n.cost::numeric,2) < round(o.cost::numeric,2) - 0.01)
      AND (SELECT count(DISTINCT new_name) FROM legacy x WHERE x.old_name = l.old_name) = 1
  LOOP
    SELECT count(*), coalesce(sum(o.cost),0) INTO m, mc FROM daily_metrics o
      WHERE o.property_id=_property_id AND o.ad_source='Google PPC' AND o.campaign=pair.old_name
        AND EXISTS (SELECT 1 FROM daily_metrics n WHERE n.property_id=o.property_id AND n.ad_source=o.ad_source AND n.date=o.date AND n.campaign=pair.new_name);
    SELECT count(*) - m INTO r FROM daily_metrics o WHERE o.property_id=_property_id AND o.ad_source='Google PPC' AND o.campaign=pair.old_name;

    IF NOT _dry_run THEN
      UPDATE daily_metrics n SET
        record_count = coalesce(n.record_count,0) + coalesce(o.record_count,0),
        leads = coalesce(n.leads,0) + coalesce(o.leads,0),
        good_leads = coalesce(n.good_leads,0) + coalesce(o.good_leads,0),
        bad_leads = coalesce(n.bad_leads,0) + coalesce(o.bad_leads,0),
        medicaid = coalesce(n.medicaid,0) + coalesce(o.medicaid,0),
        projected_sale = coalesce(n.projected_sale,0) + coalesce(o.projected_sale,0),
        verified_sale = coalesce(n.verified_sale,0) + coalesce(o.verified_sale,0),
        no_entry = coalesce(n.no_entry,0) + coalesce(o.no_entry,0),
        spam = coalesce(n.spam,0) + coalesce(o.spam,0),
        sessions = coalesce(n.sessions,0) + coalesce(o.sessions,0),
        users = coalesce(n.users,0) + coalesce(o.users,0)
      FROM daily_metrics o
      WHERE o.property_id=_property_id AND o.ad_source='Google PPC' AND o.campaign=pair.old_name
        AND n.property_id=o.property_id AND n.ad_source=o.ad_source AND n.date=o.date AND n.campaign=pair.new_name;
      DELETE FROM daily_metrics o
      WHERE o.property_id=_property_id AND o.ad_source='Google PPC' AND o.campaign=pair.old_name
        AND EXISTS (SELECT 1 FROM daily_metrics n WHERE n.property_id=o.property_id AND n.ad_source=o.ad_source AND n.date=o.date AND n.campaign=pair.new_name);
      UPDATE daily_metrics SET campaign = pair.new_name, campaign_id = pair.cid
      WHERE property_id=_property_id AND ad_source='Google PPC' AND campaign=pair.old_name;
      INSERT INTO campaign_rename_log (property_id, campaign_id, old_name, new_name, merged_rows, renamed_rows, merged_cost, method)
      VALUES (_property_id, pair.cid, pair.old_name, pair.new_name, m, r, mc, pair.method);
    END IF;
    out := out || jsonb_build_object('old', pair.old_name, 'new', pair.new_name, 'method', pair.method, 'duplicate_rows', m, 'duplicate_cost', mc, 'renamed_rows', r);
  END LOOP;
  RETURN out;
END $$;
REVOKE ALL ON FUNCTION public.reconcile_campaign_renames(uuid, jsonb, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_campaign_renames(uuid, jsonb, boolean) TO service_role;