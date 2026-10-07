import type { RepricedTable } from './types';
import { fallbackSentence, fmt, fmtHrs, periodText, repricingSentence, type ExportMeta } from './exportShared';

/**
 * The study's table on a landscape letter page, laid out the way UC prints it: a title block,
 * the study's own columns, section headings, subtotal and total rows, and footnotes that say how
 * each figure was repriced and where the series come from.
 */
export async function buildPdf(table: RepricedTable, meta: ExportMeta, options: { includeDetails?: boolean } = {}): Promise<Uint8Array> {
  if (table.layout === 'establishment') return buildEstablishmentPdf(table, meta, options);
  const { jsPDF } = await import('jspdf');
  const { default: autoTable } = await import('jspdf-autotable');
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'letter' });
  const W = doc.internal.pageSize.getWidth();
  const margin = 36;
  const ink: [number, number, number] = [20, 22, 25];
  const grey: [number, number, number] = [91, 100, 112];

  // Title block, centered like the study page.
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...grey);
  doc.text('Cost study repricer', W / 2, margin, { align: 'center' });
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
    ? [['Operation', 'Time\n(Hrs/A)', ...columns.map(c => c.label.replace(' & ', ' &\n').replace('/ ', '/\n'))]]
    : [['Operation', ...columns.map(c => c.label)]];
  const body: (string | { content: string; styles?: Record<string, unknown> })[][] = [];
  const rowMeta: { kind: string }[] = [];
  for (const r of table.rows) {
    rowMeta.push({ kind: r.kind });
    if (r.kind === 'heading') { body.push([{ content: r.label, styles: { fontStyle: 'bold' } }, ...Array(head[0].length - 1).fill('')]); continue; }
    if (r.kind === 'blank') { body.push(Array(head[0].length).fill('')); continue; }
    const caps = r.kind === 'subtotal' || r.kind === 'total' || r.kind === 'net' || r.kind === 'returns';
    const label = caps ? r.label.toUpperCase() : `    ${r.label}`;
    const cells = columns.map(c => fmt(r.cells[c.key]?.repriced) + (r.cells[c.key]?.overridden ? ' *' : ''));
    const hrs = timeCol ? (r.cells.timeHrs?.original ?? r.timeHrs) : r.timeHrs;
    body.push([label, ...(isProd ? [fmtHrs(hrs)] : []), ...cells].map((v, i) => ({ content: v, styles: { fontStyle: caps && i === 0 ? 'bold' : 'normal' } })));
  }
  autoTable(doc, {
    startY: margin + 50, margin: { left: margin, right: margin, bottom: 48 }, head, body, theme: 'plain',
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
  if (options.includeDetails) {
  para(repricingSentence(table, meta) + ' * marks an edited value.');
  para(fallbackSentence(table));
  if (meta.study) para(`Source study: UC Davis, ${meta.study.title}, ${meta.study.region}, ${meta.study.year}. ${meta.study.url}`);
  for (const s of meta.series) para(`${s.name}: ${s.source} (${s.unit}), latest ${periodText(s.lastPeriod)}. ${s.url}`);
  if (meta.mappingNotes.length) para('How each line was repriced: ' + meta.mappingNotes.map(m => `${m.label} by ${m.series} (${m.note})`).join('; ') + '.');

  }
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p); doc.setFontSize(7); doc.setTextColor(...grey);
    if (meta.sourcesUrl) doc.textWithLink('Sources and calculations', margin, H - 32, { url: meta.sourcesUrl });
    doc.text('Cost study repricer, all money in USD | * Edited', margin, H - 18);
    doc.text(`Page ${p} of ${pages}`, W - margin, H - 18, { align: 'right' });
  }
  return new Uint8Array(doc.output('arraybuffer'));
}

