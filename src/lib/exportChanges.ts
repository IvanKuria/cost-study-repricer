import type { ParsedStudy } from '@/data/studySchema';
import type { RepricedRow, RepricedTable } from './types';

/** What a lender edit changes, in the words the "Your changes" list uses. */
export type ChangeKind = 'cost' | 'income' | 'factor' | 'price' | 'quantity' | 'return value' | 'labor hours' | 'machine hours' | 'wage' | 'interest rate' | 'capital recovery rate' | 'acres';
export type ChangeUnit = 'money' | 'money2' | 'factor' | 'hours' | 'number' | 'percent';
/** Which stored edit a change lives in, so the screen can reset just that one. */
export type ChangeStore = 'override' | 'factor' | 'returns' | 'price' | 'rate' | 'crRate' | 'acres';

export interface UserChange {
  store: ChangeStore;
  key: string;                    // the stored key: an engine override key, a factor key, a hash return/labor key, or the control name
  kind: ChangeKind;
  row: string;                    // the table row or control the edit belongs to
  column: string | null;          // the table column, when the row has more than one
  from: number | null;            // the figure before the edit: the study's printed figure, the index factor, or the default rate
  fromLabel: 'Study' | 'Index' | 'Default';
  to: number;                     // the lender's figure
  unit: ChangeUnit;
}

/** Every edit the lender holds, as App stores them. */
export interface EditState {
  overrides: Record<string, number>;        // cost and income overrides: '<rowId>:<col>', '<rowId>' (a row total), 'income:<col>'
  factorOverrides: Record<string, number>;  // '<rowId>:<col>'
  returns: Record<string, number>;          // hash edits: return lines, gross, labor hours, machine hours, wages
  price: number | null;                     // the establishment sale price of a study without return lines
  studyPrice: number | null;                // that price as the study prints it
  rate: number | null; rateDefault: number | null;
  crRate: number | null; crRateDefault: number | null;
  acres: number;
}

const COLUMN_WORDS: Record<string, string> = { labor: 'Labor', fuelLubeRepairs: 'Fuel, lube and repairs', materials: 'Materials', custom: 'Custom', total: 'Total' };

/** A table column's name for the list: the production cost items in words, an establishment year as "Year 3". */
function columnName(table: RepricedTable, key: string): string {
  if (table.layout === 'production') return COLUMN_WORDS[key] ?? table.columns.find(c => c.key === key)?.label ?? key;
  const label = table.columns.find(c => c.key === key)?.label ?? key;
  const n = label.match(/\d+/)?.[0];
  return n ? `Year ${n}` : label;
}

const rowName = (r: RepricedRow) => r.label.replace(/\s+/g, ' ').trim();

/** The lender's edits, one entry each, with the figure before and after. Study-wide settings first, then the table's rows in
 *  table order. Built from the stored edits so every edit is listed even where the engine folds it into another figure
 *  (labor hours into labor dollars, machine hours into fuel, lube and repairs). */
