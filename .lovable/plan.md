## Goal

Add a "Download PDF" button at the top of the admin-side client report view (`/admin/client-reports/:propertyId`) that, when clicked, generates and downloads a PDF of the currently rendered report (header + dashboard + call tracking) for the active date range.

## Where the button goes

The admin view already renders a floating top-left toolbar (hamburger + back). We'll add a third floating button on the top-right of the screen labeled "Download PDF" (icon + text), visible only on the admin route — not on the public `/report/:token` view. The button stays out of the captured area so it doesn't appear in the PDF.

## How the PDF is generated

Client-side capture, no backend changes:

1. Install `html2canvas` and `jspdf`.
2. Wrap the report content (`PublicShell` subtree inside `TokenReport`) in a ref-targeted container so we can capture it.
3. On click:
   - Show a small "Generating…" toast / spinner state on the button (disabled during capture).
   - Temporarily ensure the container is fully expanded (the report is already a normal scroll page — html2canvas captures the full element height regardless of viewport).
   - `html2canvas(node, { scale: 2, backgroundColor: <bg from theme>, useCORS: true })`.
   - Slice the resulting canvas into letter-size pages and add each as an image to a `jsPDF` (portrait, letter, with small margins).
   - Save as `{property.name} - Performance Report - {fromDate}_{toDate}.pdf`.

## Implementation steps

1. **Dependencies**: `bun add html2canvas jspdf`.
2. **New util** `src/lib/exportPdf.ts` — `exportNodeToPdf(node: HTMLElement, filename: string)` containing the html2canvas + jsPDF logic and page slicing.
3. **TokenReport**: accept an optional `captureRef?: React.RefObject<HTMLDivElement>` prop and attach it to a wrapper `<div ref={captureRef}>` around the `PublicShell`. Default behavior unchanged for the public route.
4. **AdminClientReports**:
   - Create a `captureRef` and pass it to `TokenReport`.
   - Add a floating top-right "Download PDF" button (same styling family as the existing floating controls) with `Download` lucide icon.
   - On click: read the active date range from the dashboard context — to keep this simple, the filename will use today's date plus the property name; the PDF content always reflects whatever range is currently selected because we capture the live DOM.
   - Disable the button while generating; show a sonner toast on success/failure.

## Technical notes

- The report uses dark theme tokens — pass `backgroundColor: getComputedStyle(document.body).backgroundColor` to html2canvas to avoid transparent gaps.
- Charts are rendered with Recharts (SVG) — html2canvas handles SVG; we'll set `scale: 2` for sharper output.
- Page slicing: compute `pageHeightPx = (canvas.width * 11) / 8.5`, then loop adding cropped slices to jsPDF pages.
- Button is rendered outside the captured node, so it won't appear in the PDF.
- No changes to the public `/report/:token` page.

## Files touched

- `package.json` (deps)
- `src/lib/exportPdf.ts` (new)
- `src/components/reports/TokenReport.tsx` (forward capture ref)
- `src/pages/admin/AdminClientReports.tsx` (button + ref + handler)
