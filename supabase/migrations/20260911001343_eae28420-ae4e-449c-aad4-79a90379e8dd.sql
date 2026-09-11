CREATE TABLE public.onboarding_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid REFERENCES public.properties(id) ON DELETE SET NULL,
  location_label text NOT NULL,
  contact_name text,
  contact_email text NOT NULL,
  token text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'not_started',
  prefill jsonb NOT NULL DEFAULT '{}'::jsonb,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '90 days'),
  revoked_at timestamptz,
  last_sent_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.onboarding_invites TO authenticated;
GRANT ALL ON public.onboarding_invites TO service_role;
ALTER TABLE public.onboarding_invites ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff manage onboarding invites" ON public.onboarding_invites
  FOR ALL TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

CREATE TABLE public.onboarding_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invite_id uuid NOT NULL UNIQUE REFERENCES public.onboarding_invites(id) ON DELETE CASCADE,
  property_id uuid REFERENCES public.properties(id) ON DELETE SET NULL,
  answers jsonb NOT NULL DEFAULT '{}'::jsonb,
  section_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  current_section integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'in_progress',
  submitted_at timestamptz,
  approved_at timestamptz,
  approved_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.onboarding_submissions TO authenticated;
GRANT ALL ON public.onboarding_submissions TO service_role;
ALTER TABLE public.onboarding_submissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff manage onboarding submissions" ON public.onboarding_submissions
  FOR ALL TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

CREATE TABLE public.onboarding_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id uuid NOT NULL REFERENCES public.onboarding_submissions(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'trainer_photo',
  ref_key text,
  storage_path text NOT NULL,
  file_name text,
  mime_type text,
  size_bytes integer,
  width integer,
  height integer,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.onboarding_files TO authenticated;
GRANT ALL ON public.onboarding_files TO service_role;
ALTER TABLE public.onboarding_files ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff manage onboarding files" ON public.onboarding_files
  FOR ALL TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

CREATE TABLE public.onboarding_flags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id uuid NOT NULL REFERENCES public.onboarding_submissions(id) ON DELETE CASCADE,
  flag_type text NOT NULL,
  severity text NOT NULL DEFAULT 'warning',
  field_key text,
  detail text,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.onboarding_flags TO authenticated;
GRANT ALL ON public.onboarding_flags TO service_role;
ALTER TABLE public.onboarding_flags ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff manage onboarding flags" ON public.onboarding_flags
  FOR ALL TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

CREATE TABLE public.onboarding_field_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id uuid NOT NULL REFERENCES public.onboarding_submissions(id) ON DELETE CASCADE,
  field_key text NOT NULL,
  target_table text NOT NULL,
  target_column text,
  value_json jsonb,
  applied_by uuid,
  applied_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.onboarding_field_applications TO authenticated;
GRANT ALL ON public.onboarding_field_applications TO service_role;
ALTER TABLE public.onboarding_field_applications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff manage onboarding field applications" ON public.onboarding_field_applications
  FOR ALL TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

CREATE INDEX idx_onboarding_invites_property ON public.onboarding_invites(property_id);
CREATE INDEX idx_onboarding_submissions_status ON public.onboarding_submissions(status);
CREATE INDEX idx_onboarding_files_submission ON public.onboarding_files(submission_id);
CREATE INDEX idx_onboarding_flags_submission ON public.onboarding_flags(submission_id);

CREATE TRIGGER onboarding_invites_set_updated_at BEFORE UPDATE ON public.onboarding_invites
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER onboarding_submissions_set_updated_at BEFORE UPDATE ON public.onboarding_submissions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();