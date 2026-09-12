// opportunities/sources/searchSlug.ts — slugify leaf (no-cycle fix).
// WHY: slugify was owned by searchFetch.ts, but hack2skill.ts (which searchFetch
// needs for fetchHack2SkillRegistrationEnd) also needed slugify — mutual import
// searchFetch <-> hack2skill. Pure leaf with zero imports breaks the cycle.
// Verbatim behavior (60-char cap, Date.now fallback). searchFetch re-exports
// for compat; new code imports from here.
export function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || `hack-${Date.now().toString(36)}`
}
