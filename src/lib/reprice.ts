import type { EstablishmentSource, EstablishmentSummary, EstablishmentTable, OperationRow, ParsedStudy } from '../data/studySchema';
import type { Category, CategoryMapping, RepriceSettings, RepricedCell, RepricedRow, RepricedTable, Series } from './types';
import { classifyRow, impliedInterest, rowCategory, type CellClass } from './classify';
import { DEFAULT_MAPPING, REPAIRS_SERIES_ID, SEEDS_SERIES_ID } from '../data/mapping';
import { SERIES, latestPeriod, periodKey, ratio, seriesById } from './series';

export const DEFAULT_SETTINGS: RepriceSettings = { targetPeriod: '', referenceMonth: 6, interestRate: null, overrides: {}, mapping: DEFAULT_MAPPING };

/** Prefer the establishment table's stated price over the production assumptions. Never invent a missing price. */
export function studySalePrice(study: ParsedStudy | null): number | null {
  if (!study) return null;
  const printed = study.establishment?.table?.yieldRow?.label.match(/\$\s*(\d[\d,]*(?:\.\d+)?)/);
  const value = printed ? Number(printed[1].replace(/,/g, '')) : study.assumptions.pricePerUnit?.value;
  return value != null && Number.isFinite(value) && value >= 0 ? value : null;
}

export interface Factor { seriesId: string | null; indexFrom: number | null; indexTo: number | null; factor: number | null; note: string | null }

const NO_ESTABLISHMENT: EstablishmentSummary = { perennial: false, status: 'none', total: null, annualCharge: null, reason: null };
/** The study's establishment summary; older data without one reads as "no establishment information". */
export const establishmentSummaryOf = (study: ParsedStudy): EstablishmentSummary => study.establishmentSummary ?? NO_ESTABLISHMENT;
const SOURCE_WORDS: Record<EstablishmentSource, string> = { table: 'the establishment table', production: 'the production table', investment: 'the investment table', prose: 'the study text' };
const dollars = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;
/** Where the study printed its establishment cost, in plain words. */
export const establishmentSource = (total: NonNullable<EstablishmentSummary['total']>) => `printed in ${SOURCE_WORDS[total.source] ?? 'the study'}, page ${total.page}`;
export const NO_ESTABLISHMENT_NOTE = 'This study prints no establishment cost we could find; establishment is not included.';
const ESTABLISHMENT_CPI_NOTE = 'Establishment cost without a usable establishment table is repriced with the CPI (BLS CPI-U, all items), following the professor\'s rule.';
const hasUsableTable = (study: ParsedStudy) => !!(study.establishment?.table?.years.length && study.establishment.table.rows.length);

const SECTION_LABEL: Record<OperationRow['category'], string> = { cultural: 'Cultural', harvest: 'Harvest', assessment: 'Assessment', postharvest: 'Postharvest', other: 'Other' };
const round = (n: number | null) => (n == null ? null : Math.round(n));

/** Professor's reference convention: June of the study year, even when its prose names another price month. */
export function referencePeriod(study: ParsedStudy, settings: RepriceSettings): { period: string; note: string } {
  const year = study.source.year ?? study.source.priceYear?.value ?? study.source.indexYear;
  if (!year) throw new Error('This study has no reference year.');
  return { period: periodKey(year, settings.referenceMonth), note: `Reference is month ${settings.referenceMonth} of the ${year} study, following the professor's June convention.` };
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
  const cell: RepricedCell = { original, category: cls?.category ?? null, seriesId: f?.seriesId ?? null, indexFrom: f?.indexFrom ?? null, indexTo: f?.indexTo ?? null, factor: f?.factor ?? null, note: f?.note, repriced, overridden: false };
  if (cls?.confidence === 'fallback' && f) cell.fallback = true;
  return cell;
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
  const est = study.establishment?.table;
  const table = settings.layout !== 'production' && est && est.years.length && est.rows.length
    ? establishmentLayout(study, est, settings, ref.period, target, F)
    : productionLayout(study, settings, ref.period, target, F);
  return table;
}

