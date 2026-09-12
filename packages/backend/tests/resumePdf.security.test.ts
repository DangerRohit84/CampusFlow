/**
 * Track-1 C-4: resumePdf pure-vector security contract (hermetic, no shell/network).
 * Locks: no pdflatex spawn (RCE), no latexonline PII exfil, no dynamic-code eval,
 * vector generation always %PDF via pdfkit.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  compileLatexToPdfBuffer,
  compileViaLatexOnline,
  generateVectorPdfBuffer,
  generateResumePdfWithMeta,
} from '../src/services/resumePdf';

const MALICIOUS_LATEX = [
  '\\documentclass{article}\\begin{document}\\immediate\\write18{calc.exe}\\end{document}',
  '\\input{/etc/passwd}',
  '\\include{../../secrets}',
  '\\loop\\repeat',
  '\\immediate\\openout\\foo',
].join('\n');

function minimalResume(): any {
  return {
    personalInfo: {
      fullName: 'Jane Doe',
      email: 'jane@example.com',
      phone: '+91-9999999999',
      location: 'Bengaluru, India',
      headline: 'FULL STACK DEVELOPER',
      summary: 'Results-driven student.',
      links: [{ label: 'GitHub', url: 'https://github.com/janedoe' }],
    },
    skills: ['TypeScript', 'React', 'Node.js'],
    projects: [],
    experience: [],
    education: [],
    template: 'minimal',
  };
}

describe('resumePdf C-4 no-shell/no-eval', () => {
  it('source contains no spawn/child_process/pdflatex shell', () => {
    const src = fs.readFileSync(path.join(__dirname, '../src/services/resumePdf.ts'), 'utf8');
    expect(src).not.toMatch(/from\s+['"]child_process['"]/);
    // Allow the word pdflatex only in comments/stub names + engine union strings,
    // never as a spawn argument array.
    expect(src).not.toMatch(/spawn\s*\(\s*['"]pdflatex['"]/);
    expect(src).not.toMatch(/latexonline\.cc\/compile/);
  });

  it('source contains no dynamic-code eval loader', () => {
    const src = fs.readFileSync(path.join(__dirname, '../src/services/resumePdf.ts'), 'utf8');
    // Naive SAST: ban Function constructor as code (comment mentions removed pattern
    // without the literal `Function(` — assert no code occurrence).
    const codeLines = src.split('\n').filter((l) => !l.trim().startsWith('*') && !l.trim().startsWith('//'));
    expect(codeLines.join('\n')).not.toMatch(/Function\s*\(/);
    expect(codeLines.join('\n')).not.toMatch(/eval\s*\(/);
  });

  it('compileLatexToPdfBuffer stub returns null for malicious latex (no RCE, fast)', async () => {
    const t0 = Date.now();
    const out = await compileLatexToPdfBuffer(MALICIOUS_LATEX);
    expect(out).toBeNull();
    expect(Date.now() - t0).toBeLessThan(2000);
  });

  it('compileViaLatexOnline stub returns null (no PII exfil)', async () => {
    const out = await compileViaLatexOnline(MALICIOUS_LATEX);
    expect(out).toBeNull();
  });

  it('generateVectorPdfBuffer returns selectable %PDF (minimal template)', async () => {
    const buf = await generateVectorPdfBuffer(minimalResume());
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBeGreaterThan(1000);
    expect(buf.slice(0, 4).toString()).toBe('%PDF');
  });

  it('generateResumePdfWithMeta always pdfkit-vector (ignores latex)', async () => {
    const meta = await generateResumePdfWithMeta(MALICIOUS_LATEX, minimalResume());
    expect(meta.engine).toBe('pdfkit-vector');
    expect(meta.buffer.slice(0, 4).toString()).toBe('%PDF');
  });
});
