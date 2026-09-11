import { jsPDF } from "jspdf";
import { flattenAnswers, type Answers } from "./schema";

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

const csvCell = (s: string) => `"${s.replace(/"/g, '""')}"`;

export function downloadJson(label: string, payload: unknown) {
  download(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }), `${label}-onboarding.json`);
}

export function downloadCsv(label: string, answers: Answers) {
  const rows = flattenAnswers(answers);
  const csv = ["Section,Question,Answer", ...rows.map((r) => [r.section, r.label, r.value].map(csvCell).join(","))].join("\n");
  download(new Blob([csv], { type: "text/csv;charset=utf-8" }), `${label}-onboarding.csv`);
}

export function downloadPdf(label: string, answers: Answers, meta: { submittedAt?: string | null }) {
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const margin = 48;
  const width = doc.internal.pageSize.getWidth() - margin * 2;
  const bottom = doc.internal.pageSize.getHeight() - margin;
  let y = margin;

  const nextPage = (needed: number) => {
    if (y + needed > bottom) {
      doc.addPage();
      y = margin;
    }
  };

  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text("Location onboarding", margin, y);
  y += 22;
  doc.setFontSize(12);
  doc.text(label, margin, y);
  y += 16;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text(
    meta.submittedAt ? `Submitted ${new Date(meta.submittedAt).toLocaleString()}` : "Draft — not yet submitted",
    margin,
    y,
  );
  y += 20;

  let currentSection = "";
  for (const row of flattenAnswers(answers)) {
    if (row.section !== currentSection) {
      currentSection = row.section;
      nextPage(40);
      y += 10;
      doc.setFont("helvetica", "bold");
      doc.setFontSize(13);
      doc.text(currentSection, margin, y);
      y += 6;
      doc.setDrawColor(200);
      doc.line(margin, y, margin + width, y);
      y += 14;
    }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9.5);
    const qLines = doc.splitTextToSize(row.label, width) as string[];
    nextPage(qLines.length * 12 + 24);
    doc.text(qLines, margin, y);
    y += qLines.length * 12;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    const aLines = doc.splitTextToSize(row.value || "—", width) as string[];
    for (const line of aLines) {
      nextPage(14);
      doc.text(line, margin, y);
      y += 13;
    }
    y += 8;
  }

  doc.save(`${label}-onboarding.pdf`);
}