function applyOverride(row: RepricedRow, col: string, settings: RepriceSettings) {
  const cell = row.cells[col];
  if (!cell) return;
  cell.autoFactor = cell.factor;
  const factor = settings.factorOverrides?.[`${row.id}:${col}`];
  if (factor !== undefined && Number.isFinite(factor) && factor >= 0 && cell.original != null && cell.original > 0 && (row.kind === 'operation' || row.kind === 'overheadItem')) {
    row.cells[col] = { ...cell, factor, repriced: cell.original * factor, overridden: true, factorOverridden: true };
  }
  const v = settings.overrides[`${row.id}:${col}`] ?? (col === 'total' ? settings.overrides[row.id] : undefined);
  if (v === undefined || !Number.isFinite(v)) return;
  row.cells[col] = { ...row.cells[col], repriced: v, overridden: true, factorOverridden: false, factor: cell.original ? v / cell.original : null };
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
      parts: [cellFrom(o.fuel, c.fuel, fFuel), cellFrom(o.lubeRepairs, c.lubeRepairs, fRep)],
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
      const repriced = ['labor', 'fuelLubeRepairs', 'materials', 'custom'].reduce((s, k) => s + (row.cells[k].repriced ?? 0), 0);
      row.cells.total = { ...row.cells.total, repriced, factor: origTotal ? repriced / origTotal : null };
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
    const cls: CellClass = { category: 'cashOverhead', confidence: 'column' };
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
  // The professor's rule: establishment is repriced with the CPI, not the machinery index, so its yearly charge is split out of non-cash overhead.
  const estCls: CellClass = { category: 'establishmentCpi', confidence: 'column' };
  const estSummary = establishmentSummaryOf(study);
  const charge = estSummary.annualCharge;
  const notes: string[] = [];
  const ncRow = (id: string, label: string, value: number, cls: CellClass, page: number | null, quote: string | null): RepricedRow => {
    const row: RepricedRow = { id, label, kind: 'overheadItem', section: 'Non-cash overhead', timeHrs: null, cells: { total: cellFrom(value, cls, F(cls)) }, page, quote };
    applyOverride(row, 'total', settings); ncRows.push(row); return row;
  };
  if (ncItems && ncItems.length) {
    ncItems.forEach((it, i) => ncRow(`nc-${i}`, it.description, it.value, /establish/i.test(it.description) ? estCls : ncCls, it.page, it.quote));
    if (ncItems.some(it => /establish/i.test(it.description))) notes.push('The establishment line in non-cash overhead is repriced with the CPI (BLS CPI-U, all items); the other non-cash overhead lines use the machinery index.');
  } else if (study.costsPerAcre.nonCashOverheadTotal) {
    const t = study.costsPerAcre.nonCashOverheadTotal;
    if (charge && charge.value > 0 && charge.value < t.value) {
      ncRow('nc-0', 'Capital recovery, insurance and taxes on equipment and other investments (printed total less the establishment charge)', t.value - charge.value, ncCls, t.page, t.quote);
      ncRow('nc-establishment', 'Establishment cost, yearly charge (CPI)', charge.value, estCls, charge.page, charge.quote);
      notes.push(`The study's non-cash overhead total of ${dollars(t.value)} (page ${t.page}) includes a yearly establishment charge of ${dollars(charge.value)} (page ${charge.page}). That charge is repriced with the CPI (BLS CPI-U, all items); the remaining ${dollars(t.value - charge.value)} uses the machinery index.`);
    } else {
      ncRow('nc-0', 'Capital recovery, insurance and taxes on equipment and investments (printed total)', t.value, ncCls, t.page, t.quote);
      if (charge) notes.push(`The study's yearly establishment charge of ${dollars(charge.value)} (page ${charge.page}) could not be separated from the non-cash overhead total, so the whole total uses the machinery index.`);
    }
  }
  rows.push(...ncRows);
  const totalNc: RepricedRow = { id: 'total-noncash', label: 'TOTAL NON-CASH OVERHEAD COSTS', kind: 'subtotal', section: 'Non-cash overhead', timeHrs: null, cells: { total: sumCells(ncRows, 'total') }, page: null, quote: null };
  rows.push(totalNc);
  const totalOrig = (totalOperating.cells.total.original ?? 0) + (totalCashOh.cells.total.original ?? 0) + (totalNc.cells.total.original ?? 0);
  const totalRep = (totalOperating.cells.total.repriced ?? 0) + (totalCashOh.cells.total.repriced ?? 0) + (totalNc.cells.total.repriced ?? 0);
  rows.push({ id: 'total', label: 'TOTAL COSTS/ACRE', kind: 'total', section: 'Total', timeHrs: null, cells: { total: plainCell(totalOrig, totalRep) }, page: study.costsPerAcre.totalCost?.page ?? null, quote: study.costsPerAcre.totalCost?.quote ?? null });

  // Returns are the study's and are never indexed; the lender changes them by override. A study that prints no
  // per-acre gross returns still gets the row, empty, so a lender can type one in and see net returns.
  const gross = study.costsPerAcre.grossReturns;
  const grossOrig = gross?.value ?? null;
  const grossNote = grossOrig == null
    ? 'The study prints no per-acre gross returns. Type a value to compute net returns.'
    : 'Returns are not indexed. Type a value to update.';
  const gr: RepricedRow = { id: 'gross', label: 'GROSS RETURNS/ACRE', kind: 'returns', section: 'Returns', timeHrs: null, cells: { total: { ...plainCell(grossOrig, grossOrig), note: grossNote } }, page: gross?.page ?? null, quote: gross?.quote ?? null };
  applyOverride(gr, 'total', settings);
  rows.push(gr);
  const g = gr.cells.total.repriced;
  const net = (cost: number | null | undefined, costRep: number | null | undefined) => plainCell(grossOrig == null ? null : grossOrig - (cost ?? 0), g == null ? null : g - (costRep ?? 0));
  rows.push({ id: 'net-operating', label: 'NET RETURNS ABOVE OPERATING COSTS', kind: 'net', section: 'Returns', timeHrs: null, cells: { total: net(totalOperating.cells.total.original, totalOperating.cells.total.repriced) }, page: null, quote: null });
  rows.push({ id: 'net-total', label: 'NET RETURNS ABOVE TOTAL COSTS', kind: 'net', section: 'Returns', timeHrs: null, cells: { total: net(totalOrig, totalRep) }, page: null, quote: null });

  // Establishment cost when the study prints a figure but no usable table (tier 2): repriced by CPI, shown apart, never added to the yearly totals.
  let establishmentNote: string | null = null;
  const estTotal = estSummary.total;
  if (estTotal && !hasUsableTable(study)) {
    const yearly = charge ? ' The yearly establishment charge in non-cash overhead already is.' : '';
    rows.push({ id: 'h-establishment', label: 'ESTABLISHMENT COST (ONE-TIME INVESTMENT)', kind: 'heading', section: 'Establishment', timeHrs: null, cells: {}, page: null, quote: null });
    const row: RepricedRow = {
      id: 'establishment-total', label: 'Establishment cost per acre, accumulated (CPI)', kind: 'overheadItem', section: 'Establishment', timeHrs: null,
      cells: { total: { ...cellFrom(estTotal.value, estCls, F(estCls)), note: 'One-time investment, not added to the yearly total cost.' } },
      page: estTotal.page, quote: estTotal.quote,
      sourceNote: `${establishmentSource(estTotal)[0].toUpperCase()}${establishmentSource(estTotal).slice(1)}. One-time investment, not added to the yearly total cost.${yearly}`,
    };
    applyOverride(row, 'total', settings);
    rows.push(row);
    establishmentNote = `Establishment cost: ${dollars(estTotal.value)} per acre in the study, ${establishmentSource(estTotal)}, repriced with the CPI. It is a one-time investment and is not added to the yearly total cost.${yearly}`;
    notes.push(ESTABLISHMENT_CPI_NOTE);
  } else if (!estTotal && estSummary.status === 'none' && estSummary.perennial && !hasUsableTable(study)) {
    establishmentNote = NO_ESTABLISHMENT_NOTE;
    if (estSummary.reason) notes.push(`Establishment: ${estSummary.reason}`);
  }

  return {
    studyId: study.source.id, title: study.costsPerAcre.title ?? study.source.title, layout: 'production',
    columns: [{ key: 'timeHrs', label: 'Time (Hrs/A)' }, ...PROD_COLUMNS],
    rows, referencePeriod: ref, targetPeriod: target, notes, establishmentNote,
    summary: summarize(rows.filter(r => r.section !== 'Establishment'), totalOrig, totalRep, (totalOperating.cells.total.repriced ?? 0) + (totalCashOh.cells.total.repriced ?? 0)),
  };
}

