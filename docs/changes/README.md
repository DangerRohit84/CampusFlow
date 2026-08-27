# Change Log Index

This directory tracks changes to every file in the CampusFlow project. Each file documents what was built, what was updated, and why.

## Pages
| File | Description |
|------|-------------|
| [DashboardPage.md](DashboardPage.md) | Main dashboard with stats |
| [HackathonsPage.md](HackathonsPage.md) | Browse hackathons |
| [InternshipsPage.md](InternshipsPage.md) | Browse internships |
| [AdminOpportunitiesPage.md](AdminOpportunitiesPage.md) | Admin review page |
| [FetchPage.md](FetchPage.md) | Super admin fetch page |
| [HackathonDetailPage.md](HackathonDetailPage.md) | Hackathon detail view |
| [InternshipDetailPage.md](InternshipDetailPage.md) | Internship detail view |
| [LoginPage.md](LoginPage.md) | Login page |
| [RegisterPage.md](RegisterPage.md) | Registration page |
| [AdminPage.md](AdminPage.md) | Admin panel |
| [TeacherAssignedPage.md](TeacherAssignedPage.md) | Faculty assigned courses |
| [SettingsPage.md](SettingsPage.md) | User settings |

## Components
| File | Description |
|------|-------------|
| [Layout.md](Layout.md) | Main layout with sidebar |
| [ThemeToggle.md](ThemeToggle.md) | Dark mode toggle bulb |
| [ThemeContext.md](ThemeContext.md) | Theme context provider |
| [StatCard.md](StatCard.md) | Stat card component |
| [Badge.md](Badge.md) | Badge component |
| [FilterTabs.md](FilterTabs.md) | Tab filter component |
| [PlatformCard.md](PlatformCard.md) | Platform fetch card |
| [FetchStats.md](FetchStats.md) | Fetch stats row |
| [CommandPalette.md](CommandPalette.md) | Command palette |
| [ErrorBoundary.md](ErrorBoundary.md) | Error boundary |

## Backend
| File | Description |
|------|-------------|
| [index-ts.md](index-ts.md) | Express server entry |
| [hackathons-route.md](hackathons-route.md) | Hackathon routes |
| [internships-route.md](internships-route.md) | Internship routes |
| [fetch-route.md](fetch-route.md) | Fetch API routes |
| [opportunityAgent.md](opportunityAgent.md) | Fetch/enrich service |
| [auth-middleware.md](auth-middleware.md) | Auth middleware |
| [admin-route.md](admin-route.md) | Admin routes |
| [departments-route.md](departments-route.md) | Department routes |

## Config & Lib
| File | Description |
|------|-------------|
| [index-css.md](index-css.md) | Global styles + dark overrides |
| [tailwind-config.md](tailwind-config.md) | Tailwind theme config |
| [api-ts.md](api-ts.md) | Frontend API client |
| [parseJson.md](parseJson.md) | JSON parse utility |
| [useFilteredItems.md](useFilteredItems.md) | Filter hook |
| [index-html.md](index-html.md) | Entry HTML with dark script |

## How to Update

When you make changes to any file, update its corresponding change doc:

1. Open the relevant `.md` file
2. Add a new entry under `## Changes`
3. Format:
```
### YYYY-MM-DD — Brief Title
- What was changed
- Why it was changed
```
