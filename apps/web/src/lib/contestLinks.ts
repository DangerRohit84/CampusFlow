// lib/contestLinks.ts — contest title → contest navigation (shared helper).
// WHY: CodingContestsPage card title + CalendarPage contest event names were
// static text (no <a>) so hover/click on the name did nothing. Both now link
// to the contest's external platform URL (same dest as the card's external
// icon). One helper keeps href math in one place — no per-page drift.
// Returns null when there is no safe destination (caller renders plain text,
// never a broken/javascript: link).
export type ContestLinkLike = {
  url?: unknown;
} | null | undefined;

export function getContestHref(contest: ContestLinkLike): string | null {
  if (!contest || typeof contest !== 'object') return null;
  const raw = (contest as { url?: unknown }).url;
  if (typeof raw !== 'string') return null;
  const href = raw.trim();
  if (!href) return null;
  // WHY: allow only http(s) — blocks javascript:/data:/relative drift that
  // would navigate inside the SPA (no /contests/:id detail route exists;
  // searchRoute maps contest → /contests list by design).
  if (!/^https?:\/\//i.test(href)) return null;
  return href;
}