export function userChanges(table: RepricedTable, study: ParsedStudy | null, e: EditState): UserChange[] {
  const out: UserChange[] = [];
  const rows = new Map(table.rows.map(r => [r.id, r]));
  const order = new Map(table.rows.map((r, i) => [r.id, i]));
  const rank: number[] = [];
  const push = (c: UserChange, rowId: string | null, col = 0) => { out.push(c); rank.push(rowId == null ? -1 : (order.get(rowId) ?? table.rows.length) * 100 + col); };
  const colIndex = (key: string | null) => key == null ? 0 : Math.max(0, table.columns.findIndex(c => c.key === key));

  // Study-wide settings.
  if (e.rate !== null) push({ store: 'rate', key: 'rate', kind: 'interest rate', row: 'Interest rate', column: null, from: e.rateDefault, fromLabel: 'Default', to: e.rate, unit: 'percent' }, null);
  if (e.crRate !== null && e.crRateDefault !== null) push({ store: 'crRate', key: 'crRate', kind: 'capital recovery rate', row: 'Capital recovery rate', column: null, from: e.crRateDefault, fromLabel: 'Default', to: e.crRate, unit: 'percent' }, null);
  if (e.acres !== 1) push({ store: 'acres', key: 'acres', kind: 'acres', row: 'Acres', column: null, from: 1, fromLabel: 'Default', to: e.acres, unit: 'number' }, null);
  if (e.price !== null) push({ store: 'price', key: 'price', kind: 'price', row: 'Sale price per unit', column: null, from: e.studyPrice, fromLabel: 'Study', to: e.price, unit: 'money2' }, null);

  // Hash edits: wages, return lines, labor and machine hours.
  for (const [key, to] of Object.entries(e.returns)) {
    if (!Number.isFinite(to)) continue;
    if (key === 'wage:machine' || key === 'wage:general') {
      const w = key === 'wage:machine' ? table.labor?.machine : table.labor?.general;
      push({ store: 'returns', key, kind: 'wage', row: key === 'wage:machine' ? 'Machine operator wage per hour' : 'General labor wage per hour', column: null, from: w?.study ?? null, fromLabel: 'Study', to, unit: 'money2' }, null);
      continue;
    }
    const m = key.match(/^(ret-(\d+)|gross|op-(\d+)):(\w+)$/);
    if (!m) continue;
    const [, id, ret, op, field] = m;
    const row = rows.get(id);
    if (ret != null) {
      const printed = study?.assumptions.returns[Number(ret)];
      const d = row?.returnLine;
      // The main line's price is also the establishment sale price, so it is listed in either layout.
      const name = row ? rowName(row) : printed ? `${printed.name}${table.layout === 'establishment' && field === 'price' ? ' (sale price)' : ''}` : `Return line ${Number(ret) + 1}`;
      if (field === 'price') push({ store: 'returns', key, kind: 'price', row: name, column: d ? `per ${d.unit}` : printed ? `per ${printed.unit}` : null, from: d?.price.original ?? printed?.price ?? null, fromLabel: 'Study', to, unit: 'money2' }, id);
      else if (field === 'quantity') push({ store: 'returns', key, kind: 'quantity', row: name, column: d?.unit ?? printed?.unit ?? null, from: d?.quantity.original ?? printed?.quantity ?? null, fromLabel: 'Study', to, unit: 'number' }, id);
      else if (field === 'total') push({ store: 'returns', key, kind: 'return value', row: name, column: null, from: row?.cells.total?.original ?? printed?.value ?? null, fromLabel: 'Study', to, unit: 'money' }, id, colIndex('total'));
      continue;
    }
    if (id === 'gross') { push({ store: 'returns', key, kind: 'income', row: row ? rowName(row) : 'Gross returns', column: null, from: row?.cells.total?.original ?? null, fromLabel: 'Study', to, unit: 'money' }, id); continue; }
    const opName = row ? rowName(row) : study?.costsPerAcre.operations[Number(op)]?.name ?? `Operation ${Number(op) + 1}`;
    if (field === 'laborHours') push({ store: 'returns', key, kind: 'labor hours', row: opName, column: 'Labor hours per acre', from: row?.labor?.hours?.original ?? null, fromLabel: 'Study', to, unit: 'hours' }, id, -1);
    else if (field === 'machineHours') push({ store: 'returns', key, kind: 'machine hours', row: opName, column: 'Machine hours per acre', from: row?.machine?.original ?? study?.costsPerAcre.operations[Number(op)]?.timeHrsPerAcre ?? null, fromLabel: 'Study', to, unit: 'hours' }, id, -2);
  }

  // Typed costs and income in the table.
  for (const [key, to] of Object.entries(e.overrides)) {
    if (!Number.isFinite(to)) continue;
    const inc = key.match(/^income:(.+)$/);
    if (inc) {
      const row = table.rows.find(r => r.kind === 'returns' && r.cells[inc[1]]);
      push({ store: 'override', key, kind: 'income', row: row ? rowName(row) : 'Income', column: columnName(table, inc[1]), from: row?.cells[inc[1]]?.original ?? null, fromLabel: 'Study', to, unit: 'money' }, row?.id ?? null, colIndex(inc[1]));
      continue;
    }
    const [id, col = 'total'] = key.split(':');
    const row = rows.get(id);
    const multi = table.layout === 'establishment' || (row ? Object.keys(row.cells).filter(k => k !== 'timeHrs').length > 1 : true);
    push({ store: 'override', key, kind: row?.kind === 'returns' ? 'income' : 'cost', row: row ? rowName(row) : id, column: multi ? columnName(table, col) : null, from: row?.cells[col]?.original ?? null, fromLabel: 'Study', to, unit: 'money' }, row ? id : null, colIndex(col));
  }

  // Typed adjustment factors: listed where the engine applied them (a cell with a printed cost).
  for (const [key, to] of Object.entries(e.factorOverrides)) {
    const [id, col] = key.split(':');
    const row = rows.get(id), cell = row?.cells[col];
    if (!row || !cell?.factorOverridden) continue;
    const multi = table.layout === 'establishment' || Object.keys(row.cells).filter(k => k !== 'timeHrs').length > 1;
    push({ store: 'factor', key, kind: 'factor', row: rowName(row), column: multi ? columnName(table, col) : null, from: cell.autoFactor ?? null, fromLabel: 'Index', to, unit: 'factor' }, id, colIndex(col));
  }

  return out.map((c, i) => ({ c, r: rank[i], i })).sort((a, b) => a.r - b.r || a.i - b.i).map(x => x.c);
}

