// services/hackathon/scraperRoutes.ts — fetch-details page discovery (SRP extract).
// WHY: SCRAPER_PAGE_ROUTES was inline in the 1902-line hackathons router.
// Derived from the registry SSOT (enrichPages) so platform #11 needs no edits
// here either — this table is built from getPlatformMeta(), not hand-maintained.
// Shape preserved ({match, pages:{path,name}}) for the fetch loop below.

import { listFetchAllPlatforms, getPlatformMeta } from '../opportunities/registry';

export interface ScraperPage {
  path: string;
  name: string;
}

export interface ScraperRoute {
  match: (url: string) => boolean;
  pages: ScraperPage[];
}

function pagesFor(key: string): ScraperPage[] {
  const meta = getPlatformMeta(key);
  const paths = meta?.enrichPages ?? [''];
  return paths.map((p) => ({ path: p, name: p ? p.replace(/^\//, '') : 'overview' }));
}

/** Built from registry at import time (no per-platform edits). */
export const SCRAPER_PAGE_ROUTES: ScraperRoute[] = listFetchAllPlatforms()
  .filter((k) => k !== 'INTERNSHALA' && k !== 'WELLFOUND' && k !== 'UNSTOP_INTERNSHIP')
  .map((key) => {
    const needle = (() => {
      if (key === 'DEVFOLIO') return '.devfolio.co';
      if (key === 'DEVPOST') return 'devpost.com';
      if (key === 'MLH') return 'mlh.io';
      if (key === 'UNSTOP') return 'unstop.com';
      if (key === 'HACK2SKILL') return 'hack2skill.com';
      if (key === 'DORAHACKS') return 'dorahacks.io';
      if (key === 'HACKEREARTH') return 'hackerearth.com';
      return key.toLowerCase();
    })();
    return {
      match: (u: string) => String(u || '').includes(needle),
      pages: pagesFor(key),
    };
  });

/** Internshala perk page (kept: internships route shares this table for fetch-details). */
export const INTERNSHALA_SCRAPER_ROUTE: ScraperRoute = {
  match: (u: string) => String(u || '').includes('internshala.com'),
  pages: pagesFor('INTERNSHALA'),
};

if (!SCRAPER_PAGE_ROUTES.some((r) => r.pages.some((p) => p.path === '/perks'))) {
  SCRAPER_PAGE_ROUTES.push(INTERNSHALA_SCRAPER_ROUTE);
}
