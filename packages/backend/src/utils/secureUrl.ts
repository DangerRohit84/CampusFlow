import dns from 'dns/promises'
import net from 'net'

/**
 * SSRF protection: validates user-supplied URL before server-side fetch.
 * - Allows only http/https
 * - Blocks credentials in URL
 * - Blocks private IP literals (10/8, 172.16/12, 192.168/16, 127/8, 169.254/16, 0/8, ::1, fc00::/7, fe80::/10)
 * - Blocks well-known metadata hosts (169.254.169.254, localhost, metadata.google.internal, etc.)
 * - Resolves DNS and checks resolved IPs against private ranges (DNS rebinding protection)
 * - Optional allowlist suffix check via EXTERNAL_FETCH_ALLOWLIST env (comma-separated suffixes)
 */

const BLOCKED_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  '::1',
  '0.0.0.0',
  '169.254.169.254',
  'metadata.google.internal',
  'metadata.google',
])

// Optional allowlist: if set, URL host must end with one of these suffixes (e.g., "unstop.com,internshala.com")
// If not set, any public host is allowed.
function getAllowlist(): string[] {
  const raw = process.env.EXTERNAL_FETCH_ALLOWLIST?.trim()
  if (!raw) return []
  return raw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
}

function isIPv4(host: string): boolean {
  return net.isIP(host) === 4
}
function isIPv6(host: string): boolean {
  return net.isIP(host) === 6
}

function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split('.').map(Number)
  if (parts.length !== 4 || parts.some(n => isNaN(n) || n < 0 || n > 255)) return false
  const [a, b] = parts
  if (a === 10) return true // 10.0.0.0/8
  if (a === 127) return true // 127.0.0.0/8 loopback
  if (a === 0) return true // 0.0.0.0/8
  if (a === 169 && b === 254) return true // 169.254.0.0/16 link-local (includes 169.254.169.254)
  if (a === 192 && b === 168) return true // 192.168.0.0/16
  if (a === 172 && b >= 16 && b <= 31) return true // 172.16.0.0/12
  if (a === 100 && b >= 64 && b <= 127) return true // 100.64.0.0/10 CGNAT
  if (a === 192 && b === 0 && parts[2] === 2) return true // 192.0.2.0/24 TEST-NET-1
  if (a === 198 && b === 51 && parts[2] === 100) return true // 198.51.100.0/24
  if (a === 203 && b === 0 && parts[2] === 113) return true // 203.0.113.0/24
  if (a >= 224) return true // 224.0.0.0/4 multicast + 240.0.0.0/4 reserved
  return false
}

function isPrivateIPv6(ip: string): boolean {
  const lower = ip.toLowerCase()
  if (lower === '::1' || lower === '::ffff:127.0.0.1') return true
  if (lower.startsWith('::ffff:10.') || lower.startsWith('::ffff:192.168.') || lower.startsWith('::ffff:127.')) return true
  // fc00::/7 unique local (fc00:: - fdff:ffff:...)
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true
  // fe80::/10 link-local (fe80:: - febf:...)
  if (lower.startsWith('fe80:') || lower.startsWith('fe80::') || lower.startsWith('feb')) return true
  // ::ffff:0:0/96 + embedded v4 check already done, but also block ::ffff:169.254 etc
  if (lower.includes('169.254')) return true
  // ff00::/8 multicast
  if (lower.startsWith('ff')) return true
  return false
}

function isPrivateIP(ip: string): boolean {
  if (isIPv4(ip)) return isPrivateIPv4(ip)
  if (isIPv6(ip)) return isPrivateIPv6(ip)
  return false
}

export async function validateExternalUrl(raw: string): Promise<URL> {
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    throw new Error('Invalid URL format')
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Only http and https protocols are allowed')
  }
  if (parsed.username || parsed.password) {
    throw new Error('Credentials in URL are not allowed')
  }

  const hostname = parsed.hostname.toLowerCase()
  if (!hostname) throw new Error('Missing hostname')
  if (BLOCKED_HOSTS.has(hostname)) {
    throw new Error('Private host blocked')
  }
  // Block .internal, .local, .localhost TLDs (common internal)
  if (hostname.endsWith('.internal') || hostname.endsWith('.local') || hostname.endsWith('.localhost')) {
    throw new Error('Private host blocked')
  }

  // If hostname is IP literal, check private ranges immediately
  if (net.isIP(hostname) !== 0) {
    if (isPrivateIP(hostname)) {
      throw new Error('Private IP blocked')
    }
    // also allowlist check for IP? IPs never in allowlist, block unless explicitly allowed (not supported)
  } else {
    // DNS resolution check for DNS rebinding (resolve and verify none of the A/AAAA are private)
    try {
      const lookups = await dns.lookup(hostname, { all: true })
      for (const entry of lookups) {
        if (isPrivateIP(entry.address)) {
          throw new Error('Private IP blocked (DNS)')
        }
        // Extra: block 169.254.169.254 resolved
        if (entry.address === '169.254.169.254') {
          throw new Error('Private IP blocked (DNS)')
        }
      }
    } catch (e: any) {
      // If DNS error is our private block, rethrow
      if (e?.message && String(e.message).includes('Private IP blocked')) throw e
      // For lookup failures (ENOTFOUND, etc), let validation fail as invalid host
      // But don't leak internal details; treat as invalid
      if (e?.code === 'ENOTFOUND' || e?.code === 'EAI_AGAIN') {
        throw new Error('Unable to resolve host')
      }
      // Other DNS errors: rethrow if private, otherwise ignore and allow (to avoid blocking valid public)
      // However, if we can't verify, we should not allow blindly for metadata-like hosts — already blocked above
    }
  }

  // Allowlist suffix check (if configured)
  const allowlist = getAllowlist()
  if (allowlist.length > 0) {
    const ok = allowlist.some(suffix => hostname === suffix || hostname.endsWith('.' + suffix))
    if (!ok) {
      throw new Error(`Host not in allowlist: ${hostname}`)
    }
  }

  // Port check: block unexpected ports? Allow 80,443 plus common alt ports, but block 22,25,3306 etc implicitly via not using? We'll allow any port but not filter here.
  // Additional: block file:// etc already done via protocol

  return parsed
}

export function isPrivateIPAddress(ip: string): boolean {
  return isPrivateIP(ip)
}
