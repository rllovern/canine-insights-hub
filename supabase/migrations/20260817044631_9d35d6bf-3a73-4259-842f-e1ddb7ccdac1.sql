DROP POLICY IF EXISTS "owner read sessions" ON public.ai_agent_sessions;
CREATE POLICY "owner read sessions"
ON public.ai_agent_sessions FOR SELECT
USING ((user_id = auth.uid()) OR public.is_super_admin(auth.uid()));

DROP POLICY IF EXISTS "session owner read messages" ON public.ai_agent_messages;
CREATE POLICY "session owner read messages"
ON public.ai_agent_messages FOR SELECT
USING (EXISTS (
  SELECT 1 FROM public.ai_agent_sessions s
  WHERE s.id = ai_agent_messages.session_id
    AND ((s.user_id = auth.uid()) OR public.is_super_admin(auth.uid()))
));