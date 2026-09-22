CREATE TABLE public.budget_change_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  effective_date date NOT NULL,
  monthly_budget numeric NOT NULL,
  previous_budget numeric,
  note text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX budget_change_log_property_date_idx ON public.budget_change_log (property_id, effective_date);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.budget_change_log TO authenticated;
GRANT ALL ON public.budget_change_log TO service_role;

ALTER TABLE public.budget_change_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "read budget_change_log" ON public.budget_change_log
  FOR SELECT TO authenticated
  USING (can_access_property(auth.uid(), property_id));

CREATE POLICY "super admin write budget_change_log" ON public.budget_change_log
  FOR ALL TO authenticated
  USING (is_super_admin(auth.uid()))
  WITH CHECK (is_super_admin(auth.uid()));