import type { OperationRow, ParsedStudy } from '../data/studySchema';
import type { Category } from './types';

export type Confidence = 'column' | 'keyword' | 'fallback';
export interface CellClass { category: Category; confidence: Confidence; part?: 'fuel' | 'repairs' | 'seeds' }

const has = (s: string, words: string[]) => { const n = s.toLowerCase(); return words.some(w => n.includes(w)); };

const FERTILIZER = ['fertiliz', 'fertigat', 'nitrogen', 'urea', 'un-32', 'un32', 'uan', 'can-17', 'can17', 'compost', 'manure', 'gypsum', 'potash', 'potassium', 'k2so4', 'phosph', 'zinc', 'boron', 'foliar', 'nutrient', 'lime', 'sulfur', 'sulphur', 'micronutrient', 'ammoni', 'calcium nitrate'];
const PESTICIDES = ['spray', 'fungicid', 'insecticid', 'herbicid', 'miticid', 'nematicid', 'fumig', 'weed', 'pest', 'mite', 'aphid', 'worm', 'botrytis', 'mildew', 'disease', 'insect', 'rodent', 'gopher', 'squirrel', 'vole', 'bait', 'now ', 'mating disruption', 'leafhopper', 'thrip', 'lygus', 'scale', 'bloom spray', 'dormant spray', 'dormant oil', 'defoliat', 'growth regulator', 'gibberellin', 'ethephon', 'biological', 'persimilis', 'predatory', 'sanitation'];
const WATER = ['irrigat', 'water', 'pump', 'well ', 'sprinkler', 'flush'];
const POLLINATION = ['pollinat', 'bee', 'hive'];
const SEEDS = ['seed', 'plant', 'transplant', 'tree', 'vine', 'rootstock', 'cutting', 'replant', 'nursery', 'crown', 'tuber', 'bulb', 'clove'];
const PCA = ['pca', 'cca', 'consult', 'advisor', 'fee'];

const firstIndex = (s: string, words: string[]) => { const n = s.toLowerCase(); const hits = words.map(w => n.indexOf(w)).filter(i => i >= 0); return hits.length ? Math.min(...hits) : Infinity; };

/**
 * Category of the materials column of one row, from the words in its label. A row that names several
 * jobs ("Insects/Disease (SI)/Fertilize: Zn") goes to the job named first, which is how the studies
 * order a tank mix by its main purpose.
 */
export function materialsCategory(label: string): CellClass {
  const candidates: [Category, string[], CellClass['part']][] = [['pollination', POLLINATION, undefined], ['fertilizer', FERTILIZER, undefined], ['pesticides', PESTICIDES, undefined], ['water', WATER, undefined], ['otherMaterials', SEEDS, 'seeds']];
  let best: { cat: Category; idx: number; part?: CellClass['part'] } | null = null;
  for (const [cat, words, part] of candidates) { const i = firstIndex(label, words); if (i < (best?.idx ?? Infinity)) best = { cat, idx: i, part }; }
  if (best) return { category: best.cat, confidence: 'keyword', ...(best.part ? { part: best.part } : {}) };
  return { category: 'otherMaterials', confidence: 'fallback' };
}

/** Category of the custom or rent column: pollination hives, assessments and advisor fees are not contracted field work. */
export function customCategory(row: Pick<OperationRow, 'name' | 'category'>): CellClass {
  if (has(row.name, POLLINATION)) return { category: 'pollination', confidence: 'keyword' };
  if (row.category === 'assessment' || has(row.name, ['assessment', 'assess'])) return { category: 'otherMaterials', confidence: 'keyword' };
  if (has(row.name, PCA)) return { category: 'custom', confidence: 'keyword' };
  return { category: 'custom', confidence: 'column' };
}

