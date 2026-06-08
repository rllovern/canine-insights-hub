import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";

/**
 * Capture a DOM node and download it as a multi-page Letter-size PDF.
 */
export async function exportNodeToPdf(node: HTMLElement, filename: string) {
  const bg =
    getComputedStyle(document.body).backgroundColor ||
    getComputedStyle(node).backgroundColor ||
    "#ffffff";

  const canvas = await html2canvas(node, {
    scale: 2,
    backgroundColor: bg,
    useCORS: true,
    logging: false,
    windowWidth: node.scrollWidth,
    windowHeight: node.scrollHeight,
  });

  const pdf = new jsPDF({ unit: "pt", format: "letter", orientation: "portrait" });
  const pageWidthPt = pdf.internal.pageSize.getWidth();
  const pageHeightPt = pdf.internal.pageSize.getHeight();

  // Map canvas pixel space to PDF point space using width as the anchor.
  const pxPerPt = canvas.width / pageWidthPt;
  const pageHeightPx = Math.floor(pageHeightPt * pxPerPt);

  let renderedPx = 0;
  let pageIndex = 0;

  while (renderedPx < canvas.height) {
    const sliceHeightPx = Math.min(pageHeightPx, canvas.height - renderedPx);

    const pageCanvas = document.createElement("canvas");
    pageCanvas.width = canvas.width;
    pageCanvas.height = sliceHeightPx;
    const ctx = pageCanvas.getContext("2d");
    if (!ctx) throw new Error("Failed to get 2D context");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, pageCanvas.width, pageCanvas.height);
    ctx.drawImage(
      canvas,
      0,
      renderedPx,
      canvas.width,
      sliceHeightPx,
      0,
      0,
      canvas.width,
      sliceHeightPx,
    );

    const imgData = pageCanvas.toDataURL("image/jpeg", 0.92);
    const sliceHeightPt = sliceHeightPx / pxPerPt;
    if (pageIndex > 0) pdf.addPage();
    pdf.addImage(imgData, "JPEG", 0, 0, pageWidthPt, sliceHeightPt);

    renderedPx += sliceHeightPx;
    pageIndex += 1;
  }

  pdf.save(filename);
}