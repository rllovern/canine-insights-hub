
ALTER TABLE public.property_call_score_mappings
  DROP CONSTRAINT IF EXISTS property_call_score_mappings_bucket_check;

ALTER TABLE public.property_call_score_mappings
  ADD CONSTRAINT property_call_score_mappings_bucket_check
  CHECK (bucket = ANY (ARRAY['admission','good','bad','spam','repeat','no_entry','ignore']::text[]));
