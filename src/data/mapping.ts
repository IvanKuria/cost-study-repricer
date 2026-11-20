import type { CategoryMapping } from '../lib/types';

/**
 * Which price series reprices which cost category, with the fallback used when the primary series has no value for a
 * period. Each note states the source plainly: the series, who publishes it, how often, and the fallback.
 */
export const DEFAULT_MAPPING: CategoryMapping[] = [
  { category: 'labor', seriesId: 'nass.labor', note: 'USDA NASS index of prices paid by farmers for labor (wage rates), published monthly.' },
  { category: 'pesticides', seriesId: 'nass.chemicals', note: 'USDA NASS index of prices paid for agricultural chemicals, published quarterly; the nearest earlier quarter is used for a month.' },
  { category: 'fertilizer', seriesId: 'nass.fertilizer', note: 'USDA NASS index of prices paid for fertilizer, lime and soil conditioners, published monthly.' },
  { category: 'fuelLubeRepairs', seriesId: 'nass.fuels', fallbackSeriesId: 'nass.repairs', note: 'USDA NASS fuels index, published monthly; when a study prints lube and repairs separately, that part uses the USDA NASS repairs index. A combined fuel, lube and repairs column uses the fuels index.' },
  { category: 'nonCashOverhead', seriesId: 'nass.machinery', fallbackSeriesId: 'bls.cpi', note: 'USDA NASS index of prices paid for machinery, published monthly; BLS Consumer Price Index when it is unavailable.' },
  { category: 'custom', seriesId: 'nass.agServices', fallbackSeriesId: 'bls.cpi', note: 'USDA NASS agricultural services and rent index; BLS Consumer Price Index when it is unavailable.' },
  { category: 'water', seriesId: 'bls.cpi', note: 'BLS Consumer Price Index for all urban consumers, all items, published monthly.' },
  { category: 'pollination', seriesId: 'bls.cpi', note: 'BLS Consumer Price Index for all urban consumers, all items, published monthly.' },
  { category: 'otherMaterials', seriesId: 'bls.cpi', note: 'BLS Consumer Price Index for all urban consumers, all items, published monthly; seed, plant, tree and vine costs use the USDA NASS seeds and plants index when it is available.' },
  { category: 'cashOverhead', seriesId: 'bls.cpi', note: 'BLS Consumer Price Index for all urban consumers, all items, published monthly.' },
  { category: 'establishmentCpi', seriesId: 'bls.cpi', note: 'Establishment costs are repriced row by row from the study\'s establishment table, each row with the index for its category. Without a usable table, the printed establishment cost (the accumulated total, and the yearly charge in non-cash overhead) uses the BLS Consumer Price Index, all items.' },
  { category: 'operatingInterest', seriesId: 'kcfed.operatingRate', note: 'Recomputed at the Federal Reserve Bank of Kansas City operating loan rate (Agricultural Finance Databook, published quarterly), not indexed.' },
];

export const SEEDS_SERIES_ID = 'nass.seeds';
export const REPAIRS_SERIES_ID = 'nass.repairs';
