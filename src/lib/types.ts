// Contract for the cost-study repricer. Every number shown to a lender is either printed in a UC
// study, comes from a named price series, or was typed by the lender. Nothing is estimated otherwise.

/** The professor's eleven cost categories, from Budgets data.xlsx. */
export type Category =
  | 'labor' | 'pesticides' | 'fertilizer' | 'water' | 'pollination' | 'custom'
  | 'otherMaterials' | 'fuelLubeRepairs' | 'operatingInterest' | 'cashOverhead' | 'nonCashOverhead';

/** A monthly price series. Values keyed 'YYYY-MM'. */
export interface Series {
  id: string;                     // e.g. 'nass.fertilizer', 'nass.fuels', 'nass.labor', 'nass.chemicals', 'nass.machinery', 'bls.cpi', 'kcfed.operatingRate'
  name: string;                   // as printed by the source
  source: string;                 // organization and dataset
  url: string;
  unit: string;                   // 'index, 2011 = 100' | 'index, 1982-84 = 100' | 'percent'
  frequency: 'monthly' | 'quarterly';
  values: Record<string, number>; // 'YYYY-MM' -> value
  lastPeriod: string;             // latest 'YYYY-MM' present
}

/** Which series reprices which category. `fallback` is used when the primary is missing for a period. */
export interface CategoryMapping { category: Category; seriesId: string; fallbackSeriesId?: string; note: string }

export interface RepriceSettings {
  targetPeriod: string;           // 'YYYY-MM', default the latest month common to the series used
  referenceMonth: number;         // 1..12, default 6 (June of the study's price year)
  interestRate: number | null;    // yearly rate for operating interest; null keeps the study's own
  overrides: Record<string, number>; // lineId -> lender-typed 'your cost' value (per acre)
  mapping: CategoryMapping[];
}

/** One cell of a UC table: the study's value and how it was repriced. */
export interface RepricedCell {
  original: number | null;
  category: Category | null;
  seriesId: string | null;
  indexFrom: number | null;       // series value at the reference period
  indexTo: number | null;         // series value at the target period
  factor: number | null;          // indexTo / indexFrom
  repriced: number | null;        // original x factor, or the override
  overridden: boolean;
}

/** One row of the study's table, in the study's own column layout. */
export interface RepricedRow {
  id: string;
  label: string;                  // as printed, e.g. 'Fumigate (Flat - TIF Tarped)'
  kind: 'operation' | 'subtotal' | 'total' | 'overheadItem' | 'interest' | 'returns' | 'net' | 'blank' | 'heading';
  section: string;                // 'Cultural' | 'Harvest' | 'Assessment' | 'Postharvest' | 'Cash overhead' | 'Non-cash overhead' | ...
  timeHrs: number | null;
  cells: Record<string, RepricedCell>; // column key -> cell; production: labor, fuelLubeRepairs, materials, custom, total; establishment: year1..yearN
  page: number | null;
  quote: string | null;
}

export interface RepricedTable {
  studyId: string;
  title: string;                  // e.g. 'COSTS PER ACRE TO PRODUCE AND HARVEST ORGANIC STRAWBERRIES' or 'COSTS PER ACRE TO ESTABLISH AN ALMOND ORCHARD'
  layout: 'production' | 'establishment';
  columns: { key: string; label: string }[];
  rows: RepricedRow[];
  referencePeriod: string;        // 'YYYY-MM'
  targetPeriod: string;
  summary: {
    totalPerAcreOriginal: number | null;
    totalPerAcreRepriced: number | null;
    cashPerAcreRepriced: number | null;  // operating + cash overhead
    coverage: { category: Category; share: number; seriesId: string }[]; // share of original cost per category and what repriced it
    cpiShare: number;              // share of cost that fell to the CPI fallback
  };
}

export interface StudyPick { id: string; commodity: string; title: string; year: number; priceYear: number | null; priceMonth: number | null; region: string; description: string; url: string; hasEstablishment: boolean }
