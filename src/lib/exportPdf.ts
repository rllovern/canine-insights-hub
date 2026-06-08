import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";

/**
 * Find vertical pixel positions inside `node` that are safe to break the page on
 * (i.e. don't slice through a KPI card, chart, table row, etc.). Returned in
 * CSS-pixel coordinates relative to the top of `node`.
 */
function collectAtomicBlocks(node: HTMLElement): Array<{ top: number; bottom: number }> {
  const selectors = [
    ".bg-card", // KpiCard, ChartCard, table containers
    "header",
    "tr",
    "[data-pdf-keep]",
  ];
  const els = node.querySelectorAll<HTMLElement>(selectors.join(","));
  const nodeRect = node.getBoundingClientRect();
  const blocks: Array<{ top: number; bottom: number }> = [];
  els.forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.height <= 0) return;
    blocks.push({ top: r.top - nodeRect.top, bottom: r.bottom - nodeRect.top });
  });
  return blocks;
}

/**
 * Capture a DOM node and download it as a multi-page Letter-size PDF, choosing
 * page breaks so that cards / charts / rows are never cut in half.
 */
export async function exportNodeToPdf(node: HTMLElement, filename: string) {
  const bg =
    getComputedStyle(document.body).backgroundColor ||
    getComputedStyle(node).backgroundColor ||
    "#ffffff";

  // Measure safe-break blocks from the live DOM *before* rendering the canvas.
  const blocksCss = collectAtomicBlocks(node);

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

  // Convert block coordinates from CSS px (live DOM) to canvas px.
  const cssToCanvas = canvas.width / node.offsetWidth;
  const blocks = blocksCss
    .map((b) => ({ top: b.top * cssToCanvas, bottom: b.bottom * cssToCanvas }))
    .sort((a, b) => a.top - b.top);

  const isSafeBreak = (y: number) => {
    for (const b of blocks) {
      if (b.top >= y) break;
      if (y > b.top && y < b.bottom) return false;
    }
    return true;
  };

  let renderedPx = 0;
  let pageIndex = 0;

  while (renderedPx < canvas.height) {
    const remaining = canvas.height - renderedPx;
    let sliceHeightPx: number;

    if (remaining <= pageHeightPx) {
      sliceHeightPx = remaining;
    } else {
      const windowEnd = renderedPx + pageHeightPx;
      // Find the largest Y in (renderedPx, windowEnd] that doesn't bisect a block.
      let breakY = -1;
      // Prefer the top of the first block that starts beyond the window — gives
      // a clean break right above an unbroken element.
      for (const b of blocks) {
        if (b.top > renderedPx && b.top <= windowEnd && isSafeBreak(b.top)) {
          breakY = b.top;
        }
        if (b.top > windowEnd) break;
      }
      if (breakY <= renderedPx) {
        // Fall back: hard cut at the window edge (only if a single block is
        // taller than a full page).
        breakY = windowEnd;
      }
      sliceHeightPx = Math.max(1, Math.floor(breakY - renderedPx));
    }

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