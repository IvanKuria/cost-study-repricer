import type { EstablishmentSource, EstablishmentSummary, EstablishmentTable, OperationRow, ParsedStudy } from '../data/studySchema';
import type { Category, CategoryMapping, RepriceSettings, RepricedCell, RepricedRow, RepricedTable, Series } from './types';
import { classifyRow, impliedInterest, rowCategory, type CellClass } from './classify';
import { DEFAULT_MAPPING, REPAIRS_SERIES_ID, SEEDS_SERIES_ID } from '../data/mapping';
import { SERIES, latestPeriod, periodKey, ratio, seriesById } from './series';
import { crf } from './crf';

export const DEFAULT_SETTINGS: RepriceSettings = { targetPeriod: '', referenceMonth: 6, interestRate: null, capitalRecoveryRate: null, overrides: {}, mapping: DEFAULT_MAPPING };

/** Prefer the establishment table's stated price over the production assumptions. Never invent a missing price. */
export function studySalePrice(study: ParsedStudy | null): number | null {
  if (!study) return null;
  const printed = study.establishment?.table?.yieldRow?.label.match(/\$\s*(\d[\d,]*(?:\.\d+)?)/);
  const value = printed ? Number(printed[1].replace(/,/g, '')) : study.assumptions.pricePerUnit?.value;
  return value != null && Number.isFinite(value) && value >= 0 ? value : null;
}

/** Return line edits live in `settings.overrides` as `ret-<index>:price`, `ret-<index>:quantity` and `ret-<index>:total`. */
export const returnKey = (index: number, field: 'price' | 'quantity' | 'total') => `ret-${index}:${field}`;
/** True for override keys that edit gross returns in the production table (return lines, or the single gross row). */
export const isReturnKey = (key: string) => /^ret-\d+:(price|quantity|total)$/.test(key) || key === 'gross:total' || key === 'gross';

const UNIT_WORDS: [RegExp, string][] = [
  [/^(lb|lbs|pound|pounds)$/, 'lb'], [/^(ton|tons)$/, 'ton'], [/^(box|boxes|bx)$/, 'box'], [/^(carton|cartons|ctn|ctns|crtn|crtns)$/, 'carton'],
  [/^(tray|trays)$/, 'tray'], [/^(cwt|cwts)$/, 'cwt'], [/^(gal|gals|gallon|gallons)$/, 'gal'], [/^(bin|bins)$/, 'bin'], [/^(bale|bales)$/, 'bale'], [/^(bushel|bushels|bu)$/, 'bushel'],
];
const unitWord = (word: string | null | undefined) => {
  const w = (word ?? '').toLowerCase().replace(/[^a-z]/g, '');
  return UNIT_WORDS.find(([re]) => re.test(w))?.[1] ?? null;
};
/** The unit the establishment table's yield row counts in, read from its label ("Meat Pounds Per Acre" is lb, "Cartons/Acre" is carton). */
function yieldUnit(study: ParsedStudy): string | null {
  const label = study.establishment?.table?.yieldRow?.label ?? '';
  const before = label.match(/([A-Za-z]+)\s*(?:per|\/)\s*acre/i)?.[1];
  // otherwise the last unit word is the counted thing: "28 Pound Boxes" counts boxes
  return unitWord(before) ?? label.split(/[^A-Za-z]+/).map(unitWord).filter(Boolean).pop() ?? null;
}

/** The study's main crop line: the first return line whose unit matches the establishment yield unit; the first line when
 *  there is no establishment yield to share with. -1 when the study prints no lines, or when the establishment yield is
 *  counted in a unit no line uses (olive oil priced per gallon against a yield in tons): a price per gallon times tons is
 *  meaningless, so the two views keep separate prices. */
export function mainReturnIndex(study: ParsedStudy): number {
  const lines = study.assumptions.returns ?? [];
  if (!lines.length) return -1;
  if (!study.establishment?.table?.yieldRow) return 0;
  const unit = yieldUnit(study);
  return unit ? lines.findIndex(l => unitWord(l.unit) === unit) : -1;
}

/** One sale price shared by the main crop line in the production table and the establishment years' income (yield x price).
 *  The lender's edit of the main line's price wins; `pricePerUnit` is the same price set from the establishment view. Null when unedited. */
export function sharedSalePrice(study: ParsedStudy, settings: Pick<RepriceSettings, 'overrides' | 'pricePerUnit'>): number | null {
  const main = mainReturnIndex(study);
  const edit = main >= 0 ? settings.overrides?.[returnKey(main, 'price')] : undefined;
  const v = edit !== undefined ? edit : settings.pricePerUnit;
  return v != null && Number.isFinite(v) ? v : null;
}

