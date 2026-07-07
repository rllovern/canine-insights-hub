DROP POLICY IF EXISTS "staff read budget_accounts" ON public.budget_accounts;
DROP POLICY IF EXISTS "read budget_accounts" ON public.budget_accounts;

CREATE POLICY "read budget_accounts"
ON public.budget_accounts
FOR SELECT
TO authenticated
USING (public.can_access_property(auth.uid(), property_id));

DROP POLICY IF EXISTS "super admin write budget_accounts" ON public.budget_accounts;
CREATE POLICY "super admin write budget_accounts"
ON public.budget_accounts
FOR ALL
TO authenticated
USING (public.is_super_admin(auth.uid()))
WITH CHECK (public.is_super_admin(auth.uid()));