/** Portrait, serif type, original year columns and source-page breaks for establishment tables. */
async function buildEstablishmentPdf(table: RepricedTable, meta: ExportMeta, options: { includeDetails?: boolean } = {}): Promise<Uint8Array> {
  const { jsPDF } = await import('jspdf');
  const { default: autoTable } = await import('jspdf-autotable');
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'letter' });
  const margin = 40, width = 532;
  const groups: RepricedTable['rows'][] = [];
  for (const row of table.rows) {
    const last = groups.at(-1);
    if (!last || (row.page != null && last.at(-1)?.page != null && row.page !== last.at(-1)?.page)) groups.push([row]);
    else last.push(row);
  }
  const clean = (s: string) => s.replace(/[“”]/g, '"').replace(/[’]/g, "'").replace(/[–—]/g, '-');
  groups.forEach((rows, groupIndex) => {
    if (groupIndex) doc.addPage();
    const title = (continued: boolean) => {
      doc.setFont('times', 'normal'); doc.setFontSize(9);
      doc.text('Cost study repricer', 306, 38, { align: 'center' });
      doc.setFont('times', 'bold'); doc.setFontSize(10);
      const lines = doc.splitTextToSize(clean(table.title.toUpperCase()) + (continued ? ' (CONTINUED)' : ''), width) as string[];
      doc.text(lines, 306, 51, { align: 'center' });
      doc.setFont('times', 'normal'); doc.setFontSize(10);
      doc.text(clean([meta.study?.region, meta.study?.year].filter(Boolean).join(' - ')), 306, 51 + lines.length * 11, { align: 'center' });
      doc.setFontSize(8);
      doc.text(`Repriced to ${periodText(table.targetPeriod)} | Reference: ${periodText(table.referencePeriod)} | USD per acre`, 306, 78, { align: 'center' });
    };
    const head = [
      [{ content: 'Costs per Acre', colSpan: table.columns.length + 1, styles: { halign: 'center' as const } }],
      ['Year:', ...table.columns.map(c => c.label)],
      [clean(table.yieldRow?.label ?? 'Operation:'), ...table.columns.map((_, i) => fmt(table.yieldRow?.values[i]))],
    ];
    autoTable(doc, {
      startY: 86, margin: { top: 86, bottom: 48, left: margin, right: margin }, head,
      body: rows.map(r => [clean(r.displayLabel ?? r.label) + (r.kind === 'heading' ? ':' : ''), ...table.columns.map(c => {
        const cell = r.cells[c.key];
        return fmt(cell?.repriced) + (cell?.overridden ? '*' : '');
      })]),
      theme: 'plain', showHead: 'everyPage', rowPageBreak: 'avoid',
      styles: { font: 'times', fontSize: 9, cellPadding: { top: 0.6, bottom: 0.6, left: 3, right: 3 }, textColor: [0, 0, 0], overflow: 'linebreak', halign: 'right' },
      columnStyles: { 0: { halign: 'left', cellWidth: 302 } },
      headStyles: { fontStyle: 'normal', lineColor: [0, 0, 0], lineWidth: { bottom: 0.4 } },
      didParseCell(d) {
        if (d.section === 'head' && d.column.index === 0 && d.row.index > 0) d.cell.styles.halign = 'left';
        if (d.section !== 'body') return;
        const row = rows[d.row.index];
        if (['subtotal', 'total', 'returns'].includes(row.kind)) {
          d.cell.styles.lineColor = [0, 0, 0];
          d.cell.styles.lineWidth = { top: 0.35, bottom: 0.35, left: 0, right: 0 };
        }
        if (row.kind === 'returns') d.cell.styles.fontStyle = 'bold';
        if (d.column.index > 0 && (row.cells[table.columns[d.column.index - 1].key]?.repriced ?? 0) < 0) d.cell.styles.textColor = [178, 34, 34];
      },
      didDrawPage(d) { title(groupIndex > 0 || d.pageNumber > 1); },
    });
  });
  if (options.includeDetails) {
  doc.addPage();
  let y = 42;
  const paragraph = (text: string, bold = false) => {
    doc.setFont('times', bold ? 'bold' : 'normal'); doc.setFontSize(bold ? 11 : 9);
    const lines = doc.splitTextToSize(clean(text), width) as string[];
    for (const line of lines) {
      if (y > 744) { doc.addPage(); y = 42; }
      doc.text(line, margin, y); y += 11;
    }
    y += 6;
  };
  paragraph('Calculation notes and sources', true);
  paragraph('Repriced worksheet. * marks a lender edit.');
  paragraph(repricingSentence(table, meta));
  paragraph(fallbackSentence(table));
  for (const note of table.notes ?? []) paragraph(note);
  if (meta.study) paragraph(`Source study: UC Davis, ${meta.study.title}. ${meta.study.url}`);
  for (const s of meta.series) paragraph(`${s.name}: ${s.source} (${s.unit}). ${s.url}`);
  for (const m of meta.mappingNotes) paragraph(`${m.label}: ${m.series}. ${m.note}`);
  }
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p); doc.setFont('times', 'normal'); doc.setFontSize(8);
    if (meta.sourcesUrl) doc.textWithLink('Sources and calculations', margin, 755, { url: meta.sourcesUrl });
    doc.text('Cost study repricer | USD per acre | * Edited', margin, 770);
    doc.text(`${p} / ${pages}`, 572, 770, { align: 'right' });
  }
  return new Uint8Array(doc.output('arraybuffer'));
}
