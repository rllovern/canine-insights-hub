import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";

/** Renders each `.rd-page` inside `root` as one Letter page of a PDF. */
export async function exportReportPages(root: HTMLElement, filename: string) {
  const pages = Array.from(root.querySelectorAll<HTMLElement>(".rd-page"));
  const pdf = new jsPDF({ unit: "pt", format: "letter", orientation: "portrait" });
  const w = pdf.internal.pageSize.getWidth();
  const h = pdf.internal.pageSize.getHeight();
  for (let i = 0; i < pages.length; i++) {
    const canvas = await html2canvas(pages[i], { scale: 2, useCORS: true, logging: false, backgroundColor: null });
    if (i > 0) pdf.addPage();
    pdf.addImage(canvas.toDataURL("image/jpeg", 0.92), "JPEG", 0, 0, w, h);
  }
  pdf.save(filename);
}
