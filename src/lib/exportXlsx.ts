import type { RepricedTable } from './types';
import { periodText, repricingSentence, type ExportMeta } from './exportShared';

/** One sheet with the study table (original, factor, and adjusted cost per column) and a Sources sheet. */
export async function buildWorkbook(table: RepricedTable, meta: ExportMeta): Promise<Uint8Array> {
  const { default: ExcelJS } = await import('exceljs');
  const book = new ExcelJS.Workbook();
  book.creator = 'Cost study repricer';
  const ws = book.addWorksheet('Table', { views: [{ state: 'frozen', xSplit: 1, ySplit: 4 }] });
  ws.getCell('A1').value = table.title.toUpperCase(); ws.getCell('A1').font = { bold: true, size: 12 };
  ws.getCell('A2').value = [meta.study?.region, meta.study?.year].filter(Boolean).join(', ');
  ws.getCell('A3').value = `Repriced to ${periodText(table.targetPeriod)} from prices as of ${periodText(table.referencePeriod)}. Per acre.`;
  const isProd = table.layout === 'production';
  const timeCol = table.columns.find(c => c.key === 'timeHrs');
  const columns = table.columns.filter(c => c.key !== 'timeHrs');
  const header: string[] = ['Operation', ...(isProd ? ['Time (Hrs/A)'] : [])];
  for (const c of columns) header.push(`${c.label} (study)`, `${c.label} factor`, `${c.label} (today)`);
  const h = ws.addRow(header); h.font = { bold: true }; h.alignment = { wrapText: true, vertical: 'bottom' };
  h.eachCell(cell => { cell.border = { bottom: { style: 'thin' } }; });
  if (table.yieldRow) {
    const values: (string | number | null)[] = [table.yieldRow.label];
    for (const v of table.yieldRow.values) values.push(v, null, v);
    ws.addRow(values);
  }
  for (const r of table.rows) {
    if (r.kind === 'blank') { ws.addRow([]); continue; }
    const caps = r.kind === 'subtotal' || r.kind === 'total' || r.kind === 'net' || r.kind === 'returns';
    const label = r.displayLabel ?? r.label;
    const vals: (string | number | null)[] = [caps ? label.toUpperCase() : r.kind === 'heading' ? label : `  ${label}`];
    if (isProd) vals.push((timeCol ? (r.cells.timeHrs?.original ?? r.timeHrs) : r.timeHrs) ?? null);
    if (r.kind !== 'heading') {
      for (const c of columns) { const cell = r.cells[c.key]; vals.push(cell?.original ?? null, cell?.factor ?? null, cell?.repriced ?? null); }
    }
    const row = ws.addRow(vals);
    if (caps || r.kind === 'heading') row.font = { bold: true };
    row.eachCell((cell, col) => {
      if (col === 1) return;
      const label = header[col - 1] ?? '';
      if (label.endsWith('factor')) cell.numFmt = '0.000';
      else if (typeof cell.value === 'number') cell.numFmt = '#,##0;[Red]-#,##0';
    });
    columns.forEach((c, i) => {
      const data = r.cells[c.key];
      if (!data) return;
      const target = row.getCell((isProd ? 3 : 2) + i * 3 + 2);
      if (data.overridden) target.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF4CC' } };
      target.note = [data.overridden ? 'Lender edit' : data.seriesId ?? 'Calculated or retained study value', data.note ?? ''].filter(Boolean).join('\n');
    });
  }
  ws.addRow([]);
  ws.addRow([repricingSentence(table, meta)]);
  ws.getColumn(1).width = 44; for (let c = 2; c <= header.length; c++) ws.getColumn(c).width = 13;

  const src = book.addWorksheet('Sources');
  src.addRow(['What', 'Source', 'Unit', 'Latest period', 'Link']).font = { bold: true };
  if (meta.study) src.addRow([`Source study: UC Davis, ${meta.study.title}`, `${meta.study.region}, ${meta.study.year}`, '', meta.study.priceYear ? `prices as of ${meta.study.priceYear}` : '', meta.study.url]);
  for (const s of meta.series) src.addRow([s.name, s.source, s.unit, periodText(s.lastPeriod), s.url]);
  src.addRow([]);
  src.addRow(['Line category', 'Series', 'Note']).font = { bold: true };
  for (const m of meta.mappingNotes) src.addRow([m.label, m.series, m.note]);
  src.addRow([]);
  src.addRow(['Calculation notes and study discrepancies']).font = { bold: true };
  for (const note of table.notes ?? []) src.addRow([note]);
  [44, 40, 18, 18, 60].forEach((w, i) => { src.getColumn(i + 1).width = w; });
  return new Uint8Array(await book.xlsx.writeBuffer());
}

export function download(bytes: Uint8Array, filename: string, mime: string) {
  const blob = new Blob([bytes as BlobPart], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
