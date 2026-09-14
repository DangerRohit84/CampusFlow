/**
 * upload-audit-all — per-path regression for the prod-safe upload treatment.
 *
 * Timetable got 4 fixes (magic-byte ESM-safe scan, inline-base64 vision,
 * tolerant reader, 60s timeout). This file locks the SAME treatment on every
 * other upload path:
 *  - resume /upload alias + /convert-to-latex now run the shared
 *    validateUploadMagicBytes (previously unscanned).
 *  - attendance/grades /parse (JSON base64) now run the shared scanner
 *    (previously unscanned) + drift-tolerant normalizers.
 *  - rooms resources route + chat share one scanner; filter accepts the same
 *    image magics the scanner allowlists.
 *
 * Vision inline-base64 is centralized in ai/client normalizeVisionMessages
 * (covered by ai-vision.test.ts) — attendance/grades/timetable all send
 * data-URL image_url parts through it, so no per-route vision test here.
 */
import { describe, it, expect } from 'vitest';

import { validateUploadMagicBytes } from '../src/utils/uploadScan';
import { normalizeAttendanceSubjects } from '../src/routes/attendance';
import { normalizeGradeSubjects } from '../src/routes/grades';

const png = Buffer.from([
  137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 10, 0, 0, 0, 10, 8, 2, 0, 0, 0,
]);
const jpg = Buffer.from([255, 216, 255, 224, 0, 16, 74, 70, 73, 70, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]);
const pdf = Buffer.from('%PDF-1.4 fake resume export');
const zip = Buffer.from([0x50, 0x4b, 0x03, 0x04, 20, 0, 6, 0, 8, 0, 33, 0]);
const htmlAsPdf = Buffer.from('<html><body>smuggled</body></html> '.repeat(20));
const exeAsPng = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00, 0x04, 0x00, 0x00, 0x00]);
const EICAR = Buffer.from('X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*');

describe('resume upload paths share one scanner', () => {
  it('/parse + /upload alias: PDF passes on resume surface', async () => {
    expect(await validateUploadMagicBytes(pdf, 'resume.pdf', 'application/pdf', 'resume')).toBeNull();
  });

  it('/parse + /upload alias: DOCX (zip) passes on resume surface', async () => {
    expect(
      await validateUploadMagicBytes(zip, 'resume.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'resume'),
    ).toBeNull();
  });

  it('/upload alias: HTML smuggled as .pdf is blocked (was unscanned)', async () => {
    const err = await validateUploadMagicBytes(htmlAsPdf, 'evil.pdf', 'application/pdf', 'resume');
    expect(err).not.toBeNull();
  });

  it('/convert-to-latex image branch: PNG passes on rooms surface', async () => {
    expect(await validateUploadMagicBytes(png, 'scan.png', 'image/png', 'rooms')).toBeNull();
  });

  it('/convert-to-latex: EICAR test signature is blocked on both surfaces', async () => {
    expect(await validateUploadMagicBytes(EICAR, 'eicar.pdf', 'application/pdf', 'resume')).not.toBeNull();
    expect(await validateUploadMagicBytes(EICAR, 'eicar.png', 'image/png', 'rooms')).not.toBeNull();
  });
});

describe('attendance/grades JSON-base64 images share the scanner', () => {
  it('attendance photo (PNG/JPG) passes rooms surface', async () => {
    expect(await validateUploadMagicBytes(png, 'photo.png', 'image/png', 'rooms')).toBeNull();
    expect(await validateUploadMagicBytes(jpg, 'photo.jpg', 'image/jpeg', 'rooms')).toBeNull();
  });

  it('attendance spoof (EXE bytes as photo) is blocked before vision', async () => {
    expect(await validateUploadMagicBytes(exeAsPng, 'photo.png', 'image/png', 'rooms')).not.toBeNull();
  });

  it('grades transcript photo passes rooms surface', async () => {
    expect(await validateUploadMagicBytes(jpg, 'grades.jpg', 'image/jpeg', 'rooms')).toBeNull();
  });
});

describe('submissions scanner unchanged (sanity: still blocks exe)', () => {
  it('exe bytes are rejected on submissions surface', async () => {
    expect(await validateUploadMagicBytes(exeAsPng, 'run.exe', 'application/x-msdownload', 'submissions')).not.toBeNull();
  });

  it('pdf passes on submissions surface', async () => {
    expect(await validateUploadMagicBytes(pdf, 'essay.pdf', 'application/pdf', 'submissions')).toBeNull();
  });
});

describe('normalizeAttendanceSubjects (backend half)', () => {
  it('passes canonical rows through with numeric counts', () => {
    const out = normalizeAttendanceSubjects([
      { name: 'Math', held: 40, attended: 35 },
      { name: 'Physics', held: 30, attended: 30 },
    ]);
    expect(out).toEqual([
      { name: 'Math', held: 40, attended: 35 },
      { name: 'Physics', held: 30, attended: 30 },
    ]);
  });

  it('coerces drifted keys (subject/total/present, numeric strings)', () => {
    const out = normalizeAttendanceSubjects([
      { subject: 'Chemistry', total: '42', present: '40' },
      { course: 'Bio', classes: 20, attend: 18 },
    ]);
    expect(out).toEqual([
      { name: 'Chemistry', held: 42, attended: 40 },
      { name: 'Bio', held: 20, attended: 18 },
    ]);
  });

  it('drops junk rows and never throws (null/string/bare object → [])', () => {
    expect(normalizeAttendanceSubjects([{ foo: 1 }, null, 42])).toEqual([]);
    expect(normalizeAttendanceSubjects(null)).toEqual([]);
    expect(normalizeAttendanceSubjects('oops')).toEqual([]);
    expect(normalizeAttendanceSubjects({ subjects: [] })).toEqual([]);
  });
});

describe('normalizeGradeSubjects (backend half)', () => {
  it('passes canonical rows through', () => {
    const out = normalizeGradeSubjects([{ name: 'Math', code: 'MA101', credits: 4, grade: 'A' }]);
    expect(out).toEqual([{ name: 'Math', code: 'MA101', credits: 4, grade: 'A' }]);
  });

  it('coerces drifted keys (title/courseCode/credit/score)', () => {
    const out = normalizeGradeSubjects([
      { title: 'Physics', courseCode: 'PH101', credit: '3', score: 'B+' },
    ]);
    expect(out).toEqual([{ name: 'Physics', code: 'PH101', credits: 3, grade: 'B+' }]);
  });

  it('never throws — null/string/bare object → []', () => {
    expect(normalizeGradeSubjects([{ nope: true }])).toEqual([]);
    expect(normalizeGradeSubjects(null)).toEqual([]);
    expect(normalizeGradeSubjects('oops')).toEqual([]);
    expect(normalizeGradeSubjects(undefined)).toEqual([]);
  });
});
