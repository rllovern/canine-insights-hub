ALTER TABLE public.property_call_score_mappings
  DROP CONSTRAINT IF EXISTS property_call_score_mappings_bucket_check;

UPDATE public.property_call_score_mappings
SET bucket = 'projected_sale'
WHERE bucket = 'admission';

UPDATE public.ctm_calls
SET call_score_bucket = 'projected_sale'
WHERE call_score_bucket = 'admission';

ALTER TABLE public.property_call_score_mappings
  ADD CONSTRAINT property_call_score_mappings_bucket_check
  CHECK (bucket = ANY (ARRAY['projected_sale','good','bad','spam','repeat','no_entry','ignore']::text[]));