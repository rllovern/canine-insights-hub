import { useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { format, parseISO } from "date-fns";
import { Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import logo from "@/assets/ridgeside-logo-full.webp";
import { MonthlyReportDocument } from "@/components/monthly-report/MonthlyReportDocument";
import { exportReportPages } from "@/components/monthly-report/exportPages";
import { lastFullMonth, useMonthlyReport } from "@/components/monthly-report/useMonthlyReport";

export default function PublicMonthlyReport() {
  const { token } = useParams<{ token: string }>();
  const [sp] = useSearchParams();
  const raw = sp.get("month") ?? "";
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(raw) ? raw : lastFullMonth();
  const { data, error, loading } = useMonthlyReport(token ? { token, month } : null);
  const ref = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);

  const download = async () => {
    if (!ref.current || !data) return;
    setBusy(true);
    try { await exportReportPages(ref.current, `${data.property.name} - Google Ads Report - ${month}.pdf`); }
    finally { setBusy(false); }
  };

  return (
    <div className="min-h-screen bg-muted/40">
      <header className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3">
          <div className="flex items-center gap-3">
            <img src={logo} alt="Ridgeside K9" className="h-8 w-auto" />
            <div className="hidden text-sm sm:block">
              <div className="font-semibold">{data?.property.name ?? "Monthly Report"}</div>
              <div className="text-muted-foreground">{format(parseISO(`${month}-01`), "MMMM yyyy")}</div>
            </div>
          </div>
          <Button onClick={download} disabled={!data || busy}>
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}Download PDF Report
          </Button>
        </div>
      </header>
      <main className="overflow-x-auto px-4 py-8">
        {loading && <div className="grid h-96 place-items-center"><Loader2 className="animate-spin text-muted-foreground" /></div>}
        {error && <div className="grid h-96 place-items-center text-muted-foreground">{error === "Invalid report link" ? "This report link is invalid or has expired." : "This report couldn't be loaded right now. Please try again shortly."}</div>}
        {data && <MonthlyReportDocument ref={ref} data={data} />}
      </main>
    </div>
  );
}
