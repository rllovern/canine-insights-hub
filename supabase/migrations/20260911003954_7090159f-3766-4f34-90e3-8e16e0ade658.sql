-- Restrict deletion of onboarding data to Super Admin only.
DROP POLICY IF EXISTS "Staff manage onboarding invites" ON public.onboarding_invites;
DROP POLICY IF EXISTS "Owners manage onboarding invites" ON public.onboarding_invites;
DROP POLICY IF EXISTS "Staff manage onboarding submissions" ON public.onboarding_submissions;
DROP POLICY IF EXISTS "Owners manage onboarding submissions" ON public.onboarding_submissions;
DROP POLICY IF EXISTS "Staff manage onboarding files" ON public.onboarding_files;
DROP POLICY IF EXISTS "Owners manage onboarding files" ON public.onboarding_files;
DROP POLICY IF EXISTS "Staff manage onboarding flags" ON public.onboarding_flags;
DROP POLICY IF EXISTS "Owners manage onboarding flags" ON public.onboarding_flags;
DROP POLICY IF EXISTS "Staff manage onboarding field applications" ON public.onboarding_field_applications;
DROP POLICY IF EXISTS "Owners manage onboarding field applications" ON public.onboarding_field_applications;

CREATE POLICY "Staff and owners read onboarding invites" ON public.onboarding_invites
  FOR SELECT TO authenticated USING (public.is_all_properties_reader(auth.uid()));
CREATE POLICY "Staff and owners create onboarding invites" ON public.onboarding_invites
  FOR INSERT TO authenticated WITH CHECK (public.is_all_properties_reader(auth.uid()));
CREATE POLICY "Staff and owners update onboarding invites" ON public.onboarding_invites
  FOR UPDATE TO authenticated USING (public.is_all_properties_reader(auth.uid())) WITH CHECK (public.is_all_properties_reader(auth.uid()));
CREATE POLICY "Super admins delete onboarding invites" ON public.onboarding_invites
  FOR DELETE TO authenticated USING (public.is_super_admin(auth.uid()));

CREATE POLICY "Staff and owners read onboarding submissions" ON public.onboarding_submissions
  FOR SELECT TO authenticated USING (public.is_all_properties_reader(auth.uid()));
CREATE POLICY "Staff and owners create onboarding submissions" ON public.onboarding_submissions
  FOR INSERT TO authenticated WITH CHECK (public.is_all_properties_reader(auth.uid()));
CREATE POLICY "Staff and owners update onboarding submissions" ON public.onboarding_submissions
  FOR UPDATE TO authenticated USING (public.is_all_properties_reader(auth.uid())) WITH CHECK (public.is_all_properties_reader(auth.uid()));
CREATE POLICY "Super admins delete onboarding submissions" ON public.onboarding_submissions
  FOR DELETE TO authenticated USING (public.is_super_admin(auth.uid()));

CREATE POLICY "Staff and owners read onboarding files" ON public.onboarding_files
  FOR SELECT TO authenticated USING (public.is_all_properties_reader(auth.uid()));
CREATE POLICY "Staff and owners create onboarding files" ON public.onboarding_files
  FOR INSERT TO authenticated WITH CHECK (public.is_all_properties_reader(auth.uid()));
CREATE POLICY "Staff and owners update onboarding files" ON public.onboarding_files
  FOR UPDATE TO authenticated USING (public.is_all_properties_reader(auth.uid())) WITH CHECK (public.is_all_properties_reader(auth.uid()));
CREATE POLICY "Super admins delete onboarding files" ON public.onboarding_files
  FOR DELETE TO authenticated USING (public.is_super_admin(auth.uid()));

CREATE POLICY "Staff and owners read onboarding flags" ON public.onboarding_flags
  FOR SELECT TO authenticated USING (public.is_all_properties_reader(auth.uid()));
CREATE POLICY "Staff and owners create onboarding flags" ON public.onboarding_flags
  FOR INSERT TO authenticated WITH CHECK (public.is_all_properties_reader(auth.uid()));
CREATE POLICY "Staff and owners update onboarding flags" ON public.onboarding_flags
  FOR UPDATE TO authenticated USING (public.is_all_properties_reader(auth.uid())) WITH CHECK (public.is_all_properties_reader(auth.uid()));
CREATE POLICY "Super admins delete onboarding flags" ON public.onboarding_flags
  FOR DELETE TO authenticated USING (public.is_super_admin(auth.uid()));

CREATE POLICY "Staff and owners read onboarding field applications" ON public.onboarding_field_applications
  FOR SELECT TO authenticated USING (public.is_all_properties_reader(auth.uid()));
CREATE POLICY "Staff and owners create onboarding field applications" ON public.onboarding_field_applications
  FOR INSERT TO authenticated WITH CHECK (public.is_all_properties_reader(auth.uid()));
CREATE POLICY "Staff and owners update onboarding field applications" ON public.onboarding_field_applications
  FOR UPDATE TO authenticated USING (public.is_all_properties_reader(auth.uid())) WITH CHECK (public.is_all_properties_reader(auth.uid()));
CREATE POLICY "Super admins delete onboarding field applications" ON public.onboarding_field_applications
  FOR DELETE TO authenticated USING (public.is_super_admin(auth.uid()));