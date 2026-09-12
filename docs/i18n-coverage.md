# i18n Coverage — CampusFlow (#12)

> Infra: `apps/web/src/i18n/` (`en.ts` source of truth, `index.ts` registry +
> `translate()` with en fallback, `LanguageContext.tsx` provider persisted in
> `localStorage:campusflow-lang`). No machine-translation bulk — each locale is
> a human-reviewed copy of `en.ts` with identical keys.

## Translated (en, wired)

| Area | Keys | Wired where |
|---|---|---|
| Nav | `nav.*` (23 labels) | `en.ts` source; sidebar wiring follows per-page |
| Auth | `auth.*` (13 labels) | `en.ts` source; login/register wiring follows per-page |
| Common | `common.*` (10 labels) | `en.ts` source; shared buttons/states |
| Settings | `settings.*` (13 labels) | `SettingsPage.tsx` (danger zone + language switcher fully wired) |

## Not yet translated (English fallback, no blank UI)

All other ~55 pages (Dashboard, Schedule, Chat, Assignments, Grades,
Attendance, Hackathons, Internships, Contests, Tasks, Calendar, Forms, Rooms,
Reports, Admin, SuperAdmin, Resume/Portfolio Studio, Search, Insights, …)
render hardcoded English until their strings move to `en.ts`. `translate()`
falls back to en for missing keys/locales and returns the key itself when
missing everywhere (never throws).

## Adding a language

1. Copy `apps/web/src/i18n/en.ts` → `<locale>.ts` (translate values only).
2. Register in `apps/web/src/i18n/index.ts` (`SUPPORTED_LOCALES` + `LOCALES`).
3. No provider change needed — `LanguageProvider` reads stored locale and
   sets `document.documentElement.lang`.
4. Add `src/i18n/en.test.ts`-style assertions for the new locale's coverage.