/** A change's figure in its unit: "$1,234", "$1.75", "1.084", "0.49 hrs", "7.51%". */
export function changeValue(n: number | null, unit: ChangeUnit): string {
  if (n == null || !Number.isFinite(n)) return '—';
  const neg = n < 0 ? '-' : '';
  const a = Math.abs(n);
  switch (unit) {
    case 'money': return `${neg}$${Math.round(a).toLocaleString('en-US')}`;
    case 'money2': return `${neg}$${a.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
    case 'factor': return n.toFixed(3);
    case 'hours': return `${n.toLocaleString('en-US', { maximumFractionDigits: 3 })} hrs`;
    case 'percent': return `${(n * 100).toLocaleString('en-US', { maximumFractionDigits: 2 })}%`;
    default: return n.toLocaleString('en-US', { maximumFractionDigits: 4 });
  }
}

/** "Fumigate, Labor" or "Interest rate": the row and, when there is one, the column. */
export const changeWhere = (c: UserChange) => c.column ? `${c.row}, ${c.column}` : c.row;

/** One plain line for an export note or a tooltip: "Your cost: $1,200 (study $980)". */
export function changeSentence(c: UserChange): string {
  return `Your ${c.kind}: ${changeValue(c.to, c.unit)} (${c.fromLabel.toLowerCase()} ${changeValue(c.from, c.unit)})`;
}

/** The change that set a table cell, by the cell's override or factor key, for flagging edited cells in the exports. */
export function changeForCell(changes: UserChange[], table: RepricedTable, row: RepricedRow, col: string): UserChange | undefined {
  const keys = [`${row.id}:${col}`, ...(col === 'total' ? [row.id] : []), ...(row.kind === 'returns' && table.layout === 'establishment' ? [`income:${col}`] : [])];
  return changes.find(c => (c.store === 'override' || c.store === 'factor') && keys.includes(c.key))
    ?? (col === 'total' && row.returnLine ? changes.find(c => c.store === 'returns' && c.key.startsWith(`${row.id}:`)) : undefined)
    ?? (col === 'labor' ? changes.find(c => c.key === `${row.id}:laborHours` || c.key === `${row.id}:machineHours`) : undefined)
    ?? (col === 'fuelLubeRepairs' ? changes.find(c => c.key === `${row.id}:machineHours`) : undefined);
}
