CREATE TABLE public.user_security (
  user_id UUID NOT NULL PRIMARY KEY,
  must_change_password BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

GRANT SELECT ON public.user_security TO authenticated;
GRANT ALL ON public.user_security TO service_role;

ALTER TABLE public.user_security ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read their own security row"
ON public.user_security FOR SELECT TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Super admins can read all security rows"
ON public.user_security FOR SELECT TO authenticated
USING (public.is_super_admin(auth.uid()));

CREATE TRIGGER user_security_set_updated_at
BEFORE UPDATE ON public.user_security
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();