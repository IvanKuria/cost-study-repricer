/**
 * Which USDA NASS California price received series adjusts which study return line. The professor's rule: adjust the
 * study price by the ratio of USDA's latest price to USDA's price in the study year, for every crop USDA covers, with
 * a disclaimer where the statewide change may not fit the study. The ratio has no units, so container-priced lines
 * (cartons, boxes, trays) are adjusted too.
 *
 * Rules are read in order and the first match for a line wins. A rule with `line` applies to return lines whose name
 * matches; a rule without it applies to the study's main crop line only. `series: null` marks a line USDA does not
 * price, with the reason shown to the lender.
 */
export interface CropPriceRule {
  commodity: string;              // the study's commodity, as parsed ('grapes–wine' uses an en dash)
  series: string | null;          // NASS short description
  line?: RegExp;                  // only lines whose name matches
  study?: RegExp;                 // only studies whose id or description matches
  reason?: string;                // for `series: null`: why the study price is kept
  disclaimer?: string;            // shown with the USDA price
}

const S = (item: string, unit: string) => `${item} - PRICE RECEIVED, MEASURED IN $ / ${unit}`;
const HAY = S('HAY, (EXCL ALFALFA)', 'TON');
const NO_SILAGE = 'USDA publishes no California silage price.';
const WINE_DISCLAIMER = 'USDA\'s wine grape price is a statewide average; prices in a district or for a variety can move differently (the Grape Crush Report gives district prices).';