/** The category of every dollar column of one Table 1 row. */
export function classifyRow(row: OperationRow): { labor: CellClass; fuel: CellClass; lubeRepairs: CellClass; materials: CellClass; customRent: CellClass } {
  return {
    labor: { category: 'labor', confidence: 'column' },
    fuel: { category: 'fuelLubeRepairs', confidence: 'column', part: 'fuel' },
    lubeRepairs: { category: 'fuelLubeRepairs', confidence: 'column', part: 'repairs' },
    materials: materialsCategory(row.name),
    customRent: customCategory(row),
  };
}

/** A whole establishment-table row (one number per year, not split by column) gets one category from its label. */
export function rowCategory(label: string, section: string): CellClass {
  const s = (section || '').toLowerCase();
  if (s.includes('non-cash') || s.includes('noncash')) return { category: 'nonCashOverhead', confidence: 'column' };
  if (s.includes('cash overhead')) return { category: 'cashOverhead', confidence: 'column' };
  if (has(label, ['interest on operating'])) return { category: 'operatingInterest', confidence: 'column' };
  if (has(label, POLLINATION)) return { category: 'pollination', confidence: 'keyword' };
  if (has(label, FERTILIZER)) return { category: 'fertilizer', confidence: 'keyword' };
  if (has(label, PESTICIDES)) return { category: 'pesticides', confidence: 'keyword' };
  if (has(label, WATER)) return { category: 'water', confidence: 'keyword' };
  if (has(label, ['custom', 'contract', 'hire', 'rent', 'haul', 'harvest'])) return { category: 'custom', confidence: 'keyword' };
  if (has(label, ['prune', 'hand', 'labor', 'thin', 'sucker', 'train', 'tie', 'hoe'])) return { category: 'labor', confidence: 'keyword' };
  if (has(label, SEEDS)) return { category: 'otherMaterials', confidence: 'keyword', part: 'seeds' };
  return { category: 'otherMaterials', confidence: 'fallback' };
}

export type CategoryTotals = Record<Category, number>;
export const emptyTotals = (): CategoryTotals => ({ labor: 0, pesticides: 0, fertilizer: 0, water: 0, pollination: 0, custom: 0, otherMaterials: 0, fuelLubeRepairs: 0, operatingInterest: 0, cashOverhead: 0, nonCashOverhead: 0 });

/** Interest on operating capital is not a parsed row: it is the printed operating total less the operation rows, when that gap is plausible. */
export function impliedInterest(study: ParsedStudy): { value: number; note: string } | null {
  const ops = study.costsPerAcre.operations;
  const total = study.costsPerAcre.operatingTotal?.value;
  if (!total || ops.length === 0) return null;
  const rows = ops.reduce((s, o) => s + (o.totalCost ?? 0), 0);
  const gap = total - rows;
  if (gap < 0 || gap > total * 0.15) return null;
  return { value: Math.round(gap), note: `Printed total operating costs ${total} less the ${ops.length} operation rows (${Math.round(rows)}).` };
}

/** Per-category totals per acre for a production study, comparable with the professor's Budgets worksheet. */
export function classifyStudy(study: ParsedStudy): { totals: CategoryTotals; total: number; interestNote: string | null } {
  const t = emptyTotals();
  for (const o of study.costsPerAcre.operations) {
    const c = classifyRow(o);
    t.labor += o.labor ?? 0;
    t.fuelLubeRepairs += (o.fuel ?? 0) + (o.lubeRepairs ?? 0);
    t[c.materials.category] += o.materials ?? 0;
    t[c.customRent.category] += o.customRent ?? 0;
  }
  const interest = impliedInterest(study);
  t.operatingInterest = interest?.value ?? 0;
  t.cashOverhead = study.costsPerAcre.cashOverheadTotal?.value ?? study.costsPerAcre.cashOverheadItems.reduce((s, i) => s + i.value, 0);
  t.nonCashOverhead = study.costsPerAcre.nonCashOverheadTotal?.value ?? 0;
  const total = Object.values(t).reduce((a, b) => a + b, 0);
  return { totals: t, total, interestNote: interest?.note ?? null };
}
