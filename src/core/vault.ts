import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

// Encrypts the application account's Pubky session (AES-256-GCM), with a key
// that lives in the environment, not in the database next to it.
function secretKey(): Buffer {
  const key = Buffer.from(process.env.NETKY_SECRET_KEY ?? '', 'base64')
  if (key.length !== 32) throw new Error('NETKY_SECRET_KEY is not configured.')
  return key
}

export function hasSecretKey(): boolean {
  return Buffer.from(process.env.NETKY_SECRET_KEY ?? '', 'base64').length === 32
}

export function encrypt(plain: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', secretKey(), iv)
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64')
}

export function decrypt(stored: string): string {
  const raw = Buffer.from(stored, 'base64')
  const decipher = createDecipheriv(
    'aes-256-gcm',
    secretKey(),
    raw.subarray(0, 12),
  )
  decipher.setAuthTag(raw.subarray(12, 28))
  return Buffer.concat([
    decipher.update(raw.subarray(28)),
    decipher.final(),
  ]).toString('utf8')
}
