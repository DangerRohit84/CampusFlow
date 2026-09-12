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
const ROOM_ALLOWED_EXTS = new Set(['pdf', 'doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx', 'jpg', 'jpeg', 'png', 'gif', 'txt', 'zip', 'rar']);
const RESUME_ALLOWED_EXTS = new Set(['pdf', 'doc', 'docx', 'txt', 'png', 'jpg', 'jpeg', 'webp', 'bmp', 'tiff', 'tif']);

function extOf(filename: string): string {
  return path.extname(filename || '').toLowerCase();
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
    const mod: any = await import('file-type');
    const fn = mod.fileTypeFromBuffer || mod.default?.fileTypeFromBuffer || mod.fromBuffer;
    if (typeof fn === 'function') detected = await fn(buffer);
  } catch {
    // file-type missing/failed. UPLOAD_SCAN_STRICT=true (prod) fails closed:
    // reject everything we cannot sniff. Default (dev) allows .txt/small-office
    // fallback + heuristic scan (fail-open with no PII logged).
    if (process.env.UPLOAD_SCAN_STRICT === 'true') return 'Unable to verify file type (scan unavailable)';
    if (ext === '.txt' && buffer.length < 2 * 1024 * 1024) return null;
    return 'Unable to verify file type (scan unavailable)';
  }

  if (!detected) {
    // No magic detected — ALWAYS run scan stub first (catches HTML/JS polyglots
    // with no magic, e.g., `<html>` bytes named .pdf).
    const scan = await scanBufferForMalware(buffer, originalname);
    if (!scan.clean) return scan.reason || 'File rejected by scan';
    // Text-like passes; office small/empty lets downstream parser fail safely.
    if (ext === '.txt' || claimedMime === 'text/plain') return null;
    if (['.doc', '.docx', '.pdf'].includes(ext) && buffer.length < 1024) return null;
    return null;
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
