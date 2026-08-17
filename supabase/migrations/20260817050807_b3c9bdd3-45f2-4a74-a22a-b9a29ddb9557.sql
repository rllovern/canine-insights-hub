ALTER TABLE public.ai_agent_messages
  ADD COLUMN IF NOT EXISTS tool_backed boolean,
  ADD COLUMN IF NOT EXISTS tool_run_count integer NOT NULL DEFAULT 0;