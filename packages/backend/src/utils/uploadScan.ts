/**
 * Upload hardening — magic-byte verification + malware scan stub.
 *
 * Prod P0 for 10k traffic: client Content-Type/extension are spoofable, so
 * every upload is verified server-side:
 *  1. Extension blocklist (html/svg/xml/js/mjs/css + exe/sh for submissions)
 *  2. Magic-byte check via `file-type` (detects real bytes, not claimed MIME)
 *  3. Scan stub (heuristic; replace with ClamAV/S3-Object-Lambda in prod)
 *  4. Serve with `Content-Disposition: attachment` + `X-Content-Type-Options: nosniff`
 *     (see index.ts static serve + helmet).
 *
 * Streaming cap is enforced by multer `limits.fileSize` (aborts the stream):
 *  rooms chat/resources = 10MB, resume parse/convert = 6-8MB.
 * True streaming (busboy direct-to-Cloudinary) is a follow-up — current
 * memoryStorage + limit still bounds RSS per request (10MB max).
 */
import path from 'path';

export const BLOCKED_UPLOAD_EXTENSIONS = ['.html', '.htm', '.xhtml', '.svg', '.xml', '.js', '.mjs', '.css'];
export const BLOCKED_SUBMISSION_EXTENSIONS = [...BLOCKED_UPLOAD_EXTENSIONS, '.exe', '.sh'];

