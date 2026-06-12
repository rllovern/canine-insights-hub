
CREATE TABLE public.campaign_labels (
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  campaign text NOT NULL,
  label_name text NOT NULL,
  synced_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (property_id, campaign, label_name)
);
GRANT SELECT ON public.campaign_labels TO authenticated;
GRANT ALL ON public.campaign_labels TO service_role;
ALTER TABLE public.campaign_labels ENABLE ROW LEVEL SECURITY;
CREATE POLICY "internal read campaign_labels" ON public.campaign_labels FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'internal'));
CREATE INDEX campaign_labels_property_idx ON public.campaign_labels(property_id);
