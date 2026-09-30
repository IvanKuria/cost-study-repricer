import type { OperationRow, ParsedStudy } from '../data/studySchema';
import type { Category, CategoryMapping, RepriceSettings, RepricedCell, RepricedRow, RepricedTable, Series } from './types';
import { classifyRow, impliedInterest, rowCategory, type CellClass } from './classify';
import { DEFAULT_MAPPING, REPAIRS_SERIES_ID, SEEDS_SERIES_ID } from '../data/mapping';
import { SERIES, latestPeriod, periodKey, ratio, seriesById } from './series';

export const DEFAULT_SETTINGS: RepriceSettings = { targetPeriod: '', referenceMonth: 6, interestRate: null, overrides: {}, mapping: DEFAULT_MAPPING };

/** Optional establishment table shape the sibling parser will add; every field defensive. */
interface EstablishmentTable { columns: string[]; rows: { label: string; section?: string; kind?: RepricedRow['kind']; values: (number | null)[]; page?: number; quote?: string }[] }

export interface Factor { seriesId: string | null; indexFrom: number | null; indexTo: number | null; factor: number | null; note: string | null }

const SECTION_LABEL: Record<OperationRow['category'], string> = { cultural: 'Cultural', harvest: 'Harvest', assessment: 'Assessment', postharvest: 'Postharvest', other: 'Other' };
const round = (n: number | null) => (n == null ? null : Math.round(n));

/** Reference period: the study's stated price year and month, else the study year with the settings' reference month (June). */
export function referencePeriod(study: ParsedStudy, settings: RepriceSettings): { period: string; note: string } {
  const py = study.source.priceYear;
  const year = py?.value ?? study.source.year ?? study.source.indexYear ?? new Date().getFullYear();
  const month = py?.month ?? settings.referenceMonth;
  const note = py ? `Study prices are for ${py.month ? `month ${py.month} of ` : ''}${py.value}: "${py.quote}"` : `Study does not state a price year; its ${year} title year with month ${settings.referenceMonth} is used.`;
  return { period: periodKey(year, month), note };
}

/** The series and factor for one classified cell. Seeds use the seeds index when present; combined fuel columns use fuels. */
export function factorFor(cls: CellClass, from: string, to: string, mapping: CategoryMapping[], series: Series[]): Factor {
  const map = mapping.find(m => m.category === cls.category);
  let id: string | null = map?.seriesId ?? null;
  if (cls.part === 'seeds' && seriesById(SEEDS_SERIES_ID, series)) id = SEEDS_SERIES_ID;
  if (cls.part === 'repairs' && seriesById(REPAIRS_SERIES_ID, series)) id = REPAIRS_SERIES_ID;
  const tryIds = [id, map?.fallbackSeriesId ?? null, 'bls.cpi'].filter((x): x is string => !!x);
  for (const sid of tryIds) {
    const s = seriesById(sid, series); if (!s) continue;
    const r = ratio(s, from, to); if (!r) continue;
    const notes: string[] = [];
    if (sid !== id) notes.push(`${id} unavailable, ${sid} used`);
    if (!r.from.exact) notes.push(`no ${from} value in ${sid}; ${r.from.period} used`);
    if (!r.to.exact) notes.push(`no ${to} value in ${sid}; ${r.to.period} used`);
    return { seriesId: sid, indexFrom: r.from.value, indexTo: r.to.value, factor: r.factor, note: notes.length ? notes.join('; ') : null };
  }
  return { seriesId: null, indexFrom: null, indexTo: null, factor: null, note: 'no series covers this period' };
}

