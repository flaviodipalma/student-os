import "server-only"

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto"

// Encrypts LMS tokens before they're stored, and decrypts them on the server
// only when a request needs them. Tokens are never stored in plain text, never
// sent to the browser, never put in URLs and never logged.
//
//   AES-256-GCM (authenticated encryption) with a 32-byte key from the
//   server-only LMS_TOKEN_ENCRYPTION_KEY environment variable (base64).
//   Stored as "v1:<iv>:<auth tag>:<ciphertext>" (base64 parts). The "v1" is the
//   key version, so keys can be rotated later.
//
//   Each token is bound to where it belongs ("<user id>:<provider>", as GCM
//   additional authenticated data): copying an encrypted token into another
//   student's row makes it fail to decrypt.
//
// Before production: keep the key in the hosting provider's secret store (not
// in the repo), and add key rotation (re-encrypt with "v2") if a key is exposed.

const VERSION = "v1"

export class CredentialVaultError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "CredentialVaultError"
  }
}

export type CredentialVault = {
  seal(secret: string, context: string): string
  open(sealed: string, context: string): string
}

// A vault using the given key (32 bytes). Tests pass their own key.
export function createCredentialVault(key: Buffer): CredentialVault {
  if (key.length !== 32) throw new CredentialVaultError("The token encryption key must be 32 bytes.")
  return {
    seal(secret, context) {
      const iv = randomBytes(12)
      const cipher = createCipheriv("aes-256-gcm", key, iv)
      cipher.setAAD(Buffer.from(context, "utf8"))
      const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()])
      return [VERSION, iv.toString("base64"), cipher.getAuthTag().toString("base64"), ciphertext.toString("base64")].join(":")
    },
    open(sealed, context) {
      const [version, iv, tag, ciphertext] = sealed.split(":")
      if (version !== VERSION || !iv || !tag || ciphertext === undefined) {
        throw new CredentialVaultError("Stored credentials are in an unknown format.")
      }
      try {
        const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64"))
        decipher.setAAD(Buffer.from(context, "utf8"))
        decipher.setAuthTag(Buffer.from(tag, "base64"))
        return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64")), decipher.final()]).toString("utf8")
      } catch {
        // Wrong key, wrong owner, or tampered with. Never include the data itself.
        throw new CredentialVaultError("Stored credentials couldn't be decrypted.")
      }
    },
  }
}

// The app's vault, from LMS_TOKEN_ENCRYPTION_KEY. Without a valid key there is
// no vault, and no LMS tokens can be stored (never a plain-text fallback).
export function getCredentialVault(): CredentialVault {
  const encoded = process.env.LMS_TOKEN_ENCRYPTION_KEY
  if (!encoded) throw new CredentialVaultError("LMS_TOKEN_ENCRYPTION_KEY isn't set, so LMS tokens can't be stored.")
  return createCredentialVault(Buffer.from(encoded, "base64"))
}

// Where a connection's tokens belong, for binding the ciphertext to it.
export const credentialContext = (userId: string, provider: string) => `${userId}:${provider}`
