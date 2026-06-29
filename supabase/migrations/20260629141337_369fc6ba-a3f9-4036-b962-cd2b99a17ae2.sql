CREATE POLICY "viewer read campaign_budgets" ON public.campaign_budgets
FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'viewer'::app_role) AND public.viewer_can_access(auth.uid(), property_id));

CREATE POLICY "viewer read campaign_labels" ON public.campaign_labels
FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'viewer'::app_role) AND public.viewer_can_access(auth.uid(), property_id));

CREATE OR REPLACE FUNCTION public.lead_perf_can_read(_user_id uuid, _property_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_role(_user_id, 'internal'::app_role)
      OR (public.has_role(_user_id, 'viewer'::app_role)
          AND public.viewer_can_access(_user_id, _property_id))
$$;