function cellFrom(original: number | null, cls: CellClass | null, f: Factor | null): RepricedCell {
  const repriced = original == null ? null : f?.factor == null ? original : original * f.factor;
  return { original, category: cls?.category ?? null, seriesId: f?.seriesId ?? null, indexFrom: f?.indexFrom ?? null, indexTo: f?.indexTo ?? null, factor: f?.factor ?? null, repriced, overridden: false };
}
const plainCell = (original: number | null, repriced: number | null, category: Category | null = null): RepricedCell => ({ original, category, seriesId: null, indexFrom: null, indexTo: null, factor: original && repriced != null ? repriced / original : null, repriced, overridden: false });
const sumCells = (rows: RepricedRow[], col: string): RepricedCell => plainCell(
  rows.reduce((s, r) => s + (r.cells[col]?.original ?? 0), 0),
  rows.reduce((s, r) => s + (r.cells[col]?.repriced ?? 0), 0));

const PROD_COLUMNS = [
  { key: 'labor', label: 'Labor Cost' }, { key: 'fuelLubeRepairs', label: 'Fuel, Lube & Repairs' }, { key: 'materials', label: 'Material Cost' },
  { key: 'custom', label: 'Custom/Rent' }, { key: 'total', label: 'Total Cost' },
];

/** Interest on operating capital, the study's way: each month's cumulative cash operating cost carries the monthly rate through the last harvest month. */
export function operatingInterest(study: ParsedStudy, operatingExInterest: number, yearlyRate: number): { value: number; note: string } | null {
  const m = study.monthly;
  const weights = m?.operatingPerAcre ?? m?.cashCostsPerAcre;
  if (!m || !weights || weights.length !== 12) return null;
  const total = weights.reduce((a, b) => a + Math.max(0, b), 0);
  if (total <= 0) return null;
  const lastHarvest = m.harvestMonths.lastIndexOf(true);
  const end = lastHarvest >= 0 ? lastHarvest : 11;
  let cum = 0, interest = 0;
  for (let i = 0; i <= end; i++) { cum += operatingExInterest * Math.max(0, weights[i]) / total; interest += cum * yearlyRate / 12; }
  return { value: interest, note: `Recomputed monthly on repriced operating costs through ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][end]} at ${(yearlyRate * 100).toFixed(2)} percent a year, following the study's monthly table (page ${m.page}).` };
}

export function repriceStudy(study: ParsedStudy, settingsIn: Partial<RepriceSettings> = {}, series: Series[] = SERIES): RepricedTable {
  const settings: RepriceSettings = { ...DEFAULT_SETTINGS, ...settingsIn, mapping: settingsIn.mapping ?? DEFAULT_MAPPING, overrides: settingsIn.overrides ?? {} };
  const ref = referencePeriod(study, settings);
  const target = settings.targetPeriod || latestPeriod(series);
  const F = (cls: CellClass) => factorFor(cls, ref.period, target, settings.mapping, series);
  const est = (study.establishment as (typeof study.establishment & { table?: EstablishmentTable }) | null | undefined)?.table;
  const table = est && est.columns?.length && est.rows?.length
    ? establishmentLayout(study, est, settings, ref.period, target, F)
    : productionLayout(study, settings, ref.period, target, F);
  return table;
}

function applyOverride(row: RepricedRow, col: string, settings: RepriceSettings) {
  const v = settings.overrides[`${row.id}:${col}`] ?? (col === 'total' ? settings.overrides[row.id] : undefined);
  if (v === undefined || !row.cells[col]) return;
  row.cells[col] = { ...row.cells[col], repriced: v, overridden: true, factor: row.cells[col].original ? v / (row.cells[col].original as number) : null };
}