function establishmentLayout(study: ParsedStudy, est: EstablishmentTable, settings: RepriceSettings, ref: string, target: string, F: (c: CellClass) => Factor): RepricedTable {
  const cols = est.years.map((label, i) => ({ key: `y${i + 1}`, label }));
  const rows: RepricedRow[] = [];
  const notes = new Set<string>([
    'Establishment rows combine inputs. Each whole row uses the category inferred from its label; labor, materials and machinery are not separately priced in this table.',
    'Printed subtotal differences are retained, unindexed. Repriced totals equal the printed total plus changes in its underlying rows; original study figures remain unchanged.',
    ...study.parse.warnings.filter(w => /establishment table/.test(w)),
  ]);
  const details: RepricedRow[] = [];
  const totals = new Map<string, RepricedRow>();
  const incomeCells: Record<string, RepricedCell> = {};
  const sum = (rs: RepricedRow[], c: string, field: 'original' | 'repriced') => rs.reduce((v, r) => v + (r.cells[c]?.[field] ?? 0), 0);
  const isCash = (r: RepricedRow) => /cash overhead/i.test(r.section) && !/non[- ]?cash/i.test(r.section);
  const isNoncash = (r: RepricedRow) => /non[- ]?cash|capital recovery|interest on investment/i.test(r.section);
  const amount = (key: string, col: string, field: 'original' | 'repriced') => totals.get(key)?.cells[col]?.[field] ?? 0;
  const deltaTotal = (original: number | null, before: number, after: number): RepricedCell => {
    const delta = after - before;
    return plainCell(original, original === null && Math.abs(delta) < 1e-8 ? null : (original ?? 0) + delta);
  };
  let sectionDetails: RepricedRow[] = [];
  est.rows.forEach((r, i) => {
    const kind: RepricedRow['kind'] = r.kind === 'income' ? 'returns' : r.kind === 'accumulated' ? 'total' : r.kind;
    const row: RepricedRow = { id: `e-${i}`, label: r.label, kind, section: r.section, timeHrs: null, cells: {}, page: r.page, quote: r.quote };
    if (kind === 'heading') { sectionDetails = []; rows.push(row); return; }
    const L = r.label.toUpperCase();
    let totalKey: string | null = null;
    if (/^TOTAL OPERATING/.test(L)) totalKey = 'operating';
    else if (/^TOTAL CASH OVERHEAD/.test(L)) totalKey = 'cashOh';
    else if (/^TOTAL (NON[- ]?CASH|CAPITAL RECOVERY|INTEREST ON INVESTMENT)/.test(L)) totalKey = 'noncash';
    else if (/^TOTAL CASH COST/.test(L)) totalKey = 'cash';
    else if (/^TOTAL COST(?:S)?(?:\/ACRE| PER ACRE| FOR THE YEAR)/.test(L)) totalKey = 'total';
    const noncashNet = /TOTAL/.test(L) || (!/CASH/.test(L) && isNoncash(row));
    cols.forEach((c, k) => {
      const original = r.values[k] ?? null;
      if (kind === 'operation' || kind === 'overheadItem') {
        const cls = rowCategory(r.label, r.section);
        row.cells[c.key] = cellFrom(original, cls, F(cls));
        applyOverride(row, c.key, settings);
      } else if (kind === 'interest') {
        const ops = details.filter(d => d.kind === 'operation');
        const before = sum(ops, c.key, 'original'), after = sum(ops, c.key, 'repriced');
        const printedRate = r.label.match(/(?:@|at|:)\s*([\d.]+)\s*%/i);
        const studyRate = printedRate ? Number(printedRate[1]) / 100 : (study.assumptions.operatingInterestRatePct?.value ?? 0) / 100;
        if (settings.interestRate != null && studyRate > 0) row.displayLabel = `Interest On Operating Capital @ ${(settings.interestRate * 100).toFixed(2)}%`;
        const rateRatio = settings.interestRate == null ? 1 : studyRate > 0 ? settings.interestRate / studyRate : 1;
        const note = studyRate > 0 || settings.interestRate == null
          ? 'Establishment interest scales by the change in operating costs and the lender rate divided by the printed study rate; no year-specific monthly schedule is available.'
          : 'The study has no usable operating rate; the lender rate cannot be applied. Interest scales only with operating costs.';
        notes.add(note);
        row.cells[c.key] = { ...plainCell(original, original == null ? null : original * (before > 0 ? after / before : 1) * rateRatio, 'operatingInterest'), note };
        applyOverride(row, c.key, settings);
      } else if (kind === 'returns') {
        if (!incomeCells[c.key]) {
          const yieldValue = est.yieldRow?.values[k];
          const rep = settings.pricePerUnit != null && yieldValue != null ? yieldValue * settings.pricePerUnit : original;
          incomeCells[c.key] = { ...plainCell(original, rep), note: est.yieldRow ? 'Returns are not indexed. Change the sale price per unit or type a value to update.' : 'Returns are not indexed. Type a value to update.' };
          const v = settings.overrides[`income:${c.key}`];
          if (v != null) incomeCells[c.key] = { ...incomeCells[c.key], repriced: v, overridden: true };
        }
        const income = incomeCells[c.key];
        row.cells[c.key] = { ...income, ...deltaTotal(original, income.original ?? 0, income.repriced ?? 0), overridden: income.overridden };
      } else if (r.kind === 'accumulated') {
        const key = /CASH/.test(L) ? 'cash' : 'total';
        let before = 0, after = 0;
        for (const prev of cols.slice(0, k + 1)) {
          before += amount(key, prev.key, 'original') - (incomeCells[prev.key]?.original ?? 0);
          after += amount(key, prev.key, 'repriced') - (incomeCells[prev.key]?.repriced ?? 0);
        }
        row.cells[c.key] = deltaTotal(original, before, after);
      } else if (kind === 'net') {
        const key = noncashNet ? 'total' : 'cash';
        const before = amount(key, c.key, 'original') - (incomeCells[c.key]?.original ?? 0);
        const after = amount(key, c.key, 'repriced') - (incomeCells[c.key]?.repriced ?? 0);
        const profit = /PROFIT|RETURNS|INCOME/.test(L);
        const paired = est.rows.some(x => x.kind === 'net' && x.section === r.section && /COST/.test(x.label) && !/PROFIT|RETURNS|INCOME/.test(x.label));
        const expected = profit ? (paired ? Math.max(0, -before) : -before) : before;
        if (original != null && Math.abs(original - expected) > Math.max(3, Math.abs(original) * 0.02)) notes.add(`${r.label}, ${c.label}: the printed net figure differs from cost less income. Its original difference is preserved.`);
        if (profit && paired && !(original != null && original < 0)) {
          row.cells[c.key] = deltaTotal(original, Math.max(0, -before), Math.max(0, -after));
        } else if (!profit && est.rows.some(x => x.kind === 'net' && x.section === r.section && /PROFIT|RETURNS|INCOME/.test(x.label))) {
          row.cells[c.key] = deltaTotal(original, Math.max(0, before), Math.max(0, after));
        } else row.cells[c.key] = deltaTotal(original, profit ? -before : before, profit ? -after : after);
      } else {
        let group = sectionDetails;
        if (totalKey === 'operating') group = details.filter(d => d.kind === 'operation' || d.kind === 'interest');
        if (totalKey === 'cashOh') group = details.filter(isCash);
        if (totalKey === 'noncash') group = details.filter(isNoncash);
        if (totalKey === 'cash') group = ['operating', 'cashOh'].flatMap(key => totals.get(key) ? [totals.get(key)!] : []);
        if (totalKey === 'total') group = ['cash', 'noncash'].flatMap(key => totals.get(key) ? [totals.get(key)!] : []);
        const before = sum(group, c.key, 'original'), after = sum(group, c.key, 'repriced');
        row.cells[c.key] = deltaTotal(original, before, after);
        const residual = original == null ? 0 : original - before;
        if (residual) row.cells[c.key].note = `Printed total differs from its parsed components by $${residual.toLocaleString('en-US')}; this difference is retained without indexing.`;
        if (Math.abs(residual) > Math.max(3, Math.abs(original ?? 0) * 0.02)) notes.add(`${r.label}, ${c.label}: printed total differs from its parsed components by $${residual.toLocaleString('en-US')}.`);
      }
    });
    if (totalKey) totals.set(totalKey, row);
    if (kind === 'operation' || kind === 'overheadItem' || kind === 'interest') { details.push(row); sectionDetails.push(row); }
    rows.push(row);
  });
  const estTotal = establishmentSummaryOf(study).total;
  const establishmentNote = estTotal ? `Establishment cost total: ${dollars(estTotal.value)} per acre in the study, ${establishmentSource(estTotal)}.` : null;
  notes.add('Establishment costs are repriced row by row from the establishment table, each row with the index for its category.');
  const last = cols.find(c => c.key === settings.summaryColumn) ?? cols.at(-1)!;
  const totalRow = totals.get('total') ?? totals.get('cash');
  return {
    studyId: study.source.id, title: est.title, layout: 'establishment', columns: cols, rows,
    referencePeriod: ref, targetPeriod: target, notes: [...notes], establishmentNote, yieldRow: est.yieldRow && { ...est.yieldRow, label: settings.pricePerUnit != null ? est.yieldRow.label.replace(/\$[\d,.]+/, `$${settings.pricePerUnit.toFixed(2)}`) : est.yieldRow.label }, summaryColumn: last.label,
    summary: summarize(details, totalRow?.cells[last.key]?.original ?? null, totalRow?.cells[last.key]?.repriced ?? null, totals.get('cash')?.cells[last.key]?.repriced ?? null),
  };
}

