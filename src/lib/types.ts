// Contract for the cost-study repricer. Every number shown to a lender is either printed in a UC
// study, comes from a named price series, or was typed by the lender. Nothing is estimated otherwise.

/** The professor's eleven cost categories, from Budgets data.xlsx. */
export type Category =
  | 'labor' | 'pesticides' | 'fertilizer' | 'water' | 'pollination' | 'custom'
  | 'otherMaterials' | 'fuelLubeRepairs' | 'operatingInterest' | 'cashOverhead' | 'nonCashOverhead' | 'establishmentCpi';

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

/** A USDA NASS price received series for one crop in California: marketing-year averages. Values keyed 'YYYY'. */
export interface CropPrice {
  id: string;                     // the NASS short description, e.g. 'ALMONDS - PRICE RECEIVED, MEASURED IN $ / LB'
  commodity: string;              // NASS commodity, e.g. 'ALMONDS'
  unit: string;                   // NASS unit, e.g. '$ / LB' or '$ / TON, DRY BASIS'
  source: string;
  url: string;
  values: Record<string, number>; // marketing year -> dollars per unit; withheld years are absent
}

/** The USDA price applied to one return line, in the line's unit. Only lb, cwt and ton convert; containers never do. */
export interface PublishedPrice {
  seriesId: string;
  year: string;                   // marketing year of the latest USDA price
  value: number;                  // USDA's latest price, dollars per NASS unit
  per: string;                    // the NASS unit word: 'lb', 'cwt', 'ton'
  studyYear: string;              // the marketing year the change is measured from: the study's price year, or the nearest earlier
  studyYearPrice: number;         // USDA's price in studyYear, dollars per NASS unit
  change: number;                 // value / studyYearPrice - 1
  studyPrice: number;             // the study's price per unit of the line
  price: number;                  // studyPrice x (1 + change): the adjusted price per unit of the line
  disclaimers: string[];          // why the statewide change may not fit this study
}

/** Which series reprices which category. `fallback` is used when the primary is missing for a period. */
export interface CategoryMapping { category: Category; seriesId: string; fallbackSeriesId?: string; note: string }

export interface RepriceSettings {
  factorOverrides?: Record<string, number>;
  summaryColumn?: string;
  layout?: 'production' | 'establishment';
  pricePerUnit?: number | null;
  targetPeriod: string;           // 'YYYY-MM', default the latest month common to the series used
  referenceMonth: number;         // 1..12, default 6 (June of the study's price year)
  interestRate: number | null;    // yearly rate for operating interest; null keeps the study's own
  capitalRecoveryRate?: number | null; // yearly rate for the establishment capital recovery charge; null keeps the study's own
  overrides: Record<string, number>; // lineId -> lender-typed 'your cost' value (per acre)
  mapping: CategoryMapping[];
  /** USDA crop prices that replace the study's sale prices when newer. Absent: every return keeps the study price. */
  cropPrices?: CropPrice[];
}

/** One cell of a UC table: the study's value and how it was repriced. */
export interface RepricedCell {
  parts?: RepricedCell[]; // Separate source amounts for a combined fuel/repairs cell.
  autoFactor?: number | null;
  factorOverridden?: boolean;
  note?: string | null;
  original: number | null;
  category: Category | null;
  seriesId: string | null;
  indexFrom: number | null;       // series value at the reference period
  indexTo: number | null;         // series value at the target period
  factor: number | null;          // indexTo / indexFrom
  repriced: number | null;        // original x factor, or the override
  overridden: boolean;
  fallback?: boolean;             // no specific index matched the row's label, so the CPI fallback priced it
  recalculated?: boolean;         // computed from other repriced figures (establishment capital recovery, insurance, taxes), not indexed; `note` shows the working
}

/** One row of the study's table, in the study's own column layout. */
export interface RepricedRow {
  displayLabel?: string;          // updated rate label for repriced views; label remains the source wording
  id: string;
  label: string;                  // as printed, e.g. 'Fumigate (Flat - TIF Tarped)'
  kind: 'operation' | 'subtotal' | 'total' | 'overheadItem' | 'interest' | 'returns' | 'net' | 'blank' | 'heading';
  section: string;                // 'Cultural' | 'Harvest' | 'Assessment' | 'Postharvest' | 'Cash overhead' | 'Non-cash overhead' | ...
  timeHrs: number | null;
  cells: Record<string, RepricedCell>; // column key -> cell; production: labor, fuelLubeRepairs, materials, custom, total; establishment: year1..yearN
  page: number | null;
  quote: string | null;
  sourceNote?: string | null;     // plain-words source line shown under the label, e.g. where an establishment total was printed
  returnLine?: ReturnLineDetail;  // a production return line (crop or byproduct): its printed and current quantity and price
}

/** A return line as the study prints it (quantity, unit, price) and as the lender has it now. The value is in `cells.total`. */
export interface ReturnLineDetail {
  unit: string;
  main: boolean;                  // the main crop line of a study with an establishment yield row: its price is shared with the establishment years
  quantity: { original: number | null; current: number | null; edited: boolean };
  price: { original: number | null; current: number | null; edited: boolean };
  valueEdited: boolean;           // the lender typed the value directly
  mismatch: number | null;        // printed quantity x price less the printed value, when more than $1
  published: PublishedPrice | null; // the USDA price in use when the lender has not edited the price
  default: number | null;         // the price before any lender edit: the USDA price when one applies, else the study price
  kept: string | null;            // why the study price is kept when USDA prices are on and none applies
}

export interface RepricedTable {
  notes?: string[];
  /** USDA crop price series used for this table's income, for the sources list. */
  priceSources?: { series: CropPrice; year: string; value: number }[];
  /** The sale price before any lender edit (USDA when one applies, else the study's), for the establishment price field. */
  defaultSalePrice?: { price: number; published: PublishedPrice | null } | null;
  establishmentNote?: string | null; // establishment status in plain words: its source, or that the study prints none
  yieldRow?: { label: string; values: (number | null)[] } | null;
  summaryColumn?: string;
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
    pricedRows: number;            // rows with at least one indexed amount
    fallbackRows: number;          // of those, rows with an amount priced by the CPI fallback because no specific index matched
  };
}

export interface StudyPick { id: string; commodity: string; title: string; year: number; priceYear: number | null; priceMonth: number | null; region: string; description: string; url: string; hasEstablishment: boolean }
