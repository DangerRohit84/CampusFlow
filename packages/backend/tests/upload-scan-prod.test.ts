/**
 * Prod regression: magic-byte scan must work when `file-type` ESM import
 * fails in tsc-built dist (require vs ESM-only) — Render prod blocked
 * timetable uploads with "Unable to verify file type (scan unavailable)".
 *
 * Simulates prod dist by mocking `file-type` to throw on import (what
 * `require('file-type')` does in CommonJS dist: ERR_PACKAGE_PATH_NOT_EXPORTED).
 * Pure-local fallback must still verify PNG/JPG/WEBP/PDF/ZIP.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('file-type', () => {
  throw new Error('mocked file-type unavailable (prod dist simulation: require ESM-only fails)');
});

// Import AFTER mock so validate hits the catch path.
import { validateUploadMagicBytes } from '../src/utils/uploadScan';

const png = Buffer.from([
  137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 10, 0, 0, 0, 10, 8, 2, 0, 0, 0,
]);
const jpg = Buffer.from([255, 216, 255, 224, 0, 16, 74, 70, 73, 70, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]);
const webp = Buffer.concat([
  Buffer.from('RIFF', 'ascii'),
  Buffer.from([20, 0, 0, 0]),
  Buffer.from('WEBPVP8 ', 'ascii'),
  Buffer.alloc(16, 1),
]);
const pdf = Buffer.from('%PDF-1.4 fake timetable export');
const zip = Buffer.from([0x50, 0x4b, 0x03, 0x04, 20, 0, 6, 0, 8, 0, 33, 0]);

describe('uploadScan prod fallback (file-type unavailable)', () => {
  it('timetable PNG photo passes with STRICT=true (no scan unavailable)', async () => {
    process.env.UPLOAD_SCAN_STRICT = 'true';
    try {
      const err = await validateUploadMagicBytes(png, 'photo.png', 'image/png', 'rooms');
      expect(err).toBeNull();
    } finally {
      delete process.env.UPLOAD_SCAN_STRICT;
    }
  });

  it('JPG photo passes with STRICT=true', async () => {
    process.env.UPLOAD_SCAN_STRICT = 'true';
    try {
      const err = await validateUploadMagicBytes(jpg, 'timetable.jpg', 'image/jpeg', 'rooms');
      expect(err).toBeNull();
    } finally {
      delete process.env.UPLOAD_SCAN_STRICT;
    }
  });

  it('WEBP photo passes (timetable multer allows webp)', async () => {
    process.env.UPLOAD_SCAN_STRICT = 'true';
    try {
      const err = await validateUploadMagicBytes(webp, 'timetable.webp', 'image/webp', 'rooms');
      expect(err).toBeNull();
    } finally {
      delete process.env.UPLOAD_SCAN_STRICT;
    }
  });

  it('PDF passes with STRICT=true', async () => {
    process.env.UPLOAD_SCAN_STRICT = 'true';
    try {
      const err = await validateUploadMagicBytes(pdf, 'notes.pdf', 'application/pdf', 'rooms');
      expect(err).toBeNull();
    } finally {
      delete process.env.UPLOAD_SCAN_STRICT;
    }
  });

  it('office zip (docx) passes with STRICT=true', async () => {
    process.env.UPLOAD_SCAN_STRICT = 'true';
    try {
      const err = await validateUploadMagicBytes(zip, 'notes.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'rooms');
      expect(err).toBeNull();
    } finally {
      delete process.env.UPLOAD_SCAN_STRICT;
    }
  });

  it('still blocks real mismatch (html bytes as .pdf) even without file-type', async () => {
    const html = Buffer.from('<html><body>hi</body></html> '.repeat(20));
    const err = await validateUploadMagicBytes(html, 'evil.pdf', 'application/pdf', 'rooms');
    expect(err).not.toBeNull();
  });

  it('still blocks EICAR-style push via scan stub path', async () => {
    const eicar = Buffer.from('X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*');
    const err = await validateUploadMagicBytes(eicar, 'photo.png', 'image/png', 'rooms');
    // EICAR inside png name: heuristic scan runs after local detect (png allowed)
    // but stub must still catch the signature -> blocked (not scan-unavailable).
    expect(err).not.toBeNull();
    expect(String(err)).not.toMatch(/scan unavailable/i);
  });

  it('never returns scan-unavailable for known image magic (fail-open only for truly unknown)', async () => {
    process.env.UPLOAD_SCAN_STRICT = 'true';
    try {
      for (const [buf, name, mime] of [
        [png, 'a.png', 'image/png'],
        [jpg, 'a.jpg', 'image/jpeg'],
        [webp, 'a.webp', 'image/webp'],
      ] as const) {
        const err = await validateUploadMagicBytes(buf, name, mime, 'rooms');
        expect(String(err ?? '')).not.toMatch(/scan unavailable/i);
      }
    } finally {
      delete process.env.UPLOAD_SCAN_STRICT;
    }
  });
});
