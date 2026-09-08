import { randomBytes } from "node:crypto";

const ALPHABET = "abcdefghijklmnopqrstuvwxyz234567";

export function slugifyInstallationName(value) {
  const slug = value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 10)
    .replace(/-+$/gu, "");
  if (!slug)
    throw new Error("Installation name must contain a letter or digit.");
  return slug;
}

export function randomBase32(length = 12, bytes = randomBytes(length)) {
  let output = "";
  for (let index = 0; index < length; index += 1)
    output += ALPHABET[bytes[index] % ALPHABET.length];
  return output;
}

export function installationNames(label, suffix = randomBase32()) {
  if (!/^[a-z2-7]{12}$/u.test(suffix))
    throw new Error(
      "Installation suffix must be 12 lowercase base32 characters.",
    );
  const root = `pf-${slugifyInstallationName(label)}-${suffix}`;
  return {
    root,
    worker: root,
    database: `${root}-db`,
    bucket: `${root}-sources`,
    workflow: `${root}-generation`,
  };
}
