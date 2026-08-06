CREATE TABLE public.user_tour_state (
  user_id uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  tour_key text NOT NULL DEFAULT 'dashboard-v1',
  completed_at timestamptz,
  dismissed_at timestamptz,
  last_step integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, tour_key)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_tour_state TO authenticated;
GRANT ALL ON public.user_tour_state TO service_role;

ALTER TABLE public.user_tour_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their own tour state"
ON public.user_tour_state FOR ALL TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER user_tour_state_set_updated_at
BEFORE UPDATE ON public.user_tour_state
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();