export const CROP_PRICE_RULES: CropPriceRule[] = [
  { commodity: 'alfalfa', line: /silage/i, series: null, reason: NO_SILAGE },
  { commodity: 'alfalfa', series: S('HAY, ALFALFA', 'TON') },
  { commodity: 'almonds', series: S('ALMONDS', 'LB') },
  { commodity: 'apples', study: /processing/i, series: S('APPLES, PROCESSING', 'TON') },
  { commodity: 'apples', series: S('APPLES', 'LB') },
  { commodity: 'apricots', line: /dry|drying/i, series: S('APRICOTS, PROCESSING, DRIED', 'TON') },
  { commodity: 'apricots', series: S('APRICOTS', 'TON') },
  { commodity: 'artichokes', series: S('ARTICHOKES', 'CWT') },
  { commodity: 'asparagus', series: S('ASPARAGUS, FRESH MARKET', 'CWT') },
  { commodity: 'avocados', series: S('AVOCADOS', 'TON') },
  { commodity: 'beans', line: /garbanzo|chickpea/i, series: S('CHICKPEAS', 'CWT') },
  { commodity: 'beans', series: S('BEANS, DRY EDIBLE, (EXCL CHICKPEAS)', 'CWT'), disclaimer: 'USDA\'s dry bean price averages every dry bean class grown in California, so this study\'s class may have moved differently.' },
  { commodity: 'blueberries', series: S('BLUEBERRIES, TAME, FRESH MARKET', 'LB') },
  { commodity: 'broccoli', series: S('BROCCOLI', 'CWT') },
  { commodity: 'cabbage', series: S('CABBAGE', 'CWT') },
  { commodity: 'cantaloupes', series: S('MELONS, CANTALOUP', 'CWT') },
  { commodity: 'carrots', series: S('CARROTS', 'CWT') },
  { commodity: 'celery', series: S('CELERY', 'CWT') },
  { commodity: 'cherries', line: /brin|process/i, series: S('CHERRIES, SWEET, PROCESSING', 'TON') },
  { commodity: 'cherries', line: /peddler/i, series: null, reason: 'Direct sales; USDA publishes no comparable price.' },
  { commodity: 'cherries', line: /fresh/i, series: S('CHERRIES, SWEET, FRESH MARKET', 'TON') },
  { commodity: 'corn', line: /silage/i, series: null, reason: NO_SILAGE },
  { commodity: 'corn', series: S('CORN, GRAIN', 'BU') },
  { commodity: 'cotton', line: /seed/i, series: S('COTTON, COTTONSEED', 'TON') },
  { commodity: 'cotton', study: /pima/i, series: S('COTTON, PIMA', 'LB') },
  { commodity: 'cotton', series: S('COTTON, UPLAND', 'LB') },
  { commodity: 'dates', series: S('DATES', 'TON'), disclaimer: 'USDA\'s date price covers every grade; each grade in this study is adjusted by the same change.' },
  { commodity: 'figs', line: /paste|dried/i, series: S('FIGS, PROCESSING, DRIED', 'TON, DRY BASIS') },
  { commodity: 'grapes–raisins', series: S('GRAPES, RAISIN TYPE, PROCESSING, DRIED', 'TON, DRY BASIS') },
  { commodity: 'grapes–table', series: S('GRAPES, TABLE TYPE, FRESH MARKET', 'TON') },
  { commodity: 'grapes–wine', series: S('GRAPES, WINE TYPE', 'TON'), disclaimer: WINE_DISCLAIMER },
  { commodity: 'hay', series: HAY },
  { commodity: 'bermudagrass-hay', series: HAY },
  { commodity: 'kleingrass-hay', series: HAY },
  { commodity: 'oat-hay', series: HAY },
  { commodity: 'orchardgrass-hay', line: /hay/i, series: HAY, disclaimer: 'USDA\'s price is one average for all cuttings; each cutting is adjusted by the same change.' },
  { commodity: 'sudangrass', series: HAY },
  { commodity: 'timothygrass', line: /graz/i, series: null, reason: 'Grazing is priced per animal unit month; USDA\'s crop prices do not cover it.' },
  { commodity: 'timothygrass', line: /hay/i, series: HAY },
  { commodity: 'pasture', line: /graz/i, series: null, reason: 'Grazing is priced per animal unit month; USDA\'s crop prices do not cover it.' },
  { commodity: 'pasture', line: /hay/i, series: HAY },
  { commodity: 'lemons', line: /juice/i, series: null, reason: 'USDA publishes no California lemon juice price.' },
  { commodity: 'lemons', series: S('LEMONS', 'BOX, ON TREE EQUIV') },
  { commodity: 'lettuce', study: /romaine/i, series: S('LETTUCE, ROMAINE', 'CWT') },
  { commodity: 'lettuce', series: S('LETTUCE, HEAD', 'CWT') },
  { commodity: 'mandarins', series: S('TANGERINES', 'BOX, ON TREE EQUIV') },
  { commodity: 'mixed-vegetables', line: /farmers/i, series: null, reason: 'Farmers\' market sales; USDA publishes no comparable price.' },
  { commodity: 'mixed-vegetables', line: /watermelon/i, series: S('MELONS, WATERMELON', 'CWT') },
  { commodity: 'mixed-vegetables', line: /cantaloup/i, series: S('MELONS, CANTALOUP', 'CWT') },
  { commodity: 'mixed-vegetables', line: /honeydew/i, series: S('MELONS, HONEYDEW', 'CWT') },
  { commodity: 'nectarines', series: S('NECTARINES', 'TON') },
  { commodity: 'olives', series: S('OLIVES, PROCESSING, CANNED', 'TON') },
  { commodity: 'onions', line: /incentive/i, series: null, reason: 'A contract incentive; USDA publishes no comparable price.' },
  { commodity: 'onions', study: /dehydrat/i, series: S('ONIONS, DRY, PROCESSING', 'TON') },
  { commodity: 'onions', series: S('ONIONS, DRY', 'CWT') },
  { commodity: 'oranges', series: S('ORANGES', 'BOX, ON TREE EQUIV') },
  { commodity: 'peaches', line: /cling\s*(&|and)\s*free/i, series: S('PEACHES, PROCESSING', 'TON') },
  { commodity: 'peaches', line: /cling/i, series: S('PEACHES, CLINGSTONE, PROCESSING', 'TON') },
  { commodity: 'peaches', study: /processing/i, series: S('PEACHES, PROCESSING', 'TON') },
  { commodity: 'peaches', series: S('PEACHES', 'TON') },
  { commodity: 'peaches–nectarines', series: S('PEACHES', 'TON') },
  { commodity: 'pears', line: /juice|off-?grade/i, series: null, reason: 'USDA publishes no California price for juice or off-grade pears.' },
  { commodity: 'pears', line: /fresh/i, series: S('PEARS, FRESH MARKET', 'TON') },
  { commodity: 'pears', line: /canned|processing/i, series: S('PEARS, PROCESSING', 'TON') },
  { commodity: 'pears', line: /organic|conventional/i, series: S('PEARS', 'TON') },
  { commodity: 'pecans', series: S('PECANS', 'LB') },
  { commodity: 'peppermint-oil', series: S('MINT, PEPPERMINT, OIL', 'LB') },
  { commodity: 'peppers', line: /processing/i, series: S('PEPPERS, BELL, PROCESSING', 'TON') },
  { commodity: 'peppers', series: S('PEPPERS, BELL, FRESH MARKET', 'CWT') },
  { commodity: 'pistachios', series: S('PISTACHIOS', 'LB') },
  { commodity: 'plums', series: S('PLUMS, FRESH MARKET', 'TON') },
  { commodity: 'potatoes', series: S('POTATOES', 'CWT') },
  { commodity: 'prunes', series: S('PRUNES', 'TON, DRY BASIS') },
  { commodity: 'raspberries', series: S('RASPBERRIES', 'LB') },
  { commodity: 'rice', line: /direct pay/i, series: null, reason: 'A government direct payment, not a market price; USDA\'s crop prices do not cover it.' },
  { commodity: 'rice', series: S('RICE, MEDIUM-SHORT GRAIN', 'CWT') },
  { commodity: 'spinach', series: S('SPINACH', 'CWT') },
  { commodity: 'squash', series: S('SQUASH', 'CWT') },
  { commodity: 'strawberries', line: /freez|process/i, series: S('STRAWBERRIES, PROCESSING', 'CWT') },
  { commodity: 'strawberries', series: S('STRAWBERRIES', 'CWT') },
  { commodity: 'sugar-beets', series: S('SUGARBEETS', 'TON') },
  { commodity: 'sweet-potatoes', series: S('SWEET POTATOES', 'CWT') },
  { commodity: 'tomatoes', series: S('TOMATOES, PROCESSING', 'TON') },
  { commodity: 'walnuts', series: S('WALNUTS, ENGLISH', 'TON') },
  { commodity: 'watermelon', series: S('MELONS, WATERMELON', 'CWT') },
  { commodity: 'wheat', line: /straw/i, series: null, reason: 'USDA publishes no California straw price.' },
  { commodity: 'wheat', series: S('WHEAT', 'BU') },
];

/** Every NASS series the rules name, for the ingest script. */
export const CROP_PRICE_SERIES = [...new Set(CROP_PRICE_RULES.flatMap(r => r.series ? [r.series] : []))].sort();

export const ORGANIC_DISCLAIMER = 'USDA\'s California price does not separate organic from conventional, so the change is the conventional market\'s; organic prices may have moved differently.';
/** When USDA skipped the study's price year, the nearest earlier USDA year within this many years stands in for it. */
export const STUDY_YEAR_REACH = 3;
/** A USDA price this many years older than the last full year before the target month gets a disclaimer. */
export const STALE_YEARS = 3;
