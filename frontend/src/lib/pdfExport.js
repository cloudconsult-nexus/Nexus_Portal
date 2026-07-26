import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

// Shared export used by OnCall Reports, Nexus Reports, and Audit Logs —
// consistent look (Ink navy header band) regardless of which page calls it.
export function exportTableToPdf({ title, subtitle, columns, rows, filename }) {
  const doc = new jsPDF({ orientation: rows.length && columns.length > 6 ? 'landscape' : 'portrait' });

  doc.setFontSize(14);
  doc.text(title, 14, 16);
  if (subtitle) {
    doc.setFontSize(10);
    doc.setTextColor(107, 114, 128); // muted
    doc.text(subtitle, 14, 22);
    doc.setTextColor(0, 0, 0);
  }

  autoTable(doc, {
    startY: subtitle ? 27 : 22,
    head: [columns],
    body: rows,
    styles: { fontSize: 8, cellPadding: 3 },
    headStyles: { fillColor: [27, 35, 51], textColor: [255, 255, 255] }, // #1B2333
    alternateRowStyles: { fillColor: [247, 248, 250] }, // surface
  });

  doc.save(filename.endsWith('.pdf') ? filename : `${filename}.pdf`);
}
