import type { CategoryMapping } from '../lib/types';

/**
 * Which price series reprices which cost category. "his" marks the professor's instruction from the
 * project notes and his Budgets worksheet; "ours" marks a choice made here that he has not confirmed.
 */
export const DEFAULT_MAPPING: CategoryMapping[] = [
  { category: 'labor', seriesId: 'nass.labor', note: 'his: USDA labor wage-rate index.' },
  { category: 'pesticides', seriesId: 'nass.chemicals', note: 'his: USDA chemical totals index (published quarterly; the nearest earlier quarter is used).' },
  { category: 'fertilizer', seriesId: 'nass.fertilizer', note: 'his: USDA fertilizer totals index.' },
  { category: 'fuelLubeRepairs', seriesId: 'nass.fuels', fallbackSeriesId: 'nass.repairs', note: 'his: USDA fuels index for fuel. ours: when a study prints lube and repairs separately, that part uses the USDA repairs index; a combined fuel-lube-repairs column uses fuels.' },
  { category: 'nonCashOverhead', seriesId: 'nass.machinery', fallbackSeriesId: 'bls.cpi', note: 'user instruction: USDA machinery totals index. The professor\'s worksheet used CPI for this line; CPI is the fallback when machinery is unavailable.' },
  { category: 'custom', seriesId: 'nass.agServices', fallbackSeriesId: 'bls.cpi', note: 'ours: USDA ag services and rent index, falling back to CPI. The professor\'s worksheet used CPI.' },
  { category: 'water', seriesId: 'bls.cpi', note: 'his: CPI, all urban consumers.' },
  { category: 'pollination', seriesId: 'bls.cpi', note: 'his: CPI.' },
  { category: 'otherMaterials', seriesId: 'bls.cpi', note: 'his: CPI. ours: seed, plant, tree and vine costs use the USDA seeds and plants index when it has been pulled, else CPI.' },
  { category: 'cashOverhead', seriesId: 'bls.cpi', note: 'his: CPI.' },
  { category: 'establishmentCpi', seriesId: 'bls.cpi', note: 'his: establishment costs are repriced row by row from the study\'s establishment table. When there is no usable table, the printed establishment cost (the accumulated total, and the yearly charge inside non-cash overhead) is repriced with the CPI, all items.' },
  { category: 'operatingInterest', seriesId: 'kcfed.operatingRate', note: 'his: recomputed at the Kansas City Fed operating loan rate, never indexed.' },
];

export const SEEDS_SERIES_ID = 'nass.seeds';
export const REPAIRS_SERIES_ID = 'nass.repairs';