function productionLayout(study: ParsedStudy, settings: RepriceSettings, ref: string, target: string, F: (c: CellClass) => Factor): RepricedTable {
  const rows: RepricedRow[] = [];
  const ops = study.costsPerAcre.operations;
  const opRows: RepricedRow[] = [];
  const bySection = new Map<OperationRow['category'], RepricedRow[]>();
  ops.forEach((o, i) => {
    const c = classifyRow(o);
    const fuelPart = o.fuel ?? 0, repairPart = o.lubeRepairs ?? 0;
    const fFuel = F(c.fuel), fRep = F(c.lubeRepairs);
    const flr: RepricedCell = o.fuel == null && o.lubeRepairs == null ? cellFrom(null, c.fuel, fFuel) : {
      ...cellFrom(fuelPart + repairPart, c.fuel, fFuel),
      repriced: fuelPart * (fFuel.factor ?? 1) + repairPart * (fRep.factor ?? 1),
      seriesId: repairPart > 0 && fRep.seriesId !== fFuel.seriesId ? `${fFuel.seriesId}+${fRep.seriesId}` : fFuel.seriesId,
    };
    if (flr.original) flr.factor = (flr.repriced ?? 0) / flr.original;
    const cells: Record<string, RepricedCell> = {
      labor: cellFrom(o.labor, c.labor, F(c.labor)),
      fuelLubeRepairs: flr,
      materials: cellFrom(o.materials, c.materials, o.materials ? F(c.materials) : null),
      custom: cellFrom(o.customRent, c.customRent, o.customRent ? F(c.customRent) : null),
    };
    const origTotal = o.totalCost ?? ['labor', 'fuelLubeRepairs', 'materials', 'custom'].reduce((s, k) => s + (cells[k].original ?? 0), 0);
    const repTotal = ['labor', 'fuelLubeRepairs', 'materials', 'custom'].reduce((s, k) => s + (cells[k].repriced ?? 0), 0);
    cells.total = plainCell(origTotal, repTotal);
    const row: RepricedRow = { id: `op-${i}`, label: o.name, kind: 'operation', section: SECTION_LABEL[o.category], timeHrs: o.timeHrsPerAcre, cells, page: o.page, quote: o.quote };
    for (const col of Object.keys(cells)) applyOverride(row, col, settings);
    if (row.cells.total.overridden === false && ['labor', 'fuelLubeRepairs', 'materials', 'custom'].some(k => row.cells[k].overridden)) {
      row.cells.total = { ...row.cells.total, repriced: ['labor', 'fuelLubeRepairs', 'materials', 'custom'].reduce((s, k) => s + (row.cells[k].repriced ?? 0), 0) };
    }
    opRows.push(row);
    const list = bySection.get(o.category) ?? []; list.push(row); bySection.set(o.category, list);
  });
  const order: OperationRow['category'][] = ['cultural', 'harvest', 'assessment', 'postharvest', 'other'];
  for (const sec of order) {
    const list = bySection.get(sec); if (!list) continue;
    rows.push({ id: `h-${sec}`, label: `${SECTION_LABEL[sec]} costs`, kind: 'heading', section: SECTION_LABEL[sec], timeHrs: null, cells: {}, page: null, quote: null });
    rows.push(...list);
    rows.push({ id: `st-${sec}`, label: `TOTAL ${SECTION_LABEL[sec].toUpperCase()} COSTS`, kind: 'subtotal', section: SECTION_LABEL[sec], timeHrs: null, cells: Object.fromEntries(PROD_COLUMNS.map(c => [c.key, sumCells(list, c.key)])), page: null, quote: null });
  }
  // Interest on operating capital.
  const interest = impliedInterest(study);
  const opOrig = opRows.reduce((s, r) => s + (r.cells.total.original ?? 0), 0);
  const opRep = opRows.reduce((s, r) => s + (r.cells.total.repriced ?? 0), 0);
  let interestRow: RepricedRow | null = null;
  if (interest) {
    let rep: number; let note: string;
    if (settings.interestRate != null) {
      const calc = operatingInterest(study, opRep, settings.interestRate);
      if (calc) { rep = calc.value; note = calc.note; }
      else { const studyRate = (study.assumptions.operatingInterestRatePct?.value ?? 0) / 100; rep = studyRate > 0 ? interest.value * (settings.interestRate / studyRate) * (opOrig > 0 ? opRep / opOrig : 1) : interest.value * (opOrig > 0 ? opRep / opOrig : 1); note = `No monthly table: the study's interest scaled by the rate ratio (${(settings.interestRate * 100).toFixed(2)} over ${study.assumptions.operatingInterestRatePct?.value ?? '?'} percent) and by repriced over original operating cost.`; }
    } else { rep = interest.value * (opOrig > 0 ? opRep / opOrig : 1); note = `Study's own rate${study.assumptions.operatingInterestRatePct ? ` (${study.assumptions.operatingInterestRatePct.value} percent)` : ''} kept; interest scales with repriced operating cost.`; }
    interestRow = { id: 'interest', label: 'Interest on operating capital', kind: 'interest', section: 'Operating', timeHrs: null, cells: { total: { ...plainCell(interest.value, rep, 'operatingInterest'), seriesId: settings.interestRate != null ? 'kcfed.operatingRate' : null } }, page: null, quote: `${interest.note} ${note}` };
    applyOverride(interestRow, 'total', settings);
    rows.push(interestRow);
  }
  const totalOperating: RepricedRow = { id: 'total-operating', label: 'TOTAL OPERATING COSTS/ACRE', kind: 'total', section: 'Operating', timeHrs: null, cells: Object.fromEntries(PROD_COLUMNS.map(c => [c.key, c.key === 'total' ? plainCell(opOrig + (interestRow?.cells.total.original ?? 0), opRep + (interestRow?.cells.total.repriced ?? 0)) : sumCells(opRows, c.key)])), page: study.costsPerAcre.operatingTotal?.page ?? null, quote: study.costsPerAcre.operatingTotal?.quote ?? null };
  rows.push(totalOperating);

  // Cash overhead items.
  rows.push({ id: 'h-cash', label: 'CASH OVERHEAD', kind: 'heading', section: 'Cash overhead', timeHrs: null, cells: {}, page: null, quote: null });
  const ohRows: RepricedRow[] = study.costsPerAcre.cashOverheadItems.map((it, i) => {
    const cls: CellClass = { category: 'cashOverhead', confidence: 'column' };
    const row: RepricedRow = { id: `oh-${i}`, label: it.description, kind: 'overheadItem', section: 'Cash overhead', timeHrs: null, cells: { total: cellFrom(it.value, cls, F(cls)) }, page: it.page, quote: it.quote };
    applyOverride(row, 'total', settings); return row;
  });
  rows.push(...ohRows);
  const cashOhOrig = study.costsPerAcre.cashOverheadTotal?.value ?? ohRows.reduce((s, r) => s + (r.cells.total.original ?? 0), 0);
  const itemsOrig = ohRows.reduce((s, r) => s + (r.cells.total.original ?? 0), 0);
  // If the printed total exceeds the parsed items, the remainder is carried as an unparsed line so totals still match the study.
  if (cashOhOrig - itemsOrig > 1) {
    const cls: CellClass = { category: 'cashOverhead', confidence: 'fallback' };
    const row: RepricedRow = { id: 'oh-rest', label: 'Other cash overhead (not itemized in the parsed table)', kind: 'overheadItem', section: 'Cash overhead', timeHrs: null, cells: { total: cellFrom(cashOhOrig - itemsOrig, cls, F(cls)) }, page: null, quote: null };
    applyOverride(row, 'total', settings); ohRows.push(row); rows.push(row);
  }
  const totalCashOh: RepricedRow = { id: 'total-cash-oh', label: 'TOTAL CASH OVERHEAD COSTS', kind: 'subtotal', section: 'Cash overhead', timeHrs: null, cells: { total: sumCells(ohRows, 'total') }, page: null, quote: null };
  rows.push(totalCashOh);
  rows.push({ id: 'total-cash', label: 'TOTAL CASH COSTS/ACRE', kind: 'total', section: 'Cash overhead', timeHrs: null, cells: { total: plainCell((totalOperating.cells.total.original ?? 0) + (totalCashOh.cells.total.original ?? 0), (totalOperating.cells.total.repriced ?? 0) + (totalCashOh.cells.total.repriced ?? 0)) }, page: null, quote: null });

  // Non-cash overhead: itemized when the parser gives items, else the printed total as one line.
  rows.push({ id: 'h-noncash', label: 'NON-CASH OVERHEAD', kind: 'heading', section: 'Non-cash overhead', timeHrs: null, cells: {}, page: null, quote: null });
  const ncItems = (study.costsPerAcre as { nonCashOverheadItems?: { description: string; value: number; page: number; quote: string }[] }).nonCashOverheadItems;
  const ncRows: RepricedRow[] = [];
  const ncCls: CellClass = { category: 'nonCashOverhead', confidence: 'column' };
  if (ncItems && ncItems.length) ncItems.forEach((it, i) => { const row: RepricedRow = { id: `nc-${i}`, label: it.description, kind: 'overheadItem', section: 'Non-cash overhead', timeHrs: null, cells: { total: cellFrom(it.value, ncCls, F(ncCls)) }, page: it.page, quote: it.quote }; applyOverride(row, 'total', settings); ncRows.push(row); });
  else if (study.costsPerAcre.nonCashOverheadTotal) { const t = study.costsPerAcre.nonCashOverheadTotal; const row: RepricedRow = { id: 'nc-0', label: 'Capital recovery, insurance and taxes on equipment and investments (printed total)', kind: 'overheadItem', section: 'Non-cash overhead', timeHrs: null, cells: { total: cellFrom(t.value, ncCls, F(ncCls)) }, page: t.page, quote: t.quote }; applyOverride(row, 'total', settings); ncRows.push(row); }
  rows.push(...ncRows);
  const totalNc: RepricedRow = { id: 'total-noncash', label: 'TOTAL NON-CASH OVERHEAD COSTS', kind: 'subtotal', section: 'Non-cash overhead', timeHrs: null, cells: { total: sumCells(ncRows, 'total') }, page: null, quote: null };
  rows.push(totalNc);
  const totalOrig = (totalOperating.cells.total.original ?? 0) + (totalCashOh.cells.total.original ?? 0) + (totalNc.cells.total.original ?? 0);
  const totalRep = (totalOperating.cells.total.repriced ?? 0) + (totalCashOh.cells.total.repriced ?? 0) + (totalNc.cells.total.repriced ?? 0);
  rows.push({ id: 'total', label: 'TOTAL COSTS/ACRE', kind: 'total', section: 'Total', timeHrs: null, cells: { total: plainCell(totalOrig, totalRep) }, page: study.costsPerAcre.totalCost?.page ?? null, quote: study.costsPerAcre.totalCost?.quote ?? null });

  // Returns are the study's; the lender changes them by override.
  const gross = study.costsPerAcre.grossReturns;
  if (gross) {
    const gr: RepricedRow = { id: 'gross', label: 'GROSS RETURNS/ACRE', kind: 'returns', section: 'Returns', timeHrs: null, cells: { total: plainCell(gross.value, gross.value) }, page: gross.page, quote: gross.quote };
    applyOverride(gr, 'total', settings);
    rows.push(gr);
    const g = gr.cells.total.repriced ?? gross.value;
    rows.push({ id: 'net-operating', label: 'NET RETURNS ABOVE OPERATING COSTS', kind: 'net', section: 'Returns', timeHrs: null, cells: { total: plainCell(gross.value - (totalOperating.cells.total.original ?? 0), g - (totalOperating.cells.total.repriced ?? 0)) }, page: null, quote: null });
    rows.push({ id: 'net-total', label: 'NET RETURNS ABOVE TOTAL COSTS', kind: 'net', section: 'Returns', timeHrs: null, cells: { total: plainCell(gross.value - totalOrig, g - totalRep) }, page: null, quote: null });
  }

  return {
    studyId: study.source.id, title: study.source.title, layout: 'production',
    columns: [{ key: 'timeHrs', label: 'Time (Hrs/A)' }, ...PROD_COLUMNS],
    rows, referencePeriod: ref, targetPeriod: target,
    summary: summarize(rows, totalOrig, totalRep, (totalOperating.cells.total.repriced ?? 0) + (totalCashOh.cells.total.repriced ?? 0)),
  };
}

