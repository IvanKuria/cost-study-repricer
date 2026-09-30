# Cost study repricer

Reprices a UC Davis cost and return study to a target month for agricultural lenders. Every number
shown comes from the study, a named price series, an explicitly documented calculation, or a lender edit.
Establishment rows combine inputs; their whole-row index classification is an approximation, disclosed in the calculation notes.

## Formula

For each line of the study's table:

```
repriced = original × index(target period) ÷ index(reference period)
```

- **Reference period** is June of the study's title year, following the professor's explicit convention.
  The study's stated price month is retained in the source data but does not override that convention.
- **Target period** is the latest month available in the series, or one the lender picks.
- A series that has no value for a month (quarterly series, a month not yet published) uses the
  nearest earlier month, and the cell says so.
- **Interest on operating capital** is never indexed. With a lender's rate it is recomputed the study's
  way: each month's cumulative operating cost carries the monthly rate through the last harvest month,
  using the study's own monthly table. Without a monthly table, the study's interest is scaled by the
  rate ratio and flagged. Without a lender's rate, the study's interest scales with its operating cost.
- **Returns** are not indexed. For establishment tables, a lender can change the sale price per unit
  (multiplied by each printed yield), or override each year's income. Repeated income rows stay synchronized.

## Which series reprices what

| Category | Series | Whose choice |
|---|---|---|
| Labor | USDA NASS labor wage-rate index, 2011 = 100 | professor |
| Pesticides | USDA NASS chemical totals index | professor |
| Fertilizer | USDA NASS fertilizer totals index | professor |
| Fuel, lube and repairs | USDA fuels index for the fuel part; USDA repairs index for lube and repairs when the study prints them separately; a combined column uses fuels | fuel: professor; repairs: ours |
| Non-cash overhead | USDA machinery totals index, CPI fallback | user instruction (the professor's worksheet used CPI) |
| Custom and contracted services | USDA ag services and rent index when available, else CPI. The monthly series does not exist, so CPI applies | ours, resolves to the professor's CPI |
| Water, pollination, other materials, cash overhead | BLS CPI-U, all items, seasonally adjusted | professor |
| Seeds, plants, trees, vines | USDA seeds and plants index | ours |
| Operating interest | Kansas City Fed operating loan rate, quarterly | professor |

`src/data/mapping.ts` carries this table in code with a note per line.

## How rows are classified

Table 1 columns decide most of it: the labor column is labor, fuel and lube and repairs are the
machinery category, custom or rent is contracted services. The materials column is classified by the
words in the row's label (fertilizer, pesticide, water, pollination, planting stock), and a row that
names several jobs goes to the job named first. Assessment rows and advisor fees in the custom column
go to other materials and assessments, as in the professor's worksheet. Cash overhead items and the
non-cash overhead total keep their own categories.

Validated against the professor's hand-classified studies (Budgets data.xlsx): wine grapes Lodi high
wire 2021, walnuts Sacramento Valley 2022, table grapes Flame Seedless 2018, almonds Sacramento Valley
2024. Every category agrees within 5 percent or $15 except: table grapes pesticides (ours $466, his
$405, tank-mix rows that combine growth regulators, insecticides and fungicides cannot be split from
row totals), table grapes other materials and custom (his footnoted splits), walnuts other materials
($85 vs $75). Run `npx vitest run src/lib/classify.test.ts` to print the comparison.

## Data

- `data/studies/parsed/*.json`: 241 parsed studies, copied from the farmer app repo with
  `npm run sync:studies` (set `STUDIES_SRC` to point elsewhere).
- `src/data/series.json`: built by `npm run ingest:series` from the professor's files in
  `~/Downloads` (set `SERIES_DIR`) plus live Quick Stats pulls for machinery, repairs and seeds when
  `NASS_KEY` is set in the environment. The key is never written to disk. Series pulled on an earlier
  run are kept when the key is absent.
- `data/backtest.json`: output of `npm run backtest`.

## Back-test

For every commodity with two parsed studies at least five years apart in the same region, the older
study is repriced to the newer study's reference period and compared per category with the newer
study. This measures how much of the change between two studies is price and how much is practice,
yield, scale or the study authors' choices. With the June reference convention, median absolute errors over 46 pairs are about 21 percent
on the total, and 47 to 105 percent by category. Some pairs contain parser artifacts; these figures
are diagnostic, not evidence of predictive accuracy. A lender should treat a repriced study as a
starting point for review, not a forecast.

## Layout

The engine returns the study's own table shape (`RepricedTable`): production tables as Table 1 with
cultural, harvest, assessment and post-harvest blocks, interest, cash overhead items, non-cash
overhead and totals; establishment tables with one column per year when the parser provides
`establishment.table`. Non-cash overhead is one line when the parser has not itemized it.

## Running and validating

`npm run dev -- --host 127.0.0.1` serves the tool on port 5174, under `/cost-study-repricer/`.
The initial screen loads the 2024 San Joaquin Valley South almond establishment table. Studies
from 2010 onward are selectable; older files remain available to the shared parser.
`npm test`, `npm run build`, and `npm run lint` validate the app.

## Establishment calculations and exports

The shared parser now supplies 74 row-by-row establishment tables. Fourteen carry subtotal
reconciliation warnings; see each study's `parse.warnings`. The 2024 almond study's second-year
cultural total is $183 above the sum of its printed rows. The original figures are preserved.

Each subtotal is its printed value plus changes in its components. The original difference between
printed totals and rounded/parsed components stays unindexed, and each affected cell documents it.
This avoids inventing a cost category for a discrepancy. Annual cash cost combines operating costs
and cash overhead; total annual cost adds non-cash overhead. Accumulated net cost is cumulative
cost less income across the year columns. Income changes do not change the cost subtotals.

Establishment operating interest scales the printed interest by repriced/original operating outlay
and lender/study rate. This is an approximation: a production-year monthly table is not a valid
cash schedule for the establishment years. A missing study rate is disclosed instead of silently
claiming the lender rate was applied. The summary labels identify the last displayed year's annual
cost, and peak cash need uses the accumulated **cash** cost row, excluding non-cash overhead.

All year cells for operations, overhead, interest and income are editable. A separate toggle opens
the production table. Sale price defaults to the price printed in the establishment table, falling back to the study's
parsed unit-price assumption when needed. A missing source price stays blank and is labeled.
Reset edits restores indexed values and the study price; clearing sale price also restores study income.
Study-dollar view retains the original figures even after edits.

The establishment PDF uses portrait letter pages, Times type, the source's year columns, yield row,
row order and source-page breaks. Repricing is labeled, edits carry an asterisk, and sources and
calculation notes follow the table. It is an adapted worksheet, not a facsimile issued by UC Davis.
The workbook includes original/repriced values and factors for each year, highlights edited cells,
and carries cell comments and calculation notes on its Sources sheet.

Tests cover the actual almond, Lodi wine-grape and walnut tables: unchanged-price identity, first-year
edit propagation, rate changes, income and sale-price edits, annual versus accumulated summaries,
and finite values and row preservation across all 74 establishment tables.
