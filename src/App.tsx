import { useEffect, useMemo, useState } from 'react';
import type { ParsedStudy } from '@/data/studySchema';
import type { RepriceSettings, RepricedTable, Series, StudyPick } from '@/lib/types';
import { DEFAULT_HASH, parseHash, serializeHash, type HashState } from '@/lib/hashState';
import type { ExportMeta } from '@/lib/exportShared';
import { DEFAULT_MAPPING } from '@/data/mapping';
import { loadStudy, studyPicks } from '@/lib/studies';
import { SERIES } from '@/lib/series';
import { defaultSalePrice, isLaborKey, isReturnKey, mainReturnIndex, repriceStudy, returnKey, studySalePrice } from '@/lib/reprice';
import { CROP_PRICES } from '@/lib/cropPrices';
import { Card, periodLabel } from '@/ui';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Controls } from '@/screens/Controls';
import { Summary, type YourPriceProps } from '@/screens/Summary';
import { StudyTable, type View } from '@/screens/StudyTable';
import { Notes, mappingNotes } from '@/screens/Notes';
import { Exports } from '@/screens/Exports';
import { WageInput } from '@/screens/LaborEdit';
import { YourChanges } from '@/screens/YourChanges';
import { userChanges, type UserChange } from '@/lib/exportChanges';
import { studyContentsOf } from '@/lib/studyContentsOf';

const RATE_SERIES = 'kcfed.operatingRate';

/** Months every monthly series covers, newest first, from 2010 on. */
export function commonPeriods(series: Series[]): string[] {
  const monthly = series.filter(s => s.frequency === 'monthly');
  if (!monthly.length) return [];
  const sets = monthly.map(s => new Set(Object.keys(s.values)));
  return [...sets[0]].filter(p => p >= '2010-01' && sets.every(set => set.has(p))).sort().reverse();
}

function latestRate(series: Series[]): { rate: number; period: string } | null {
  const s = series.find(x => x.id === RATE_SERIES);
  if (!s) return null;
  const v = s.values[s.lastPeriod];
  if (!Number.isFinite(v)) return null;
  return { rate: s.unit === 'percent' ? v / 100 : v, period: s.lastPeriod };
}