// Allowed magic-byte types per upload surface. `file-type` returns ext like
// 'pdf' | 'png' | 'jpg' | 'docx' (docx is zip) — we map zip to office formats
// by extension allowlist (ooxml is a zip container, cannot distinguish alone).
// Timetable posts image/* (jpeg/png/webp/gif/bmp/tiff/heic) via multer, so
// rooms surface must allow those image magics too (was missing webp/bmp/tiff/heic).
const ROOM_ALLOWED_EXTS = new Set(['pdf', 'doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx', 'jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'tif', 'tiff', 'heic', 'heif', 'avif', 'txt', 'zip', 'rar']);
const RESUME_ALLOWED_EXTS = new Set(['pdf', 'doc', 'docx', 'txt', 'png', 'jpg', 'jpeg', 'webp', 'bmp', 'tiff', 'tif']);

function extOf(filename: string): string {
  return path.extname(filename || '').toLowerCase();
}

/**
 * Pure-local magic-byte sniffing (no external service, no deps).
 *
 * WHY: `file-type` v19 is ESM-only (exports map has `import` only, no `require`).
 * tsc `module:commonjs` rewrites `await import('file-type')` to
 * `require('file-type')` in dist (see dist/utils/uploadScan.js), which throws
 * ERR_PACKAGE_PATH_NOT_EXPORTED in prod (`node dist/index.js`), while
 * `tsx` (dev) + vitest keep native ESM import and succeed. That divergence
 * blocked ALL timetable photo uploads in prod with "scan unavailable".
 *
 * This fallback covers the upload surfaces (png/jpg/gif/webp/bmp/tiff/pdf/
 * zip-docx/rar/heic/avif + exe for mismatch-blocking) with zero deps, so
 * magic-byte verification works even when the `file-type` import fails.
 * External AV (ClamAV/S3-Object-Lambda) stays optional and separate.
 */
export function detectFileTypeLocal(buffer: Buffer): { ext: string; mime: string } | undefined {
  if (!buffer || buffer.length < 4) return undefined;
  try {
    // PNG: 89 50 4E 47 0D 0A 1A 0A
    if (
      buffer.length >= 8 &&
      buffer[0] === 0x89 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x4e &&
      buffer[3] === 0x47 &&
      buffer[4] === 0x0d &&
      buffer[5] === 0x0a &&
      buffer[6] === 0x1a &&
      buffer[7] === 0x0a
    ) {
      return { ext: 'png', mime: 'image/png' };
    }
    // JPEG: FF D8 FF
    if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
      return { ext: 'jpg', mime: 'image/jpeg' };
    }
    // GIF: GIF87a / GIF89a
    if (buffer.length >= 6) {
      const gif = buffer.toString('ascii', 0, 6);
      if (gif === 'GIF87a' || gif === 'GIF89a') return { ext: 'gif', mime: 'image/gif' };
    }
    // WEBP: RIFF xxxx WEBP
    if (
      buffer.length >= 12 &&
      buffer.toString('ascii', 0, 4) === 'RIFF' &&
      buffer.toString('ascii', 8, 12) === 'WEBP'
    ) {
      return { ext: 'webp', mime: 'image/webp' };
    }
    // BMP: BM
    if (buffer[0] === 0x42 && buffer[1] === 0x4d) {
      return { ext: 'bmp', mime: 'image/bmp' };
    }
    // TIFF LE (49 49 2A 00) / BE (4D 4D 00 2A) — file-type reports 'tif'.
    if (
      (buffer[0] === 0x49 && buffer[1] === 0x49 && buffer[2] === 0x2a && buffer[3] === 0x00) ||
      (buffer[0] === 0x4d && buffer[1] === 0x4d && buffer[2] === 0x00 && buffer[3] === 0x2a)
    ) {
      return { ext: 'tif', mime: 'image/tiff' };
    }
    // PDF: %PDF
    if (buffer.length >= 4 && buffer.toString('ascii', 0, 4) === '%PDF') {
      return { ext: 'pdf', mime: 'application/pdf' };
    }
    // ZIP (docx/xlsx/pptx/zip): PK\x03\x04 | PK\x05\x06 (empty) | PK\x07\x08 (spanned)
    if (
      buffer[0] === 0x50 &&
      buffer[1] === 0x4b &&
      ((buffer[2] === 0x03 && buffer[3] === 0x04) ||
        (buffer[2] === 0x05 && buffer[3] === 0x06) ||
        (buffer[2] === 0x07 && buffer[3] === 0x08))
    ) {
      return { ext: 'zip', mime: 'application/zip' };
    }
    // RAR: Rar!\x1A\x07\x00 | \x01
    if (
      buffer.length >= 7 &&
      buffer[0] === 0x52 &&
      buffer[1] === 0x61 &&
      buffer[2] === 0x72 &&
      buffer[3] === 0x21 &&
      buffer[4] === 0x1a &&
      buffer[5] === 0x07 &&
      (buffer[6] === 0x00 || buffer[6] === 0x01)
    ) {
      return { ext: 'rar', mime: 'application/vnd.rar' };
    }
    // EXE (MZ) — not in allowlists, so detected mismatches still block.
    if (buffer[0] === 0x4d && buffer[1] === 0x5a) {
      return { ext: 'exe', mime: 'application/x-msdownload' };
    }
    // HEIC/HEIF/AVIF/MP4 via ftyp box (offset 4 = 'ftyp', 8..12 = brand).
    if (buffer.length >= 12 && buffer.toString('ascii', 4, 8) === 'ftyp') {
      const brand = buffer.toString('ascii', 8, 12);
      if (
        ['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'hevm', 'hevs', 'mif1', 'msf1', 'heif'].includes(brand)
      ) {
        return { ext: 'heic', mime: 'image/heic' };
      }
      if (['avif', 'avis'].includes(brand)) {
        return { ext: 'avif', mime: 'image/avif' };
      }
      if (['isom', 'iso2', 'mp41', 'mp42', 'mp4v', 'avc1', 'qt  '].includes(brand)) {
        return { ext: 'mp4', mime: 'video/mp4' };
      }
    }
  } catch {
    return undefined;
  }
  return undefined;
}

/**
 * Load `file-type` via native ESM import that survives tsc CommonJS emit.
 *
 * Direct `await import('file-type')` in src compiles to
 * `require('file-type')` in dist (module:commonjs), which throws for
 * ESM-only file-type. `new Function('return import(...)')` is opaque to tsc,
 * so dist keeps a real dynamic `import()` that works in Node CJS.
 */
async function loadFileTypeModule(): Promise<any> {
  try {
    const nativeImport = new Function('s', 'return import(s)') as (s: string) => Promise<any>;
    return await nativeImport('file-type');
  } catch {
    // Fallback for locked-down Function environments (tsx/vitest path).
    return await import('file-type');
  }
}

/**
 * Malware scan STUB — heuristic only, always runs before Cloudinary/local persist.
 * Blocks obvious active content smuggled with an allowed extension:
 *  - HTML/SVG/JS polyglots (`<html`, `<svg`, `<script`, `javascript:`)
 *  - XML bombs (`<!ENTITY`, `<!DOCTYPE` with ENTITY)
 *  - EICAR test string (validates the pipeline end-to-end)
 *
 * Production hardening (fail-closed documented): heuristic + magic-byte gate above
 * is the current enforcement. Full ClamAV (clamdjs, CLAMAV_URL) or S3 Object Lambda
 * + GuardDuty Malware Protection is a separate infra PR (quarantine + metric
 * `upload.scan.blocked`). Env: UPLOAD_SCAN_STRICT=true rejects when file-type
 * sniffing is unavailable (fail-closed); default allows .txt/small-office fallback.
 * Rollback: delete calls to this function (extension + magic-byte checks remain).
 */
export async function scanBufferForMalware(
  buffer: Buffer,
  originalname: string,
): Promise<{ clean: boolean; reason?: string }> {
  if (!buffer || buffer.length === 0) return { clean: false, reason: 'empty file' };
  // EICAR standard test string — proves the scan path is wired.
  try {
    const head = buffer.subarray(0, 64 * 1024).toString('utf8', 0, Math.min(buffer.length, 64 * 1024));
    if (head.includes('X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*')) {
      return { clean: false, reason: 'EICAR test signature (scan stub)' };
    }
    const lowered = head.toLowerCase();
    // Active-content markers even inside an allowed container name.
    if (lowered.includes('<script') || lowered.includes('javascript:') || lowered.includes('<html')) {
      return { clean: false, reason: 'active content detected (script/html marker)' };
    }
    if (lowered.includes('<svg') && extOf(originalname) !== '.svg') {
      // svg bytes with non-svg name = polyglot attempt (svg ext itself is already blocked).
      return { clean: false, reason: 'embedded SVG marker' };
    }
    if (lowered.includes('<!entity')) {
      return { clean: false, reason: 'XML entity expansion attempt' };
    }
  } catch {
    // Non-UTF8 binary (images, office) — heuristics N/A, treat as clean here;
    // magic-byte check below is the authority for binaries.
  }
  return { clean: true };
}

/**
 * Verify magic bytes match the claimed upload surface.
 * Returns null when OK, or an error string when rejected.
 *
 * - Blocked extensions reject immediately (no sniffing needed).
 * - `file-type` sniffing: unknown (null) is allowed for .txt/plain (no magic),
 *   otherwise the detected ext must be in the surface allowlist.
 * - Mismatch (e.g., .pdf containing HTML) rejects.
 */
export async function validateUploadMagicBytes(
  buffer: Buffer,
  originalname: string,
  claimedMime: string,
  surface: 'rooms' | 'resume' | 'submissions' = 'rooms',
): Promise<string | null> {
  const ext = extOf(originalname);
  const blocked = surface === 'submissions' ? BLOCKED_SUBMISSION_EXTENSIONS : BLOCKED_UPLOAD_EXTENSIONS;
  if (blocked.includes(ext)) return `File type not allowed (${ext})`;

  // Plain text has no magic bytes — enforce size + scan stub only, plus
  // reject if it sniffs as HTML/XML (polyglot .txt).
  let detected: { ext?: string; mime?: string } | undefined;
  try {
    const mod: any = await loadFileTypeModule();
    const fn = mod.fileTypeFromBuffer || mod.default?.fileTypeFromBuffer || mod.fromBuffer;
    if (typeof fn === 'function') detected = await fn(buffer);
  } catch {
    // file-type import failed (prod dist: tsc CJS require vs ESM-only).
    // Fall through to pure-local sniffing below — magic-byte verification
    // must NOT depend on external service. Only when BOTH sniffers fail do
    // we apply the legacy fail-closed below.
    detected = undefined;
  }

  if (!detected) {
    try {
      detected = detectFileTypeLocal(buffer) ?? undefined;
    } catch {
      detected = undefined;
    }
  }

  if (!detected) {
    // No magic from either sniffer — could mean truly unavailable (both
    // failed) or truly unknown (text-like). Run heuristic first so
    // polyglots/EICAR still block, then fail-closed ONLY when strict and
    // we cannot verify. Legacy: strict blocks, else .txt/small-office
    // fallback. This preserves security while letting local magic succeed
    // with NO external service.
    const unavailableScan = await scanBufferForMalware(buffer, originalname);
    if (!unavailableScan.clean) return unavailableScan.reason || 'File rejected by scan';
    if (process.env.UPLOAD_SCAN_STRICT === 'true') return 'Unable to verify file type (scan unavailable)';
    if (ext === '.txt' && buffer.length < 2 * 1024 * 1024) return null;
    // Text-like passes; office small/empty lets downstream parser fail safely.
    if (ext === '.txt' || claimedMime === 'text/plain') return null;
    if (['.doc', '.docx', '.pdf'].includes(ext) && buffer.length < 1024) return null;
    return 'Unable to verify file type (scan unavailable)';
  }

  const allowed = surface === 'resume' ? RESUME_ALLOWED_EXTS : ROOM_ALLOWED_EXTS;
  // file-type reports docx/pptx/xlsx as 'zip' — accept zip when ext is office/zip/rar.
  const detectedExt = String(detected.ext || '').toLowerCase();
  const isOfficeZip = detectedExt === 'zip' && ['.docx', '.pptx', '.xlsx', '.doc', '.ppt', '.xls', '.zip'].includes(ext);
  if (!allowed.has(detectedExt) && !isOfficeZip) {
    // Explicitly call out active-content smuggling.
    if (['html', 'xml', 'svg', 'js'].includes(detectedExt)) return `File type not allowed (detected ${detectedExt})`;
    return `File content (${detectedExt}) does not match extension (${ext})`;
  }

  const scan = await scanBufferForMalware(buffer, originalname);
  if (!scan.clean) return scan.reason || 'File rejected by scan';
  return null;
}
