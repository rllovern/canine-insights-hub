
-- properties: add google_sheet_tab mapping
ALTER TABLE public.properties ADD COLUMN IF NOT EXISTS google_sheet_tab TEXT;

-- sheet_sync_config: singleton row for spreadsheet ID + status
CREATE TABLE public.sheet_sync_config (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  spreadsheet_id TEXT,
  last_sync_at TIMESTAMPTZ,
  last_sync_status TEXT,
  last_sync_error TEXT,
  singleton BOOLEAN NOT NULL DEFAULT true UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sheet_sync_config TO authenticated;
GRANT ALL ON public.sheet_sync_config TO service_role;
ALTER TABLE public.sheet_sync_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "super_admin_manage_sheet_config" ON public.sheet_sync_config
  FOR ALL TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));
CREATE TRIGGER sheet_sync_config_updated_at BEFORE UPDATE ON public.sheet_sync_config
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
INSERT INTO public.sheet_sync_config (spreadsheet_id) VALUES (NULL);

-- sheet_sales: imported rows
CREATE TABLE public.sheet_sales (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  property_id UUID NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  sale_date DATE NOT NULL,
  full_name TEXT,
  email TEXT,
  phone TEXT,
  city_state TEXT,
  first_session DATE,
  deal_value NUMERIC,
  creation_date DATE,
  sold_date DATE,
  notes TEXT,
  source_row_hash TEXT NOT NULL,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (property_id, source_row_hash)
);
CREATE INDEX sheet_sales_property_date_idx ON public.sheet_sales(property_id, sale_date);

GRANT SELECT ON public.sheet_sales TO authenticated;
GRANT ALL ON public.sheet_sales TO service_role;
ALTER TABLE public.sheet_sales ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sheet_sales_read_accessible_properties" ON public.sheet_sales
  FOR SELECT TO authenticated
  USING (public.can_access_property(auth.uid(), property_id));
CREATE TRIGGER sheet_sales_updated_at BEFORE UPDATE ON public.sheet_sales
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Public report token access
CREATE OR REPLACE FUNCTION public.get_sheet_sales_by_report_token(_token text, _from date, _to date)
RETURNS SETOF public.sheet_sales
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT s.* FROM public.sheet_sales s
  JOIN public.properties p ON p.id = s.property_id
  WHERE p.public_report_token = _token AND p.is_active = true
    AND s.sale_date >= _from AND s.sale_date <= _to
$$;
