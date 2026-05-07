import html2canvas from "html2canvas";
import jsPDF from "jspdf";
import type { MetricRow } from "./data-sources";
import { toast } from "@/hooks/use-toast";

export function exportCurrentViewCSV(rows: MetricRow[], slug?: string) {
  if (!rows.length) { toast({ title: "Nothing to export" }); return; }
  const cols = Object.keys(rows[0]) as (keyof MetricRow)[];
  const header = cols.join(",");
  const body = rows.map((r) => cols.map((c) => JSON.stringify(r[c] ?? "")).join(",")).join("\n");
  const blob = new Blob([header + "\n" + body], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${slug ?? "fullcircle"}-export-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  toast({ title: "CSV downloaded" });
}

export async function exportCurrentViewPDF(slug?: string) {
  const node = document.getElementById("dashboard-canvas");
  if (!node) return;
  toast({ title: "Generating PDF…" });
  const canvas = await html2canvas(node, { scale: 2, backgroundColor: "#ffffff", useCORS: true });
  const img = canvas.toDataURL("image/png");
  const pdf = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
  const pageW = pdf.internal.pageSize.getWidth();
  const ratio = canvas.height / canvas.width;
  const imgW = pageW - 40;
  const imgH = imgW * ratio;
  let y = 20;
  let remaining = imgH;
  let position = y;
  // single-image flow with page splitting
  pdf.addImage(img, "PNG", 20, position, imgW, imgH);
  while (remaining > pdf.internal.pageSize.getHeight() - 40) {
    remaining -= pdf.internal.pageSize.getHeight() - 40;
    position -= pdf.internal.pageSize.getHeight() - 40;
    pdf.addPage();
    pdf.addImage(img, "PNG", 20, position, imgW, imgH);
  }
  pdf.save(`${slug ?? "fullcircle"}-report-${new Date().toISOString().slice(0, 10)}.pdf`);
  toast({ title: "PDF downloaded" });
}