export default function App() {
  const picks = useMemo(() => studyPicks(), []);
  // A plain link opens with no crop chosen, so the visitor picks one (Adauto, 2026-11-18); a shared link restores its own.
  const [hash, setHash] = useState<HashState>(() => window.location.hash ? parseHash(window.location.hash) : DEFAULT_HASH);
  const [layout, setLayout] = useState<'establishment' | 'production'>('establishment');
  const [price, setPrice] = useState<number | null>(null);
  const series: Series[] = SERIES;
  const [study, setStudy] = useState<ParsedStudy | null>(null);
  const [overrides, setOverrides] = useState<Record<string, number>>({});
  const [factorOverrides, setFactorOverrides] = useState<Record<string, number>>({});
  const [view, setView] = useState<View>('today');
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    const onHash = () => setHash(parseHash(window.location.hash));
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  useEffect(() => { const next = serializeHash(hash); if (next !== window.location.hash) history.replaceState(null, '', next || window.location.pathname); }, [hash]);
  useEffect(() => {
    setOverrides({}); setFactorOverrides({}); setPrice(null); setLoadError(null); setStudy(null);
    if (!hash.study) { setStudy(null); return; }
    let live = true;
    loadStudy(hash.study).then(s => { if (live) setStudy(s); }).catch(e => { if (live) setLoadError(String(e)); });
    return () => { live = false; };
  }, [hash.study]);

  const periods = useMemo(() => commonPeriods(series), [series]);
  const rateInfo = useMemo(() => latestRate(series), [series]);
  const target = hash.target && periods.includes(hash.target) ? hash.target : periods[0] ?? null;
  const pick: StudyPick | null = picks.find(p => p.id === hash.study) ?? null;
  // The sale price before any edit: the study price adjusted by USDA's California price ratio when one applies, else the study's.
  const saleDefault = target && study && study.source.id === hash.study ? defaultSalePrice(study, { cropPrices: CROP_PRICES }, target) : null;
  const defaultPrice = saleDefault?.price ?? null;
  const usdaSale = saleDefault?.published ?? null;
  const returnEdits = hash.returns;
  const setReturnEdits = (f: (r: Record<string, number>) => Record<string, number>) => setHash(h => ({ ...h, returns: f(h.returns) }));
  // Studies with return lines share one sale price between the main return line and the establishment years: it is stored
  // as that line's price edit. Studies without lines keep the establishment-only sale price.
  const mainLine = study && study.source.id === hash.study ? mainReturnIndex(study) : -1;
  const sharedKey = mainLine >= 0 ? returnKey(mainLine, 'price') : null;
  const priceEdit = sharedKey ? returnEdits[sharedKey] ?? null : price;
  const studyPrice = mainLine >= 0 ? study?.assumptions.returns[mainLine]?.price ?? null : studySalePrice(study);
  const money2 = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const changePrice = (value: number | null) => {
    const next = value === defaultPrice ? null : value;
    if (sharedKey) setReturnEdits(r => { const n = { ...r }; delete n[returnKey(mainLine, 'total')]; if (next === null) delete n[sharedKey]; else n[sharedKey] = next; return n; });
    else setPrice(next);
    setOverrides(o => Object.fromEntries(Object.entries(o).filter(([key]) => !key.startsWith('income:'))));
  };
  /** A return line edit: typing the value clears that line's price and quantity edits, and the other way round. */
  const changeReturn = (key: string, value: number | null) => setReturnEdits(r => {
    const n = { ...r };
    const [id, field] = key.split(':');
    if (field === 'total') { delete n[`${id}:price`]; delete n[`${id}:quantity`]; } else delete n[`${id}:total`];
    if (value === null) delete n[key]; else n[key] = value;
    return n;
  });
  const allOverrides = useMemo(() => ({ ...overrides, ...returnEdits }), [overrides, returnEdits]);

  // The layouts this study can show, read from its parsed data. A layout it lacks is never offered or used.
  const contents = study && study.source.id === hash.study ? studyContentsOf(study) : null;
  const shownLayout: 'establishment' | 'production' = !contents ? layout : layout === 'production' ? (contents.p ? 'production' : 'establishment') : (contents.e ? 'establishment' : 'production');
  const settings: RepriceSettings | null = target ? {
    layout: shownLayout, factorOverrides,  pricePerUnit: price, targetPeriod: target, referenceMonth: 6, interestRate: hash.rate ?? rateInfo?.rate ?? null, capitalRecoveryRate: hash.crRate, overrides: allOverrides, mapping: DEFAULT_MAPPING, cropPrices: CROP_PRICES,
  } : null;
  const calculation = useMemo<{ table: RepricedTable | null; error: string | null }>(() => {
    if (!study || !settings || study.source.id !== hash.study) return { table: null, error: null };
    try { return { table: repriceStudy(study, settings, series), error: null }; } catch (e) { return { table: null, error: String(e) }; }
  }, [study, series, settings?.targetPeriod, settings?.interestRate, settings?.capitalRecoveryRate, allOverrides, factorOverrides, shownLayout, price, hash.study]); // eslint-disable-line react-hooks/exhaustive-deps

  const table = calculation.table;
  const studyHere = study && study.source.id === hash.study ? study : null;
  const usedSeries = new Set(table?.rows.flatMap(r => Object.values(r.cells).flatMap(c => c.seriesId?.split('+') ?? [])) ?? []);
  // "Your price" above the table edits the same stored price as the table: the establishment yield row's sale price, or in
  // mature production the main return line's price (the first line when no line is shared with the establishment years).
  const priceLine = table?.layout === 'production' ? table.rows.find(r => r.returnLine && r.id === `ret-${sharedKey ? mainLine : 0}`) : undefined;
  const yourPrice: YourPriceProps | null = !table ? null : table.layout === 'establishment'
    ? table.yieldRow && defaultPrice !== null ? {
      value: priceEdit ?? defaultPrice, original: studyPrice, base: defaultPrice, edited: priceEdit !== null, usda: usdaSale, onChange: changePrice,
      unit: table.yieldRow.label.match(/@\s*\$[\d,.]+\s*(?:\/|per\s+)\s*([A-Za-z]+)/i)?.[1] ?? 'unit',
      where: `Same price as the yield row's sale price below${sharedKey ? ' and the main return line in mature production' : ''}.`,
    } : null
    : priceLine?.returnLine && priceLine.returnLine.price.original != null ? (d => ({
      value: d.price.current, original: d.price.original, base: d.default, edited: d.price.edited, usda: d.published, unit: d.unit,
      onChange: sharedKey ? changePrice : (v: number | null) => changeReturn(`${priceLine.id}:price`, v),
      where: `Same price as the "${priceLine.label}" return line below${sharedKey && study?.establishment?.table?.yieldRow ? ' and the sale price for the establishment years' : ''}.`,
    }))(priceLine.returnLine) : null;
  const rateSource = rateInfo ? `Kansas City Fed operating loans, ${periodLabel(rateInfo.period)}` : 'no rate series loaded';
  const meta: ExportMeta | null = table ? {
    sourcesUrl: (() => { const url = new URL(window.location.href); url.searchParams.set('section', 'sources'); return url.href; })(),
    study: pick, series: series.filter(s => s.id === RATE_SERIES || usedSeries.has(s.id)),
    interestRate: settings?.interestRate ?? null, interestSource: hash.rate === null ? rateSource : 'lender-entered rate', acres: hash.acres, mappingNotes: mappingNotes(DEFAULT_MAPPING, series),
  } : null;
  // The capital recovery rate only matters where the yearly establishment charge is recalculated: the production table of a study whose inputs reproduce its printed charge.
  const capitalRecovery = study?.establishmentSummary?.capitalRecovery;
  // Its default is the interest rate in use; the study's own rate is shown for comparison.
  const crRateDefault = table?.layout === 'production' && capitalRecovery?.reproduces ? settings?.interestRate ?? capitalRecovery.ratePct.value / 100 : null;
  const crRateSource = !capitalRecovery ? '' : settings?.interestRate != null
    ? `Same as the interest rate above; the study used ${capitalRecovery.ratePct.value}% (page ${capitalRecovery.ratePct.page})`
    : `Study rate for the establishment charge, page ${capitalRecovery.ratePct.page}`;
  // Labor hours, machine hours and wages ride in the hash with the return lines, so share links carry them (setReturnEdits
  // keeps <id>:total siblings). The latest edit of a figure wins and clears the edits it would otherwise fight with:
  //   a typed cost clears the factor on the same cell, and a typed factor clears the typed cost (onFactor below);
  //   in production, a typed cost item (labor, fuel, materials, custom) clears the row's typed total, and a typed total
  //   clears the row's typed items and their factors, so the total always reads as the sum you see or the figure you typed;
  //   typed labor dollars clear that row's labor hours, and typed labor hours clear its labor dollars and labor factor;
  //   typed machine hours clear that row's typed fuel, lube and repairs (its factor stays: it sets the price change).
  const editLine = (rowId: string, value: number | null) => {
    if (isLaborKey(rowId)) {
      setReturnEdits(r => { const n = { ...r }; if (value === null) delete n[rowId]; else n[rowId] = value; return n; });
      const m = rowId.match(/^(op-\d+):(laborHours|machineHours)$/);
      if (m && value !== null) {
        const [, id, field] = m;
        const item = field === 'laborHours' ? 'labor' : 'fuelLubeRepairs';
        setOverrides(o => { const n = { ...o }; delete n[`${id}:${item}`]; delete n[`${id}:total`]; delete n[id]; return n; });
        if (field === 'laborHours') setFactorOverrides(o => { const n = { ...o }; delete n[`${id}:labor`]; return n; });
      }
      return;
    }
    if (isReturnKey(rowId)) { changeReturn(rowId === 'gross' ? 'gross:total' : rowId, value); return; }
    const [id, col = 'total'] = rowId.split(':');
    const key = rowId.includes(':') ? rowId : `${rowId}:total`;
    const prodRow = shownLayout === 'production' && /^op-\d+$/.test(id);
    const items = ['labor', 'fuelLubeRepairs', 'materials', 'custom'];
    setFactorOverrides(o => {
      const n = { ...o }; delete n[key];
      if (prodRow && col === 'total' && value !== null) for (const k of items) delete n[`${id}:${k}`];
      return n;
    });
    setOverrides(o => {
      const n = { ...o };
      // A row total is stored as '<id>:total'; older edits used the bare row id, so both go when either is set or reset.
      if (col === 'total') { delete n[id]; delete n[`${id}:total`]; } else delete n[rowId];
      if (value !== null) {
        n[key] = value;
        if (prodRow && col === 'total') for (const k of items) delete n[`${id}:${k}`];
        if (prodRow && col !== 'total') { delete n[id]; delete n[`${id}:total`]; }
      }
      return n;
    });
    if (prodRow && col === 'labor' && value !== null) setReturnEdits(r => { const n = { ...r }; delete n[`${id}:laborHours`]; return n; });
  };
  const resetAll = () => { setOverrides({}); setFactorOverrides({}); setPrice(null); setHash(h => ({ ...h, returns: {}, rate: null, crRate: null, acres: 1 })); };
  const changes: UserChange[] = table ? userChanges(table, studyHere, {
    overrides, factorOverrides, returns: returnEdits, price, studyPrice: studySalePrice(studyHere),
    rate: hash.rate, rateDefault: rateInfo?.rate ?? null, crRate: hash.crRate, crRateDefault: crRateDefault, acres: hash.acres,
  }) : [];
  if (meta) meta.changes = changes;
  const resetChange = (c: UserChange) => {
    if (c.store === 'override') editLine(c.key, null);
    else if (c.store === 'factor') setFactorOverrides(o => { const n = { ...o }; delete n[c.key]; return n; });
    else if (c.store === 'returns') setReturnEdits(r => { const n = { ...r }; delete n[c.key]; return n; });
    else if (c.store === 'price') setPrice(null);
    else if (c.store === 'rate') setHash(h => ({ ...h, rate: null }));
    else if (c.store === 'crRate') setHash(h => ({ ...h, crRate: null }));
    else if (c.store === 'acres') setHash(h => ({ ...h, acres: 1 }));
  };
  const dataDate = series.filter(s => s.frequency === 'monthly').map(s => s.lastPeriod).sort().reverse()[0] ?? null;

  if (new URLSearchParams(window.location.search).get('section') === 'sources' && table && meta) return <main className="mx-auto max-w-4xl p-5"><h1 className="text-2xl font-bold mb-4">Sources and calculations</h1><p className="mb-4">Adjustment factor = selected month’s index ÷ study-period index. Adjusted cost = study cost × factor. Automatic production totals combine the adjusted components.</p><Notes table={table} meta={meta} study={pick} mapping={DEFAULT_MAPPING} series={meta.series} sourcesOpen /></main>;

  return (
    <TooltipProvider delayDuration={150}>
      <div className="min-h-dvh">
        <header className="bg-ground border-b border-line">
          <div className="mx-auto max-w-[1240px] px-5 h-14 flex items-center gap-4">
            <div className="font-bold text-[17px] tracking-tight">Cost study repricer</div>
            <div className="ml-auto text-[13px] text-ink-2 text-right leading-tight">
              {target && <div>Target month: <span className="text-ink font-medium">{periodLabel(target)}</span></div>}
              {dataDate && <div>Series through {periodLabel(dataDate)}</div>}
            </div>
          </div>
        </header>
        <main className="mx-auto max-w-[1240px] px-5 py-6 space-y-6">
          <Card className="p-5">
            <Controls
              value={{ crop: hash.crop, study: hash.study, target, rate: hash.rate, crRate: hash.crRate, acres: hash.acres }}
              onChange={v => setHash(h => ({ ...DEFAULT_HASH, ...v, returns: v.study === h.study ? h.returns : {} }))}
              picks={picks} periods={periods} rateDefault={rateInfo?.rate ?? null} rateSource={rateSource} crRateDefault={crRateDefault} crRateSource={crRateSource}
            />
            {table?.layout === 'production' && table.labor && <div className="mt-4 border-t border-line pt-3"><WageInput labor={table.labor} onOverride={editLine} /></div>}
          </Card>
          {(loadError || calculation.error) && <p role="alert" className="text-loss text-[14px]">{loadError || calculation.error}</p>}
          {!hash.study && <p className="text-ink-2">Pick a crop and a study. The study's cost table appears here, repriced to the target month, and every line can be edited.</p>}
          {table && meta && (
            <>
              {/* Only the layouts the study holds are offered; a study with one shows which one it has. */}
              {contents && <div className="max-w-md space-y-2">
                {contents.e && contents.p
                  ? <div className="flex flex-wrap gap-2">{(['establishment', 'production'] as const).map(l => <button key={l} type="button" aria-pressed={table.layout === l} aria-describedby="table-stage-description" onClick={() => { if (l !== table.layout) { setLayout(l); setOverrides({}); setFactorOverrides({}); } }} className={`h-9 px-4 rounded-full border transition-colors duration-150 ${table.layout === l ? 'border-accent bg-accent-soft text-accent-deep' : 'border-line hover:border-accent'}`}>{l === 'establishment' ? 'Planting & early years' : 'Mature production'}</button>)}</div>
                  : <div className="text-[14px] font-medium">{table.layout === 'establishment' ? 'Planting & early years' : 'Mature production'}</div>}
                <p id="table-stage-description" className="text-[13px] text-ink-3">{table.layout === 'establishment' ? 'Costs and income by year, from planting through early harvests.' : 'Costs and income for one typical year at full production.'}{!(contents.e && contents.p) && ` This study has ${contents.e ? 'no mature production table' : 'no establishment table'}.`}</p>
              </div>}
              <Card className="p-5 space-y-4"><Summary table={table} acres={hash.acres} price={yourPrice} /></Card>
              <Card className="p-5 space-y-4 min-w-0">
                <YourChanges changes={changes} onReset={resetChange} onResetAll={resetAll} />
                <div className="flex flex-wrap items-center gap-2 text-[13px]">
                  <span className="text-ink-2 mr-1">Show</span>
                  {(['today', 'study', 'both'] as View[]).map(v => (
                    <button key={v} type="button" onClick={() => setView(v)} aria-pressed={view === v}
                      className={`h-8 px-3 rounded-full border ${view === v ? 'border-accent bg-accent-soft text-accent-deep font-medium' : 'border-line text-ink-2'}`}>
                      {v === 'today' ? "Today's dollars" : v === 'study' ? "Study's dollars" : 'Both'}
                    </button>
                  ))}
                </div>
                <StudyTable key={`${table.studyId}-${table.layout}`} table={table} study={pick} series={series} view={view}
                  salePrice={table.layout === 'establishment' && table.yieldRow && defaultPrice !== null ? {
                    value: priceEdit ?? defaultPrice, edited: priceEdit !== null, usda: usdaSale, studyPrice, shared: !!sharedKey,
                    onChange: changePrice,
                    reset: priceEdit !== null ? { label: `Use ${usdaSale ? 'USDA' : 'study'} price (${money2(defaultPrice)})`, value: null } : null,
                    toStudy: usdaSale && studyPrice != null && priceEdit !== studyPrice ? { label: `Use study price (${money2(studyPrice)})`, value: studyPrice } : null,
                  } : null}
                  onFactor={(key, value) => {
                    setFactorOverrides(o => { const n = { ...o }; if (value === null) delete n[key]; else n[key] = value; if (table.layout === 'production' && !key.endsWith(':total')) delete n[`${key.split(':')[0]}:total`]; return n; });
                    setOverrides(o => { const n = { ...o }; delete n[key]; if (key.endsWith(':total')) delete n[key.slice(0, -6)]; else if (table.layout === 'production') { delete n[`${key.split(':')[0]}:total`]; delete n[key.split(':')[0]]; } return n; });
                  }}
                  typedKeys={new Set(Object.keys(overrides))}
                  onOverride={editLine} />
              </Card>
              <Card className="p-5"><Notes table={table} meta={meta} study={pick} mapping={DEFAULT_MAPPING} series={meta.series} /></Card>
              <Card className="p-5"><Exports table={table} meta={meta} /></Card>
            </>
          )}
        </main>
      </div>
    </TooltipProvider>
  );
}
