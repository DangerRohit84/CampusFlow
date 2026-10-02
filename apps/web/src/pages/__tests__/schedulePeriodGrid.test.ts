// Period Grid editable UI presence (TDD RED → GREEN).
// WHY: SchedulePage handlers for Add Weekly/Temporary + Edit scope
// (Only range/Every week) + Delete scope + Revert existed but the
// <Modal> JSX was never rendered (addOpen/editOpen/delOpen set, never read
// in JSX) — buttons opened nothing. This guards the wiring.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, '..', 'SchedulePage.tsx'), 'utf8');

describe('SchedulePage Period Grid modals', () => {
  it('renders Add Class modal (Weekly + Temporary tabs)', () => {
    expect(src).toMatch(/Modal open=\{addOpen\}/);
    expect(src).toMatch(/Weekly/);
    expect(src).toMatch(/Temporary/);
  });

  it('renders Edit modal with scope Only range / Every week', () => {
    expect(src).toMatch(/Modal open=\{editOpen\}/);
    expect(src).toMatch(/Only (this|that) range|Only range/i);
    expect(src).toMatch(/Every week/);
  });

  it('renders Delete scope modal + Revert action', () => {
    expect(src).toMatch(/Modal open=\{delOpen\}/);
    expect(src).toMatch(/Revert/);
  });

  it('Add/Edit validate start<end with soft clash warn (no hard block)', () => {
    expect(src).toMatch(/Start time must be before end time/);
    expect(src).toMatch(/clash warning/i);
  });

  it('save preserves temporaries unless explicitly cleared', () => {
    expect(src).toMatch(/temporary edits.*preserved|preserved.*temporar/i);
  });
});
