-- Backfill: for any Location Owner user with >1 viewer_property_access rows, keep the earliest and delete the rest.
DELETE FROM public.viewer_property_access vpa
USING (
  SELECT vpa2.ctid
  FROM public.viewer_property_access vpa2
  JOIN public.user_roles ur ON ur.user_id = vpa2.user_id AND ur.role = 'location_owner'
  WHERE vpa2.ctid NOT IN (
    SELECT DISTINCT ON (v.user_id) v.ctid
    FROM public.viewer_property_access v
    JOIN public.user_roles ur2 ON ur2.user_id = v.user_id AND ur2.role = 'location_owner'
    ORDER BY v.user_id, v.created_at ASC NULLS LAST
  )
) dupes
WHERE vpa.ctid = dupes.ctid;

-- Enforce at most one viewer_property_access row per location_owner user.
CREATE OR REPLACE FUNCTION public.enforce_single_location_for_location_owner()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = NEW.user_id AND role = 'location_owner'
  ) THEN
    IF EXISTS (
      SELECT 1 FROM public.viewer_property_access
      WHERE user_id = NEW.user_id
        AND (TG_OP = 'INSERT' OR property_id <> NEW.property_id)
    ) THEN
      RAISE EXCEPTION 'Location Owner users can only be assigned to one property. Remove the existing assignment first.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_single_location_for_location_owner ON public.viewer_property_access;
CREATE TRIGGER trg_enforce_single_location_for_location_owner
BEFORE INSERT OR UPDATE ON public.viewer_property_access
FOR EACH ROW EXECUTE FUNCTION public.enforce_single_location_for_location_owner();