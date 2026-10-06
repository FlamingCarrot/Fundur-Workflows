import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "crypto";

/**
 * Encryption for secrets kept in the database, such as AI provider keys.
 * AES-256-GCM, so a changed ciphertext fails to decrypt instead of returning
 * garbage. The key is SETTINGS_ENCRYPTION_KEY (32 bytes as base64 or hex) when
 * set, otherwise derived from AUTH0_SECRET so that a deployment with sign-in
 * works without another variable. Changing whichever is in use makes saved
 * secrets unreadable; they then have to be entered again.
 */

const VERSION = "v1";

function keyMaterial(): Buffer {
  const explicit = process.env.SETTINGS_ENCRYPTION_KEY?.trim();
  if (explicit) {
    const buf = /^[0-9a-f]{64}$/i.test(explicit) ? Buffer.from(explicit, "hex") : Buffer.from(explicit, "base64");
    if (buf.length !== 32) throw new Error("SETTINGS_ENCRYPTION_KEY must be 32 bytes, as hex or base64");
    return buf;
  }
  const base = process.env.AUTH0_SECRET;
  if (!base) throw new Error("Set SETTINGS_ENCRYPTION_KEY or AUTH0_SECRET to store secrets");
  return Buffer.from(hkdfSync("sha256", base, "fundur-settings", "provider-keys", 32));
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyMaterial(), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [VERSION, iv.toString("base64"), cipher.getAuthTag().toString("base64"), data.toString("base64")].join(":");
}

export function decryptSecret(sealed: string): string {
  const [version, iv, tag, data] = sealed.split(":");
  if (version !== VERSION || !iv || !tag || data === undefined) throw new Error("Unrecognised secret format");
  const decipher = createDecipheriv("aes-256-gcm", keyMaterial(), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]).toString("utf8");
}

/** The end of a key, enough to tell two keys apart and no more. */
export function keyHint(key: string): string {
  return key.length > 8 ? `…${key.slice(-4)}` : "…";
}
