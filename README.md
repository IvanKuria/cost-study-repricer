# Cost study repricer

Reprices a UC Davis cost and return study to a target month for agricultural lenders. Every number
shown is one of three things: printed in the study, computed from a named public price series, or
typed by the lender. Nothing is estimated any other way.

## Formula

For each line of the study's table:

```
repriced = original × index(target period) ÷ index(reference period)
```

- **Reference period** is the month and year the study says its prices are for ("based on January 2024
  figures"), read from the study text. When a study gives only a year, June of that year is used
  (the professor's rule). When it says "current figures", its title year is used.
- **Target period** is the latest month available in the series, or one the lender picks.
- A series that has no value for a month (quarterly series, a month not yet published) uses the
  nearest earlier month, and the cell says so.
- **Interest on operating capital** is never indexed. With a lender's rate it is recomputed the study's
  way: each month's cumulative operating cost carries the monthly rate through the last harvest month,
  using the study's own monthly table. Without a monthly table, the study's interest is scaled by the
  rate ratio and flagged. Without a lender's rate, the study's interest scales with its operating cost.
- **Returns** are not repriced. The lender can type a price.

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
yield, scale or the study authors' choices. Median absolute errors over 46 pairs are around 20 to 40
percent per category and 19 percent on the total, so indexing explains the direction of change but a
lender should read the repriced number as a starting point, not a forecast.

## Layout

The engine returns the study's own table shape (`RepricedTable`): production tables as Table 1 with
cultural, harvest, assessment and post-harvest blocks, interest, cash overhead items, non-cash
overhead and totals; establishment tables with one column per year when the parser provides
`establishment.table`. Non-cash overhead is one line when the parser has not itemized it.
