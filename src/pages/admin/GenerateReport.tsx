import { useEffect, useRef, useState } from "react";
import { format, parseISO } from "date-fns";
import { Copy, Download, ExternalLink, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MonthlyReportDocument } from "@/components/monthly-report/MonthlyReportDocument";
import { exportReportPages } from "@/components/monthly-report/exportPages";
import { lastFullMonth, recentMonths, useMonthlyReport } from "@/components/monthly-report/useMonthlyReport";

type Prop = { id: string; name: string; public_report_token: string | null };

export default function GenerateReport() {
  const [props, setProps] = useState<Prop[]>([]);
  const [propertyId, setPropertyId] = useState<string>("");
  const [month, setMonth] = useState(lastFullMonth());
  const [downloading, setDownloading] = useState(false);
  const docRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    supabase.from("properties").select("id,name,public_report_token").eq("is_active", true).order("name").then(({ data }) => {
      const list = (data ?? []) as Prop[];
      setProps(list);
      if (list[0]) setPropertyId((p) => p || list[0].id);
    });
  }, []);

  const { data, error, loading } = useMonthlyReport(propertyId ? { propertyId, month } : null);
  const current = props.find((p) => p.id === propertyId);
  const shareUrl = current?.public_report_token ? `${window.location.origin}/report/${current.public_report_token}/monthly?month=${month}` : null;

  const download = async () => {
    if (!docRef.current || !data) return;
    setDownloading(true);
    try {
      await exportReportPages(docRef.current, `${data.property.name} - Google Ads Report - ${month}.pdf`);
    } catch (e) {
      console.error(e); toast.error("Failed to generate PDF");
    } finally { setDownloading(false); }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Generate Report</h1>
          <p className="text-sm text-muted-foreground">Branded monthly Google Ads report, compared with the prior month.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={propertyId} onValueChange={setPropertyId}>
            <SelectTrigger className="w-56"><SelectValue placeholder="Location" /></SelectTrigger>
            <SelectContent>{props.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={month} onValueChange={setMonth}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>{recentMonths().map((m) => <SelectItem key={m} value={m}>{format(parseISO(`${m}-01`), "MMMM yyyy")}</SelectItem>)}</SelectContent>
          </Select>
          <Button variant="outline" disabled={!shareUrl} onClick={() => { navigator.clipboard.writeText(shareUrl!); toast.success("Client link copied"); }}>
            <Copy className="mr-2 h-4 w-4" />Copy client link
          </Button>
          <Button variant="outline" disabled={!shareUrl} asChild={!!shareUrl}>
            {shareUrl ? <a href={shareUrl} target="_blank" rel="noreferrer"><ExternalLink className="mr-2 h-4 w-4" />Preview client view</a> : <span>Preview client view</span>}
          </Button>
          <Button onClick={download} disabled={!data || downloading}>
            {downloading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}Download PDF
          </Button>
        </div>
      </div>
      {current && !current.public_report_token && <p className="text-sm text-muted-foreground">This location has no share token yet, so a client link can't be created.</p>}
      <div className="overflow-x-auto rounded-lg bg-muted/40 p-6">
        {loading && <div className="grid h-64 place-items-center"><Loader2 className="animate-spin text-muted-foreground" /></div>}
        {error && <div className="grid h-64 place-items-center text-sm text-destructive">{error}</div>}
        {data && <MonthlyReportDocument ref={docRef} data={data} />}
      </div>
    </div>
  );
}
