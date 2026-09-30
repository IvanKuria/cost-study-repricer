import type { ParsedStudy } from '../data/studySchema';
import type { StudyPick } from './types';
import indexJson from '../../data/studies/index.json';

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

/** Studies a lender can pick: English, with a parsed costs table. Newest first within a commodity. */
export function studyPicks(rows: IndexRow[] = STUDY_INDEX): StudyPick[] {
  return rows
    .filter(r => r.language === 'en' && r.operations > 0 && r.year && r.year >= 2010)
    .map(r => ({ id: r.id, commodity: r.commodity, title: r.title, year: r.year as number, priceYear: r.priceYear, priceMonth: null, region: r.region ?? '', description: r.description ?? '', url: r.url, hasEstablishment: r.hasEstablishment }))
    .sort((a, b) => a.commodity.localeCompare(b.commodity) || b.year - a.year || a.region.localeCompare(b.region));
}

export const commodityLabel = (id: string) => id.replace(/[–-]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
