
CREATE TABLE public.user_nav_preferences (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  order_keys text[] NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_nav_preferences TO authenticated;
GRANT ALL ON public.user_nav_preferences TO service_role;
ALTER TABLE public.user_nav_preferences ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own row select" ON public.user_nav_preferences FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own row write"  ON public.user_nav_preferences FOR ALL    TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER user_nav_prefs_updated BEFORE UPDATE ON public.user_nav_preferences FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
