import type { RepricedTable } from './types';
import { fmt, fmtHrs, periodText, repricingSentence, type ExportMeta } from './exportShared';

/**
 * The study's table on a landscape letter page, laid out the way UC prints it: a title block,
 * the study's own columns, section headings, subtotal and total rows, and footnotes that say how
 * each figure was repriced and where the series come from.
 */
export async function buildPdf(table: RepricedTable, meta: ExportMeta): Promise<Uint8Array> {
  const { jsPDF } = await import('jspdf');
  const { default: autoTable } = await import('jspdf-autotable');
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'letter' });
  const W = doc.internal.pageSize.getWidth();
  const margin = 36;
  const ink: [number, number, number] = [20, 22, 25];
  const grey: [number, number, number] = [91, 100, 112];

  // Title block, centered like the study page.
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...grey);
  doc.text('UC COOPERATIVE EXTENSION', W / 2, margin, { align: 'center' });
  doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(...ink);
  doc.text(table.title.toUpperCase(), W / 2, margin + 14, { align: 'center' });
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
  const sub = [meta.study?.region, meta.study?.year ? String(meta.study.year) : null].filter(Boolean).join(' - ');
  doc.text(sub, W / 2, margin + 27, { align: 'center' });
  doc.setFontSize(8); doc.setTextColor(...grey);
  doc.text(`Repriced to ${periodText(table.targetPeriod)} from prices as of ${periodText(table.referencePeriod)}`, W / 2, margin + 39, { align: 'center' });

  const isProd = table.layout === 'production';
  const timeCol = table.columns.find(c => c.key === 'timeHrs');
  const columns = table.columns.filter(c => c.key !== 'timeHrs');
  const head = isProd
    ? [['Operation', 'Time\n(Hrs/A)', ...columns.map(c => c.label.replace(' & ', ' &\n').replace('/ ', '/\n')), 'Your\nCost']]
    : [['Operation', ...columns.map(c => c.label), 'Your\nCost']];
  const body: (string | { content: string; styles?: Record<string, unknown> })[][] = [];
  const rowMeta: { kind: string }[] = [];
  for (const r of table.rows) {
    rowMeta.push({ kind: r.kind });
    if (r.kind === 'heading') { body.push([{ content: r.label, styles: { fontStyle: 'bold' } }, ...Array(head[0].length - 1).fill('')]); continue; }
    if (r.kind === 'blank') { body.push(Array(head[0].length).fill('')); continue; }
    const caps = r.kind === 'subtotal' || r.kind === 'total' || r.kind === 'net' || r.kind === 'returns';
    const label = caps ? r.label.toUpperCase() : `    ${r.label}`;
    const cells = columns.map(c => fmt(r.cells[c.key]?.repriced));
    const totalCol = isProd ? 'total' : columns[columns.length - 1]?.key;
    const hrs = timeCol ? (r.cells.timeHrs?.original ?? r.timeHrs) : r.timeHrs;
    const your = r.kind === 'operation' || r.kind === 'overheadItem' ? fmt(r.cells[totalCol]?.repriced) + (r.cells[totalCol]?.overridden ? ' *' : '') : '';
    body.push([label, ...(isProd ? [fmtHrs(hrs)] : []), ...cells, your].map((v, i) => ({ content: v, styles: { fontStyle: caps && i === 0 ? 'bold' : 'normal' } })));
  }
  autoTable(doc, {
    startY: margin + 50, margin: { left: margin, right: margin }, head, body, theme: 'plain',
    styles: { font: 'helvetica', fontSize: 7.5, cellPadding: { top: 1.6, bottom: 1.6, left: 3, right: 3 }, textColor: ink, lineColor: [200, 205, 210], lineWidth: 0, overflow: 'linebreak' },
    headStyles: { fontStyle: 'normal', textColor: grey, halign: 'right', valign: 'bottom', lineWidth: { bottom: 0.5 }, lineColor: ink },
    columnStyles: Object.fromEntries(head[0].map((_, i) => [i, { halign: i === 0 ? 'left' : 'right', cellWidth: i === 0 ? 190 : 'auto' }])),
    didParseCell: (d) => {
      if (d.section !== 'body') return;
      const k = rowMeta[d.row.index]?.kind;
      if (k === 'subtotal' || k === 'total' || k === 'net') d.cell.styles.lineWidth = { top: 0.4, bottom: 0, left: 0, right: 0 };
      if (k === 'total' || k === 'net') d.cell.styles.fontStyle = 'bold';
      if (d.column.index === 0) d.cell.styles.halign = 'left';
      const text = String(d.cell.raw && typeof d.cell.raw === 'object' && 'content' in d.cell.raw ? (d.cell.raw as { content: string }).content : d.cell.raw ?? '');
      if (text.startsWith('-')) d.cell.styles.textColor = [178, 34, 34];
    },
  });
  const endY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;
  let y = endY + 14;
  const H = doc.internal.pageSize.getHeight();
  const para = (text: string, size = 7.5, color: [number, number, number] = grey) => {
    doc.setFontSize(size); doc.setTextColor(...color); doc.setFont('helvetica', 'normal');
    const lines = doc.splitTextToSize(text, W - margin * 2) as string[];
    if (y + lines.length * (size + 2) > H - margin) { doc.addPage(); y = margin; }
    doc.text(lines, margin, y); y += lines.length * (size + 2) + 4;
  };
  para(repricingSentence(table, meta) + ' * marks a Your Cost edit.');
  if (meta.study) para(`Study: ${meta.study.title}, ${meta.study.region}, ${meta.study.year}. ${meta.study.url}`);
  for (const s of meta.series) para(`${s.name}: ${s.source} (${s.unit}), latest ${periodText(s.lastPeriod)}. ${s.url}`);
  if (meta.mappingNotes.length) para('How each line was repriced: ' + meta.mappingNotes.map(m => `${m.label} by ${m.series} (${m.note})`).join('; ') + '.');

  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p); doc.setFontSize(7); doc.setTextColor(...grey);
    doc.text('Cost study repricer, all money in USD', margin, H - 18);
    doc.text(`Page ${p} of ${pages}`, W - margin, H - 18, { align: 'right' });
  }
  return new Uint8Array(doc.output('arraybuffer'));
}
