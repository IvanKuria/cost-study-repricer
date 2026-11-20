import type { ParsedStudy } from '../data/studySchema';

/** What a parsed study holds: an establishment table the engine can lay out (`e`), and production operations or a printed
 *  operating total (`p`). The same tests repriceStudy uses to pick a layout. */
export function studyContentsOf(study: Pick<ParsedStudy, 'establishment' | 'costsPerAcre'>): { e: boolean; p: boolean } {
  const t = study.establishment?.table;
  return {
    e: !!(t && t.years?.length && t.rows?.length),
    p: (study.costsPerAcre?.operations?.length ?? 0) > 0 || !!study.costsPerAcre?.operatingTotal,
  };
}
