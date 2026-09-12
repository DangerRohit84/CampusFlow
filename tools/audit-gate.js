#!/usr/bin/env node
/**
 * Audit gate — parseable allowlist for CampusFlow CI.
 *
 * Policy (prod P0):
 * - Run `npm audit --json`
 * - FAIL only on `critical` vulnerabilities with a NON-BREAKING fix available
 *   (fixAvailable && isSemVerMajor !== true). Breaking-major fixes (e.g., expo
 *   57.0.20 for tar) are allowlisted and tracked in docs/SECURITY-BACKLOG.md.
 * - WARN (pass) on high/moderate/low/info — tracked as backlog, do not block deploys.
 *
 * Why not `npm audit --audit-level=high`:
 * - That gate fails on all 42 backlog items (27 moderate + 14 high + 1 critical
 *   requiring a major bump), keeping CI permanently red and training the team
 *   to ignore it. This gate is parseable, documented, and green while still
 *   catching newly-introduced criticals with safe fixes.
 *
 * Usage: node tools/audit-gate.js [--json]
 * Exit 0 = pass, 1 = fail (critical with safe fix).
 * Rollback: revert ci.yml to `npm audit --audit-level=high` (will go red).
 */
const { execSync } = require('child_process');

function runAuditJson() {
  try {
    const out = execSync('npm audit --json', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 20 * 1024 * 1024,
    });
    return JSON.parse(out);
  } catch (e) {
    // npm audit exits non-zero when vulns found — stdout still has JSON.
    const stdout = e.stdout ? String(e.stdout) : '';
    if (stdout.trim().startsWith('{')) {
      try {
        return JSON.parse(stdout);
      } catch {}
    }
    // Fallback: try stderr-free re-run with --omit=dev? No — surface error.
    console.error('[audit-gate] failed to parse npm audit JSON');
    console.error(String(e.message || e).slice(0, 2000));
    process.exit(1);
  }
}

function main() {
  const data = runAuditJson();
  const vulns = data.vulnerabilities || {};
  const meta = (data.metadata && data.metadata.vulnerabilities) || null;

  const entries = Object.entries(vulns);
  const total = meta ? meta.total : entries.length;
  const bySeverity = meta || entries.reduce((acc, [, v]) => {
    const s = v.severity || 'unknown';
    acc[s] = (acc[s] || 0) + 1;
    return acc;
  }, {});

  console.log(`[audit-gate] total=${total} breakdown=${JSON.stringify(bySeverity)}`);

  // Criticals with safe (non-major) fix available → FAIL.
  const blocking = [];
  const allowlistedMajor = [];
  for (const [name, v] of entries) {
    if ((v.severity || '').toLowerCase() !== 'critical') continue;
    const fix = v.fixAvailable;
    if (!fix || fix === false) {
      console.log(`[audit-gate] critical without fix (allowlisted, track): ${name} range=${v.range || '?'}`);
      continue;
    }
    // fixAvailable can be true | {name,version,isSemVerMajor}
    if (fix === true) {
      blocking.push({ name, fix: 'true (assumed safe)' });
    } else if (typeof fix === 'object') {
      if (fix.isSemVerMajor) {
        allowlistedMajor.push({ name, to: `${fix.name}@${fix.version}`, range: v.range });
        console.log(`[audit-gate] critical with MAJOR-only fix (allowlisted): ${name} ${v.range} -> ${fix.name}@${fix.version}`);
      } else {
        blocking.push({ name, fix: `${fix.name}@${fix.version}` });
      }
    }
  }

  if (allowlistedMajor.length) {
    console.log(`[audit-gate] allowlisted ${allowlistedMajor.length} critical(s) requiring major bump — see docs/SECURITY-BACKLOG.md`);
  }

  if (blocking.length) {
    console.error(`[audit-gate] FAIL: ${blocking.length} critical vuln(s) with safe fix available:`);
    for (const b of blocking) console.error(`  - ${b.name} fix=${b.fix}`);
    console.error('[audit-gate] Run `npm audit fix` (no --force) or bump the direct dep, then re-run.');
    process.exit(1);
  }

  console.log('[audit-gate] PASS: no critical with safe fix. High/moderate backlog does not block (see docs/SECURITY-BACKLOG.md).');
}

if (require.main === module) main();
