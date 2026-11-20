import type { ParsedStudy } from '../data/studySchema';
import type { StudyPick } from './types';
import indexJson from '../../data/studies/index.json';
import contentsJson from './studyContents.json';

interface IndexRow { id: string; commodity: string; title: string; year: number | null; priceYear: number | null; region: string | null; description: string | null; archived: boolean; url: string; language: string; operatingTotal: number | null; totalCost: number | null; operations: number; equipment: number; hasMonthly: boolean; hasEstablishment: boolean }

export const STUDY_INDEX: IndexRow[] = indexJson as IndexRow[];

const files = import.meta.glob('../../data/studies/parsed/*.json');

export async function loadStudy(id: string): Promise<ParsedStudy> {
  const path = `../../data/studies/parsed/${id}.json`;
  const loader = files[path];
  if (!loader) throw new Error(`unknown study ${id}`);
  const mod = await loader() as { default: ParsedStudy };
  return mod.default;
}

/** What each parsed study holds (scripts/studyContents.ts): `e` an establishment table, `p` production operations. */
const CONTENTS = contentsJson as Record<string, { e: boolean; p: boolean }>;

/** Which of the two layouts a study can show, read from its parsed data. */
export type StudyContents = 'both' | 'establishment' | 'production';
/** A pickable study with what it contains. `hasEstablishment` is the parsed establishment table, not the index flag. */
export interface StudyChoice extends StudyPick { contents: StudyContents; hasProduction: boolean }

export const CONTENTS_LABEL: Record<StudyContents, string> = { both: 'Establishment and mature production', establishment: 'Establishment only', production: 'Mature production only' };

/** Studies a lender can pick: English, from 2010 on, with a parsed production or establishment table. Newest first
 *  within a commodity. */
export function studyPicks(rows: IndexRow[] = STUDY_INDEX, contents: Record<string, { e: boolean; p: boolean }> = CONTENTS): StudyChoice[] {
  return rows
    .filter(r => r.language === 'en' && r.year && r.year >= 2010 && (contents[r.id] ? contents[r.id].e || contents[r.id].p : r.operations > 0))
    .map(r => {
      const c = contents[r.id] ?? { e: false, p: true };
      const kind: StudyContents = c.e && c.p ? 'both' : c.e ? 'establishment' : 'production';
      return { id: r.id, commodity: r.commodity, title: r.title, year: r.year as number, priceYear: r.priceYear, priceMonth: null, region: r.region ?? '', description: r.description ?? '', url: r.url, hasEstablishment: c.e, hasProduction: c.p, contents: kind };
    })
    .sort((a, b) => a.commodity.localeCompare(b.commodity) || b.year - a.year || a.region.localeCompare(b.region));
}

export const commodityLabel = (id: string) => id.replace(/[–-]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
