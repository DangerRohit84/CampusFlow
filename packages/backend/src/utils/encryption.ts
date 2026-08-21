import crypto from 'crypto'

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 16
const AUTH_TAG_LENGTH = 16

function getEncryptionKey(): Buffer {
  const key = process.env.AI_ENCRYPTION_KEY
  if (!key || key.length < 32) {
    throw new Error('AI_ENCRYPTION_KEY env var must be at least 32 characters')
  }
  return Buffer.from(key.slice(0, 32), 'utf-8')
}

export function encryptApiKey(plain: string): string {
  const key = getEncryptionKey()
  const iv = crypto.randomBytes(IV_LENGTH)
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv)
  const encrypted = Buffer.concat([cipher.update(plain, 'utf-8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`
}

export function decryptApiKey(cipher: string): string {
  const key = getEncryptionKey()
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
