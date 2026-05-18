const PASSWORD_HASH_CONFIG = { logN: 15, r: 8, p: 1 }

async function scryptKdf() {
  const scrypt = await import("scrypt-kdf")
  return ((scrypt as any).default ?? scrypt) as {
    kdf: (
      passphrase: string | Uint8Array,
      options?: typeof PASSWORD_HASH_CONFIG
    ) => Promise<Uint8Array>
    verify: (
      key: string | Uint8Array,
      passphrase: string | Uint8Array
    ) => Promise<boolean>
  }
}

export async function hashEmailpassPassword(password: string) {
  const kdf = await scryptKdf()
  const passwordHash = await kdf.kdf(password, PASSWORD_HASH_CONFIG)
  return Buffer.from(passwordHash as any).toString("base64")
}

export async function verifyEmailpassPasswordHash(
  passwordHash: string,
  password: string
) {
  const kdf = await scryptKdf()
  return kdf.verify(Buffer.from(passwordHash, "base64"), password)
}

