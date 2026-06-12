
CREATE TABLE public.budget_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  campaign_label text,
  notes text,
  monthly_budget numeric NOT NULL DEFAULT 0,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.budget_accounts TO authenticated;
GRANT ALL ON public.budget_accounts TO service_role;
ALTER TABLE public.budget_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "internal read budget_accounts"  ON public.budget_accounts FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'internal'));
CREATE POLICY "internal write budget_accounts" ON public.budget_accounts FOR ALL    TO authenticated USING (public.has_role(auth.uid(),'internal')) WITH CHECK (public.has_role(auth.uid(),'internal'));
CREATE TRIGGER budget_accounts_updated BEFORE UPDATE ON public.budget_accounts FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE INDEX budget_accounts_property_idx ON public.budget_accounts(property_id);

CREATE TABLE public.campaign_budgets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  campaign text NOT NULL,
  daily_budget numeric NOT NULL DEFAULT 0,
  status text,
  synced_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (property_id, campaign)
);
GRANT SELECT ON public.campaign_budgets TO authenticated;
GRANT ALL ON public.campaign_budgets TO service_role;
ALTER TABLE public.campaign_budgets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "internal read campaign_budgets" ON public.campaign_budgets FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'internal'));
CREATE INDEX campaign_budgets_property_idx ON public.campaign_budgets(property_id);