function summarize(rows: RepricedRow[], totalOrig: number | null, totalRep: number | null, cashRep: number | null): RepricedTable['summary'] {
  const byCat = new Map<string, { category: Category; orig: number; series: string }>();
  let all = 0;
  for (const r of rows) {
    if (r.kind !== 'operation' && r.kind !== 'overheadItem' && r.kind !== 'interest') continue;
    for (const [k, c] of Object.entries(r.cells)) {
      if (k === 'total' && Object.keys(r.cells).length > 1) continue;
      if (!c.category || !c.original) continue;
      const key = `${c.category}:${c.seriesId ?? ''}`;
      const cur = byCat.get(key) ?? { category: c.category, orig: 0, series: c.seriesId ?? '' };
      cur.orig += c.original; if (!cur.series && c.seriesId) cur.series = c.seriesId; byCat.set(key, cur); all += c.original;
    }
  }
  const coverage = [...byCat.values()].map(v => ({ category: v.category, share: all ? v.orig / all : 0, seriesId: v.series })).sort((a, b) => b.share - a.share);
  const cpiShare = coverage.filter(c => c.seriesId === 'bls.cpi').reduce((s, c) => s + c.share, 0);
  const { pricedRows, fallbackRows } = fallbackCount(rows);
  return { totalPerAcreOriginal: round(totalOrig), totalPerAcreRepriced: round(totalRep), cashPerAcreRepriced: round(cashRep), coverage, cpiShare, pricedRows, fallbackRows };
}

/** True when an amount on this row was priced by the CPI fallback because no specific index matched its label. */
export const usesFallback = (row: RepricedRow) => Object.values(row.cells).some(c => c.fallback && !!c.original && !c.overridden);

/** Rows with an indexed amount, and how many of them fell to the CPI fallback. */
export function fallbackCount(rows: RepricedRow[]): { pricedRows: number; fallbackRows: number } {
  const priced = rows.filter(r => (r.kind === 'operation' || r.kind === 'overheadItem') && Object.values(r.cells).some(c => !!c.original && c.seriesId));
  return { pricedRows: priced.length, fallbackRows: priced.filter(usesFallback).length };
}