function establishmentLayout(study: ParsedStudy, est: EstablishmentTable, settings: RepriceSettings, ref: string, target: string, F: (c: CellClass) => Factor): RepricedTable {
  const cols = est.columns.map((label, i) => ({ key: `y${i + 1}`, label }));
  const rows: RepricedRow[] = [];
  let section = '';
  const detail: RepricedRow[] = [];
  est.rows.forEach((r, i) => {
    if (r.section) section = r.section;
    const kind = r.kind ?? (/^total|accumulated|net cash/i.test(r.label) ? 'total' : 'operation');
    if (kind === 'operation' || kind === 'overheadItem' || kind === 'interest') {
      const cls = rowCategory(r.label, section);
      const f = F(cls);
      const cells: Record<string, RepricedCell> = {};
      cols.forEach((c, k) => { cells[c.key] = cellFrom(r.values[k] ?? null, cls, f); });
      const row: RepricedRow = { id: `e-${i}`, label: r.label, kind, section, timeHrs: null, cells, page: r.page ?? null, quote: r.quote ?? null };
      for (const c of cols) applyOverride(row, c.key, settings);
      rows.push(row); detail.push(row);
    } else if (kind === 'heading' || kind === 'blank') {
      rows.push({ id: `e-${i}`, label: r.label, kind, section, timeHrs: null, cells: {}, page: null, quote: null });
    } else {
      // Printed totals are recomputed from the repriced detail rows above them since the last total.
      const start = rows.length - 1; let j = start; const group: RepricedRow[] = [];
      while (j >= 0 && rows[j].kind !== 'total' && rows[j].kind !== 'subtotal') { if (rows[j].cells && Object.keys(rows[j].cells).length) group.unshift(rows[j]); j--; }
      const cells: Record<string, RepricedCell> = {};
      cols.forEach((c, k) => { const s = sumCells(group, c.key); cells[c.key] = { ...s, original: r.values[k] ?? s.original }; });
      rows.push({ id: `e-${i}`, label: r.label, kind: kind === 'subtotal' ? 'subtotal' : 'total', section, timeHrs: null, cells, page: r.page ?? null, quote: r.quote ?? null });
    }
  });
  const last = cols.at(-1)!.key;
  const totalRow = [...rows].reverse().find(r => r.kind === 'total');
  const totalOrig = totalRow?.cells[last]?.original ?? null, totalRep = totalRow?.cells[last]?.repriced ?? null;
  return { studyId: study.source.id, title: study.source.title, layout: 'establishment', columns: cols, rows, referencePeriod: ref, targetPeriod: target, summary: summarize(detail, totalOrig, totalRep, null) };
}

