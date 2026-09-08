import { randomBytes, webcrypto } from "node:crypto";

export const normalizeAuthPhrase = (phrase) =>
  phrase
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase("und")
    .replace(/\s+/gu, " ");

export const encodeSecret = (bytes) => Buffer.from(bytes).toString("base64url");

export async function deriveAuthValues(phrase, salt = randomBytes(16)) {
  const normalized = normalizeAuthPhrase(phrase);
  if (normalized.length < 12)
    throw new Error("Use a high-entropy phrase of at least 12 characters.");

  const key = await webcrypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(normalized),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const verifier = new Uint8Array(
    await webcrypto.subtle.deriveBits(
      { name: "PBKDF2", hash: "SHA-256", salt, iterations: 100_000 },
      key,
      256,
    ),
  );

  return {
    AUTH_PHRASE_SALT: encodeSecret(salt),
    AUTH_PHRASE_VERIFIER: encodeSecret(verifier),
  };
}

export const randomSecret = () => encodeSecret(randomBytes(32));