const money2 = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
function sharedPriceNote(study: ParsedStudy, price: number): string {
  const main = mainReturnIndex(study);
  const line = study.assumptions.returns?.[main];
  if (!line) return `Sale price: your price of ${money2(price)} per unit is used for income in the establishment years (each printed yield x price).`;
  const units = unitWord(line.unit) && yieldUnit(study) && unitWord(line.unit) !== yieldUnit(study) ? ` The return line is priced per ${line.unit} and the establishment yield is counted in ${yieldUnit(study)}; check that the price fits both.` : '';
  return `Shared sale price: your price of ${money2(price)} per ${line.unit} for "${line.name}" (study: ${money2(line.price)}) is used for that return line in mature production and for income in the establishment years (each printed yield x price). Income lowers the accumulated net cash cost, which is the basis of the recalculated yearly establishment charge.${units}`;
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
const pct = (rate: number) => `${Number((rate * 100).toFixed(3))}%`;
export const NOT_REPRODUCED_NOTE = 'Establishment yearly charge: the study\'s printed charge could not be reproduced from its stated rate and years, so it is adjusted by the CPI instead.';

/** The repriced establishment cost the yearly charge is recalculated from, and the same figure in study dollars. */
interface EstablishmentBasis { original: number; repriced: number; words: string }
/** The UC capital recovery inputs, ready to recalculate the yearly establishment charge, insurance and taxes. */
interface EstablishmentRecalc { basis: EstablishmentBasis; rate: number; years: number; lenderRate: boolean }

/** Tier 1: the accumulated net cash cost at the study's amortization year, from the repriced establishment table.
 *  Tier 2: the repriced printed establishment total (including any lender edit). Null when neither is available. */
function establishmentBasis(study: ParsedStudy, settings: RepriceSettings, ref: string, target: string, F: (c: CellClass) => Factor, totalRow: RepricedRow | null): EstablishmentBasis | null {
  const est = study.establishment?.table;
  if (est && hasUsableTable(study)) {
    const by = establishmentSummaryOf(study).basisYear;
    if (!by || by.index < 0 || by.index >= est.years.length) return null;
    const i = est.rows.findIndex(r => r.kind === 'accumulated' && /CASH/i.test(r.label));
    if (i < 0) return null;
    const t = establishmentLayout(study, est, { ...settings, layout: 'establishment' }, ref, target, F);
    const cell = t.rows.find(r => r.id === `e-${i}`)?.cells[`y${by.index + 1}`];
    if (cell?.original == null || cell.repriced == null) return null;
    return { original: cell.original, repriced: cell.repriced, words: `repriced establishment cost (year ${by.index + 1})` };
  }
  const c = totalRow?.cells.total;
  if (c?.original == null || c.repriced == null) return null;
  return { original: c.original, repriced: c.repriced, words: 'repriced establishment cost (printed total)' };
}

function establishmentRecalc(study: ParsedStudy, settings: RepriceSettings, ref: string, target: string, F: (c: CellClass) => Factor, totalRow: RepricedRow | null): EstablishmentRecalc | null {
  const cr = establishmentSummaryOf(study).capitalRecovery;
  if (!cr?.reproduces || !(cr.years.value > 0)) return null;
  const basis = establishmentBasis(study, settings, ref, target, F, totalRow);
  if (!basis) return null;
  const lenderRate = settings.capitalRecoveryRate != null && Number.isFinite(settings.capitalRecoveryRate);
  return { basis, rate: lenderRate ? settings.capitalRecoveryRate! : cr.ratePct.value / 100, years: cr.years.value, lenderRate };
}

/** The yearly establishment charge the UC way: basis x CRF(rate, years), salvage 0. */
function recalculatedCharge(r: EstablishmentRecalc): { value: number; note: string } {
  const basis = Math.max(0, r.basis.repriced);
  const value = basis * crf(r.rate, r.years);
  const clamp = r.basis.repriced < 0 ? ` The ${r.basis.words} is below zero, so it counts as $0.` : '';
  return { value, note: `Recalculated: ${dollars(basis)} ${r.basis.words} x CRF(${pct(r.rate)}${r.lenderRate ? ', lender rate' : ''}, ${r.years} years) = ${dollars(value)}.${clamp}` };
}

/** Insurance or property tax on the establishment investment: rate x average investment (basis / 2, salvage 0), or the
 *  study's per-acre amount scaled by the change in the basis when the rate is missing or does not reproduce it. */
function recalculatedInvestmentCharge(r: EstablishmentRecalc, share: number, ratePct: number | null, what: string): { value: number; note: string } | null {
  const basis = Math.max(0, r.basis.repriced);
  const byRate = ratePct != null ? ratePct / 100 * r.basis.original / 2 : null;
  if (ratePct != null && byRate != null && Math.abs(byRate - share) <= Math.max(1, share * 0.02)) {
    const value = ratePct / 100 * basis / 2;
    return { value, note: `Recalculated: ${pct(ratePct / 100)} ${what} rate x ${dollars(basis)} ${r.basis.words} / 2 average investment = ${dollars(value)}.` };
  }
  if (!(r.basis.original > 0)) return null;
  const value = share * basis / r.basis.original;
  return { value, note: `Recalculated: ${dollars(share)} study ${what} on establishment x (${dollars(basis)} ${r.basis.words} / ${dollars(r.basis.original)} in the study) = ${dollars(value)}.` };
}

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
  // No readable operation rows (the table is an image in the PDF) but a printed operating total: reprice that one
  // figure with the CPI fallback, flagged like any other fallback row. It already includes the study's interest.
  const printedOperating = study.costsPerAcre.operatingTotal;
  if (!ops.length && printedOperating) {
    const cls: CellClass = { category: 'otherMaterials', confidence: 'fallback' };
    const row: RepricedRow = { id: 'op-printed', label: 'Operating costs, printed total (rows not readable in the study)', kind: 'operation', section: 'Operating', timeHrs: null, cells: { total: cellFrom(printedOperating.value, cls, F(cls)) }, page: printedOperating.page, quote: printedOperating.quote };
    applyOverride(row, 'total', settings);
    opRows.push(row);
    rows.push(row);
  }
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

  // The professor's rule: establishment is repriced with the CPI, not the machinery index. When the study's capital
  // recovery inputs reproduce its printed yearly charge, that charge and the insurance and taxes on the establishment
  // investment are recalculated from the repriced establishment cost instead.
  const estCls: CellClass = { category: 'establishmentCpi', confidence: 'column' };
  const estSummary = establishmentSummaryOf(study);
  const charge = estSummary.annualCharge;
  const notes: string[] = [];
  const estTotal = estSummary.total;
  let estTotalRow: RepricedRow | null = null;
  if (estTotal && !hasUsableTable(study)) {
    estTotalRow = {
      id: 'establishment-total', label: 'Establishment cost per acre, accumulated (CPI)', kind: 'overheadItem', section: 'Establishment', timeHrs: null,
      cells: { total: { ...cellFrom(estTotal.value, estCls, F(estCls)), note: 'One-time investment, not added to the yearly total cost.' } },
      page: estTotal.page, quote: estTotal.quote,
    };
    applyOverride(estTotalRow, 'total', settings);
  }
  const recalc = establishmentRecalc(study, settings, ref, target, F, estTotalRow);
  if (estSummary.capitalRecovery && !estSummary.capitalRecovery.reproduces) notes.push(NOT_REPRODUCED_NOTE);
  /** A row whose value is recalculated rather than indexed. The study's printed figure stays as the original; lender edits still apply. */
  const recalcRow = (row: RepricedRow, original: number, calc: { value: number; note: string }) => {
    row.cells = { total: { ...plainCell(original, calc.value), note: calc.note, recalculated: true } };
    row.sourceNote = calc.note;
    applyOverride(row, 'total', settings);
    notes.push(`${row.label}: ${calc.note}`);
    return row;
  };

  // Cash overhead items.
  rows.push({ id: 'h-cash', label: 'CASH OVERHEAD', kind: 'heading', section: 'Cash overhead', timeHrs: null, cells: {}, page: null, quote: null });
  const ohCls: CellClass = { category: 'cashOverhead', confidence: 'column' };
  const items = study.costsPerAcre.cashOverheadItems;
  const ic = recalc ? estSummary.investmentCharges : null;
  // Property insurance and property taxes lines aggregate every investment; the establishment share is split out of each.
  const pickLine = (test: (d: string) => boolean) => {
    const matches = items.map((it, i) => ({ it, i })).filter(x => test(x.it.description));
    return (matches.find(x => /property/i.test(x.it.description)) ?? matches[0])?.i ?? -1;
  };
  const shares = ic ? ([
    { what: 'insurance', label: 'Property insurance', share: ic.insurance, ratePct: ic.insuranceRatePct, line: pickLine(d => /insurance/i.test(d) && !/liability|crop|worker|health|auto|vehicle|umbrella/i.test(d)) },
    { what: 'property tax', label: 'Property taxes', share: ic.taxes, ratePct: ic.taxRatePct, line: pickLine(d => /\btax/i.test(d) && !/payroll|income|sales/i.test(d)) },
  ]).filter(x => x.share > 0) : [];
  const estShareRow = (id: string, label: string, x: typeof shares[number]): RepricedRow | null => {
    const calc = recalculatedInvestmentCharge(recalc!, x.share, x.ratePct, x.what);
    if (!calc) return null;
    return recalcRow({ id, label, kind: 'overheadItem', section: 'Cash overhead', timeHrs: null, cells: {}, page: ic!.page, quote: ic!.quote }, x.share, calc);
  };
  const ohRows: RepricedRow[] = items.flatMap((it, i) => {
    const x = shares.find(s => s.line === i && it.value >= s.share - 0.5);
    const rest = x ? it.value - x.share : it.value;
    const row: RepricedRow = { id: `oh-${i}`, label: x ? `${it.description}, other investments` : it.description, kind: 'overheadItem', section: 'Cash overhead', timeHrs: null, cells: { total: cellFrom(rest, ohCls, F(ohCls)) }, page: it.page, quote: it.quote };
    if (x) row.sourceNote = `The study's ${dollars(it.value)} less the establishment share of ${dollars(x.share)}, repriced with the CPI.`;
    applyOverride(row, 'total', settings);
    const est = x ? estShareRow(`oh-${i}-establishment`, `${it.description}, establishment share`, x) : null;
    if (x && !est) { row.label = it.description; row.sourceNote = null; row.cells = { total: cellFrom(it.value, ohCls, F(ohCls)) }; applyOverride(row, 'total', settings); }
    if (est) x!.line = -2; // handled
    return est ? [row, est] : [row];
  });
  const cashOhOrig = study.costsPerAcre.cashOverheadTotal?.value ?? ohRows.reduce((s, r) => s + (r.cells.total.original ?? 0), 0);
  let itemsOrig = ohRows.reduce((s, r) => s + (r.cells.total.original ?? 0), 0);
  // No matching overhead line: the establishment shares become their own rows only when the printed total still reconciles.
  const unmatched = shares.filter(x => x.line !== -2);
  if (unmatched.length) {
    const need = unmatched.reduce((s, x) => s + x.share, 0);
    const fits = cashOhOrig - itemsOrig >= need - 0.5 && unmatched.every(x => recalculatedInvestmentCharge(recalc!, x.share, x.ratePct, x.what));
    if (fits) { unmatched.forEach((x, k) => ohRows.push(estShareRow(`oh-establishment-${k}`, `${x.label} on establishment`, x)!)); itemsOrig += need; }
    else notes.push(`The study's ${unmatched.map(x => `${x.what} on the establishment investment (${dollars(x.share)} per acre)`).join(' and ')}, page ${ic!.page}, could not be matched to a cash overhead line without changing the printed cash overhead total, so ${unmatched.length > 1 ? 'they are' : 'it is'} not recalculated.`);
  }
  rows.push(...ohRows);
  // If the printed total exceeds the parsed items, the remainder is carried as an unparsed line so totals still match the study.
  if (cashOhOrig - itemsOrig > 1) {
    const row: RepricedRow = { id: 'oh-rest', label: 'Other cash overhead (not itemized in the parsed table)', kind: 'overheadItem', section: 'Cash overhead', timeHrs: null, cells: { total: cellFrom(cashOhOrig - itemsOrig, ohCls, F(ohCls)) }, page: null, quote: null };
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
  const ncRow = (id: string, label: string, value: number, cls: CellClass, page: number | null, quote: string | null): RepricedRow => {
    const row: RepricedRow = { id, label, kind: 'overheadItem', section: 'Non-cash overhead', timeHrs: null, cells: { total: cellFrom(value, cls, F(cls)) }, page, quote };
    if (cls === estCls && recalc) recalcRow(row, value, recalculatedCharge(recalc));
    else applyOverride(row, 'total', settings);
    ncRows.push(row); return row;
  };
  const chargeHow = recalc ? 'is recalculated from the repriced establishment cost with the study\'s capital recovery factor' : 'is repriced with the CPI (BLS CPI-U, all items)';
  if (ncItems && ncItems.length) {
    ncItems.forEach((it, i) => ncRow(`nc-${i}`, it.description, it.value, /establish/i.test(it.description) ? estCls : ncCls, it.page, it.quote));
    if (ncItems.some(it => /establish/i.test(it.description))) notes.push(`The establishment line in non-cash overhead ${chargeHow}; the other non-cash overhead lines use the machinery index.`);
  } else if (study.costsPerAcre.nonCashOverheadTotal) {
    const t = study.costsPerAcre.nonCashOverheadTotal;
    if (charge && charge.value > 0 && charge.value < t.value) {
      ncRow('nc-0', 'Capital recovery, insurance and taxes on equipment and other investments (printed total less the establishment charge)', t.value - charge.value, ncCls, t.page, t.quote);
      ncRow('nc-establishment', recalc ? 'Establishment cost, yearly charge (recalculated)' : 'Establishment cost, yearly charge (CPI)', charge.value, estCls, charge.page, charge.quote);
      notes.push(`The study's non-cash overhead total of ${dollars(t.value)} (page ${t.page}) includes a yearly establishment charge of ${dollars(charge.value)} (page ${charge.page}). That charge ${chargeHow}; the remaining ${dollars(t.value - charge.value)} uses the machinery index.`);
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

  // Returns are the study's and are never indexed; the lender changes them by override. When the study prints return
  // lines (crop plus byproducts), each line is its own row and GROSS RETURNS/ACRE is their subtotal: the printed gross
  // plus the change in the lines, so an unedited study shows exactly its printed figures. A study that prints no lines
  // keeps the single editable gross row, empty when the study prints no per-acre gross returns.
  const gross = study.costsPerAcre.grossReturns;
  const lines = study.assumptions.returns ?? [];
  let gr: RepricedRow;
  let grossOrig: number | null;
  if (lines.length) {
    const main = mainReturnIndex(study);
    const shared = sharedSalePrice(study, settings);
    const lineRows = lines.map((l, i): RepricedRow => {
      const id = `ret-${i}`;
      const ov = (f: 'price' | 'quantity' | 'total') => { const v = settings.overrides[returnKey(i, f)]; return v !== undefined && Number.isFinite(v) ? v : undefined; };
      const priceEdit = ov('price') ?? (i === main && shared != null ? shared : undefined);
      const qtyEdit = ov('quantity');
      const totalEdit = ov('total');
      const q = qtyEdit ?? l.quantity ?? null, p = priceEdit ?? l.price ?? null;
      const computed = l.quantity != null && l.price != null ? l.quantity * l.price : null;
      const mismatch = computed != null && Math.abs(computed - l.value) > 1 ? computed - l.value : null;
      const lineNotes: string[] = [];
      if (mismatch != null) lineNotes.push(`The study prints ${dollars(l.value)} for this line; its quantity x price gives ${dollars(computed!)}. The printed value is kept until you change the price or quantity.`);
      let value = l.value;
      if (totalEdit !== undefined) { value = totalEdit; lineNotes.push('Your value replaces quantity x price for this line.'); }
      else if ((priceEdit !== undefined || qtyEdit !== undefined) && q != null && p != null) { value = q * p; lineNotes.push(`${q.toLocaleString('en-US')} ${l.unit} x ${money2(p)} = ${dollars(value)}.`); }
      if (i === main && shared != null && ov('price') === undefined && totalEdit === undefined) lineNotes.push('Uses the sale price you entered for the establishment years.');
      const edited = totalEdit !== undefined || priceEdit !== undefined || qtyEdit !== undefined;
      return {
        id, label: l.name, kind: 'returns', section: 'Returns', timeHrs: null, page: l.page ?? null, quote: l.quote ?? null,
        sourceNote: mismatch != null ? lineNotes[0] : null,
        cells: { total: { ...plainCell(l.value, value), factor: null, overridden: edited, note: ['Returns are not indexed.', ...lineNotes].join(' ') } },
        returnLine: {
          unit: l.unit, main: i === main && !!study.establishment?.table?.yieldRow,
          quantity: { original: l.quantity ?? null, current: totalEdit !== undefined ? l.quantity ?? null : q, edited: qtyEdit !== undefined && totalEdit === undefined },
          price: { original: l.price ?? null, current: totalEdit !== undefined ? l.price ?? null : p, edited: priceEdit !== undefined && totalEdit === undefined },
          valueEdited: totalEdit !== undefined, mismatch,
        },
      };
    });
    rows.push({ id: 'h-returns', label: 'GROSS RETURNS', kind: 'heading', section: 'Returns', timeHrs: null, cells: {}, page: null, quote: null });
    rows.push(...lineRows);
    const sumOrig = lines.reduce((s, l) => s + l.value, 0);
    grossOrig = gross?.value ?? sumOrig;
    const delta = lineRows.reduce((s, r) => s + (r.cells.total.repriced ?? 0) - (r.cells.total.original ?? 0), 0);
    const residual = grossOrig - sumOrig;
    const grossNote = ['Sum of the return lines. Returns are not indexed.', Math.abs(residual) > 0.5 ? `The printed gross returns differ from the sum of the lines by ${dollars(residual)}; that difference is kept.` : ''].filter(Boolean).join(' ');
    gr = { id: 'gross', label: 'GROSS RETURNS/ACRE', kind: 'subtotal', section: 'Returns', timeHrs: null, cells: { total: { ...plainCell(grossOrig, grossOrig + delta), factor: null, note: grossNote } }, page: gross?.page ?? null, quote: gross?.quote ?? null };
    // A 'gross:total' override (from an older link, made before return lines were shown) still replaces the subtotal,
    // so the old link reproduces the same net returns. The lines keep their own values; the note says the subtotal is the lender's.
    applyOverride(gr, 'total', settings);
    if (gr.cells.total.overridden) gr.cells.total.note = 'Your gross returns figure replaces the sum of the return lines. Reset edits to use the lines again.';
    if (shared != null && main >= 0 && study.establishment?.table?.yieldRow) notes.push(sharedPriceNote(study, shared));
  } else {
    grossOrig = gross?.value ?? null;
    const grossNote = grossOrig == null
      ? 'The study prints no per-acre gross returns. Type a value to compute net returns.'
      : 'Returns are not indexed. Type a value to update.';
    gr = { id: 'gross', label: 'GROSS RETURNS/ACRE', kind: 'returns', section: 'Returns', timeHrs: null, cells: { total: { ...plainCell(grossOrig, grossOrig), note: grossNote } }, page: gross?.page ?? null, quote: gross?.quote ?? null };
    applyOverride(gr, 'total', settings);
  }
  rows.push(gr);
  const g = gr.cells.total.repriced;
  const net = (cost: number | null | undefined, costRep: number | null | undefined) => plainCell(grossOrig == null ? null : grossOrig - (cost ?? 0), g == null ? null : g - (costRep ?? 0));
  rows.push({ id: 'net-operating', label: 'NET RETURNS ABOVE OPERATING COSTS', kind: 'net', section: 'Returns', timeHrs: null, cells: { total: net(totalOperating.cells.total.original, totalOperating.cells.total.repriced) }, page: null, quote: null });
  rows.push({ id: 'net-total', label: 'NET RETURNS ABOVE TOTAL COSTS', kind: 'net', section: 'Returns', timeHrs: null, cells: { total: net(totalOrig, totalRep) }, page: null, quote: null });

  // Establishment cost when the study prints a figure but no usable table (tier 2): repriced by CPI, shown apart, never added to the yearly totals.
  let establishmentNote: string | null = null;
  if (estTotal && estTotalRow) {
    const yearly = charge ? ' The yearly establishment charge in non-cash overhead already is.' : '';
    rows.push({ id: 'h-establishment', label: 'ESTABLISHMENT COST (ONE-TIME INVESTMENT)', kind: 'heading', section: 'Establishment', timeHrs: null, cells: {}, page: null, quote: null });
    estTotalRow.sourceNote = `${establishmentSource(estTotal)[0].toUpperCase()}${establishmentSource(estTotal).slice(1)}. One-time investment, not added to the yearly total cost.${yearly}`;
    rows.push(estTotalRow);
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
  // One sale price for the establishment years and the main return line of the production table.
  const salePrice = sharedSalePrice(study, settings);
  if (salePrice != null && est.yieldRow) notes.add(sharedPriceNote(study, salePrice));
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
          const rep = salePrice != null && yieldValue != null ? yieldValue * salePrice : original;
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
    referencePeriod: ref, targetPeriod: target, notes: [...notes], establishmentNote, yieldRow: est.yieldRow && { ...est.yieldRow, label: salePrice != null ? est.yieldRow.label.replace(/\$[\d,.]+/, `$${salePrice.toFixed(2)}`) : est.yieldRow.label }, summaryColumn: last.label,
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