function summarize(rows: RepricedRow[], totalOrig: number | null, totalRep: number | null, cashRep: number | null): RepricedTable['summary'] {
  const byCat = new Map<Category, { orig: number; series: string }>();
  let all = 0;
  for (const r of rows) {
    if (r.kind !== 'operation' && r.kind !== 'overheadItem' && r.kind !== 'interest') continue;
    for (const [k, c] of Object.entries(r.cells)) {
      if (k === 'total' && Object.keys(r.cells).length > 1) continue;
      if (!c.category || !c.original) continue;
      const cur = byCat.get(c.category) ?? { orig: 0, series: c.seriesId ?? '' };
      cur.orig += c.original; if (!cur.series && c.seriesId) cur.series = c.seriesId; byCat.set(c.category, cur); all += c.original;
    }
  }
  const coverage = [...byCat].map(([category, v]) => ({ category, share: all ? v.orig / all : 0, seriesId: v.series })).sort((a, b) => b.share - a.share);
  const cpiShare = coverage.filter(c => c.seriesId === 'bls.cpi').reduce((s, c) => s + c.share, 0);
  return { totalPerAcreOriginal: round(totalOrig), totalPerAcreRepriced: round(totalRep), cashPerAcreRepriced: round(cashRep), coverage, cpiShare };
}
