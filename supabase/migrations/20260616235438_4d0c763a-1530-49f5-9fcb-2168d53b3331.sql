
DROP POLICY IF EXISTS "Viewers read assigned ghl_contacts" ON public.ghl_contacts;
CREATE POLICY "Viewers read assigned ghl_contacts" ON public.ghl_contacts
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'viewer'::app_role) AND viewer_can_access(auth.uid(), property_id));

DROP POLICY IF EXISTS "Viewers read assigned ghl_events_raw" ON public.ghl_events_raw;
CREATE POLICY "Viewers read assigned ghl_events_raw" ON public.ghl_events_raw
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'viewer'::app_role) AND viewer_can_access(auth.uid(), property_id));

DROP POLICY IF EXISTS "viewers read accessible property_targets" ON public.property_targets;
CREATE POLICY "viewers read accessible property_targets" ON public.property_targets
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'viewer'::app_role) AND viewer_can_access(auth.uid(), property_id));

DROP POLICY IF EXISTS "suppression tags readable" ON public.lead_perf_suppression_tags;
CREATE POLICY "suppression tags readable" ON public.lead_perf_suppression_tags
  FOR SELECT TO authenticated
  USING (true);

CREATE OR REPLACE FUNCTION public.normalize_tag(_t text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT NULLIF(
    regexp_replace(
      regexp_replace(lower(coalesce(_t,'')), '[^a-z0-9]+', ' ', 'g'),
      '\s+', ' ', 'g'
    )
  , '')
$function$;
