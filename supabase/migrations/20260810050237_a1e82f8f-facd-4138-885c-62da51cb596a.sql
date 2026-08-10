CREATE UNIQUE INDEX properties_google_sheet_tab_unique
  ON public.properties (google_sheet_tab)
  WHERE google_sheet_tab IS NOT NULL;