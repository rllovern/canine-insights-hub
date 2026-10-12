ALTER TABLE public.daily_metrics ADD COLUMN IF NOT EXISTS campaign_id text;
ALTER TABLE public.campaign_labels ADD COLUMN IF NOT EXISTS campaign_id text;
ALTER TABLE public.campaign_budgets ADD COLUMN IF NOT EXISTS campaign_id text;
CREATE INDEX IF NOT EXISTS daily_metrics_campaign_id_idx ON public.daily_metrics (property_id, campaign_id) WHERE campaign_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.campaign_rename_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL,
  campaign_id text,
  old_name text NOT NULL,
  new_name text NOT NULL,
  merged_rows int NOT NULL DEFAULT 0,
  renamed_rows int NOT NULL DEFAULT 0,
  merged_cost numeric NOT NULL DEFAULT 0,
  method text NOT NULL,
  at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.campaign_rename_log TO authenticated;
GRANT ALL ON public.campaign_rename_log TO service_role;
ALTER TABLE public.campaign_rename_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Super admins read rename log" ON public.campaign_rename_log FOR SELECT TO authenticated USING (public.is_super_admin(auth.uid()));

-- Merge Google PPC history recorded under old campaign names into the campaign's current name.
-- _current: jsonb object { "<campaign_id>": "<current name>" } from the live Google Ads listing.
CREATE OR REPLACE FUNCTION public.reconcile_campaign_renames(_property_id uuid, _current jsonb, _dry_run boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  pair record; cid text; cur_name text; m int; r int; mc numeric; out jsonb := '[]'::jsonb;
BEGIN
  -- 1. Tag rows whose name is a current name with that campaign's id.
  FOR cid, cur_name IN SELECT key, value #>> '{}' FROM jsonb_each(_current) LOOP
    IF NOT _dry_run THEN
      UPDATE daily_metrics SET campaign_id = cid
      WHERE property_id = _property_id AND ad_source = 'Google PPC' AND campaign = cur_name AND campaign_id IS DISTINCT FROM cid;
    END IF;
  END LOOP;

  -- 2. Identify old names: by stored id, or (legacy, no id) by identical non-zero daily cost on the same date
  --    as an id-tagged current-name row, for at least 3 days and with no conflicting day.
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
    WHERE NOT EXISTS (  -- reject if any overlapping day disagrees on cost
      SELECT 1 FROM daily_metrics o JOIN daily_metrics n ON n.property_id=o.property_id AND n.ad_source=o.ad_source AND n.date=o.date
      WHERE o.property_id=_property_id AND o.ad_source='Google PPC' AND o.campaign=l.old_name AND n.campaign=l.new_name
        AND round(o.cost::numeric,2) <> round(n.cost::numeric,2))
      AND (SELECT count(DISTINCT new_name) FROM legacy x WHERE x.old_name = l.old_name) = 1
  LOOP
    SELECT count(*), coalesce(sum(o.cost),0) INTO m, mc FROM daily_metrics o
      WHERE o.property_id=_property_id AND o.ad_source='Google PPC' AND o.campaign=pair.old_name
        AND EXISTS (SELECT 1 FROM daily_metrics n WHERE n.property_id=o.property_id AND n.ad_source=o.ad_source AND n.date=o.date AND n.campaign=pair.new_name);
    SELECT count(*) - m INTO r FROM daily_metrics o WHERE o.property_id=_property_id AND o.ad_source='Google PPC' AND o.campaign=pair.old_name;

    IF NOT _dry_run THEN
      -- Overlapping days: spend is the same campaign's spend (already on the new row). Carry lead/CTM/GA4 columns over.
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
      -- Earlier history: same campaign, so carry it under the current name.
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