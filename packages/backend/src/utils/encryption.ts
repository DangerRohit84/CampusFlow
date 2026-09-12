import crypto from 'crypto'

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 16
const AUTH_TAG_LENGTH = 16

function getEncryptionKey(): Buffer {
  const key = process.env.AI_ENCRYPTION_KEY
  if (!key || key.length < 32) {
    throw new Error('AI_ENCRYPTION_KEY env var must be at least 32 characters (use `openssl rand -hex 32`)')
  }
  // Fail-closed on weak/dictionary/placeholder values (C-2). Old committed
  // values like "campusflow-ai-encryption-key-2026-secure" must never boot.
  if (/campusflow|random-string|replace_me|dev-encryption|change-me|your-key|example/i.test(key)) {
    throw new Error('AI_ENCRYPTION_KEY looks like a placeholder/weak default — generate with `openssl rand -hex 32`')
  }
  // HKDF-SHA256 (node:crypto hkdfSync) — salt + info, 32B output.
  // Accepts 64-hex (preferred, 256-bit) or opaque >=32-char secret.
  const ikm: Buffer = /^[0-9a-fA-F]{64}$/.test(key.trim())
    ? Buffer.from(key.trim(), 'hex')
    : Buffer.from(key, 'utf-8')
  const salt = Buffer.from('campusflow-ai-v1-salt', 'utf-8')
  const info = Buffer.from('campusflow-ai-v1', 'utf-8')
  return Buffer.from(crypto.hkdfSync('sha256', ikm, salt, info, 32))
}

// Legacy slice-KDF for migration window only (pre-v1 rows). Do not use for new writes.
// Old code did Buffer.from(key.slice(0,32),'utf-8') — kept to decrypt rows created
// before HKDF migration; re-encrypt per docs/ROTATE-SECRETS.md §4 then remove.
function getLegacyEncryptionKey(): Buffer {
  const key = process.env.AI_ENCRYPTION_KEY || ''
  return Buffer.from(key.slice(0, 32), 'utf-8')
}

export function encryptApiKey(plain: string): string {
  const key = getEncryptionKey()
  const iv = crypto.randomBytes(IV_LENGTH)
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv)
  const encrypted = Buffer.concat([cipher.update(plain, 'utf-8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  // v1: prefix marks HKDF-derived rows (see ROTATE-SECRETS.md §4 re-encrypt).
  return `v1:${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`
}

export function decryptApiKey(cipher: string): string {
  // v1 path (HKDF)
  if (cipher.startsWith('v1:')) {
    const key = getEncryptionKey()
    const parts = cipher.slice(3).split(':')
    if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) {
      throw new Error('Invalid encrypted API key format')
    }
    const [ivHex, authTagHex, encryptedHex] = parts
    const iv = Buffer.from(ivHex, 'hex')
    const authTag = Buffer.from(authTagHex, 'hex')
    const encrypted = Buffer.from(encryptedHex, 'hex')
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv)
    decipher.setAuthTag(authTag)
    return decipher.update(encrypted) + decipher.final('utf-8')
  }
  // Legacy path (pre-v1 ASCII-slice) — decrypt-only for migration.
  const key = getLegacyEncryptionKey()
  const parts = cipher.split(':')
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) {
    throw new Error('Invalid encrypted API key format')
  }
  const [ivHex, authTagHex, encryptedHex] = parts
  const iv = Buffer.from(ivHex, 'hex')
  const authTag = Buffer.from(authTagHex, 'hex')
  const encrypted = Buffer.from(encryptedHex, 'hex')
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(authTag)
  return decipher.update(encrypted) + decipher.final('utf-8')
}

export function maskApiKey(cipher: string): string {
  try {
    const plain = decryptApiKey(cipher)
    if (plain.length <= 4) return '****'
    return `${plain.slice(0, 3)}...${plain.slice(-4)}`
  } catch {
    return '****'
  }
}
