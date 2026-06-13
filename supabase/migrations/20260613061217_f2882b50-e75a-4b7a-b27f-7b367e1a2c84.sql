
-- Jarvis: agent foundation tables

CREATE TABLE public.ai_agent_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  property_id uuid REFERENCES public.properties(id) ON DELETE SET NULL,
  title text,
  page_context text,
  date_range_start date,
  date_range_end date,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_agent_sessions TO authenticated;
GRANT ALL ON public.ai_agent_sessions TO service_role;
ALTER TABLE public.ai_agent_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner read sessions" ON public.ai_agent_sessions FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(),'internal'::app_role));
CREATE POLICY "owner insert sessions" ON public.ai_agent_sessions FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());
CREATE POLICY "owner update sessions" ON public.ai_agent_sessions FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "owner delete sessions" ON public.ai_agent_sessions FOR DELETE TO authenticated
  USING (user_id = auth.uid());
CREATE INDEX ai_agent_sessions_user_idx ON public.ai_agent_sessions (user_id, updated_at DESC);

CREATE TABLE public.ai_agent_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.ai_agent_sessions(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user','assistant','tool','system')),
  content text,
  parts_json jsonb,
  tool_calls_json jsonb,
  evidence_json jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_agent_messages TO authenticated;
GRANT ALL ON public.ai_agent_messages TO service_role;
ALTER TABLE public.ai_agent_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "session owner read messages" ON public.ai_agent_messages FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.ai_agent_sessions s WHERE s.id = session_id
    AND (s.user_id = auth.uid() OR public.has_role(auth.uid(),'internal'::app_role))));
CREATE POLICY "session owner insert messages" ON public.ai_agent_messages FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.ai_agent_sessions s WHERE s.id = session_id AND s.user_id = auth.uid()));
CREATE INDEX ai_agent_messages_session_idx ON public.ai_agent_messages (session_id, created_at);

CREATE TABLE public.ai_agent_tool_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid REFERENCES public.ai_agent_sessions(id) ON DELETE CASCADE,
  tool_name text NOT NULL,
  input_json jsonb,
  output_json jsonb,
  status text NOT NULL DEFAULT 'success',
  duration_ms integer,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.ai_agent_tool_runs TO authenticated;
GRANT ALL ON public.ai_agent_tool_runs TO service_role;
ALTER TABLE public.ai_agent_tool_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "session owner read tool runs" ON public.ai_agent_tool_runs FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.ai_agent_sessions s WHERE s.id = session_id
    AND (s.user_id = auth.uid() OR public.has_role(auth.uid(),'internal'::app_role))));
CREATE INDEX ai_agent_tool_runs_session_idx ON public.ai_agent_tool_runs (session_id, created_at);

CREATE TABLE public.ai_agent_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id uuid REFERENCES public.ai_agent_sessions(id) ON DELETE SET NULL,
  property_id uuid REFERENCES public.properties(id) ON DELETE CASCADE,
  report_type text NOT NULL,
  title text NOT NULL,
  date_range_start date,
  date_range_end date,
  schema_json jsonb NOT NULL,
  evidence_json jsonb,
  saved boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_agent_reports TO authenticated;
GRANT ALL ON public.ai_agent_reports TO service_role;
ALTER TABLE public.ai_agent_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner read reports" ON public.ai_agent_reports FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(),'internal'::app_role));
CREATE POLICY "owner insert reports" ON public.ai_agent_reports FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());
CREATE POLICY "owner update reports" ON public.ai_agent_reports FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "owner delete reports" ON public.ai_agent_reports FOR DELETE TO authenticated
  USING (user_id = auth.uid());
CREATE INDEX ai_agent_reports_user_idx ON public.ai_agent_reports (user_id, created_at DESC);
CREATE INDEX ai_agent_reports_property_idx ON public.ai_agent_reports (property_id, created_at DESC);

CREATE TRIGGER ai_agent_sessions_set_updated_at
  BEFORE UPDATE ON public.ai_agent_sessions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Permission helper: can the current user access this property?
CREATE OR REPLACE FUNCTION public.user_can_access_property(_user_id uuid, _property_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT public.has_role(_user_id, 'internal'::app_role)
      OR public.viewer_can_access(_user_id, _property_id)
$$;
