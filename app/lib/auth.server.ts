const encoder = new TextEncoder();
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const PBKDF2_ITERATIONS = 100_000;

type TimingSafeSubtle = SubtleCrypto & {
  timingSafeEqual(
    a: ArrayBuffer | ArrayBufferView,
    b: ArrayBuffer | ArrayBufferView,
  ): boolean;
};

export type SessionPayload = { sid: string; exp: number };

export function normalizeMnemonic(value: string): string {
  return value
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase("und")
    .replace(/\s+/gu, " ");
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

function base64UrlToBytes(value: string): Uint8Array {
  const padded = value
    .replaceAll("-", "+")
    .replaceAll("_", "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

export async function derivePhraseVerifier(
  phrase: string,
  salt: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(normalizeMnemonic(phrase)),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const saltBytes = new Uint8Array(base64UrlToBytes(salt));
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: saltBytes,
      iterations: PBKDF2_ITERATIONS,
    },
    key,
    256,
  );
  return bytesToBase64Url(new Uint8Array(bits));
}

async function fixedHash(value: string): Promise<ArrayBuffer> {
  return crypto.subtle.digest("SHA-256", encoder.encode(value));
}

export async function timingSafeStringEqual(
  left: string,
  right: string,
): Promise<boolean> {
  const [leftHash, rightHash] = await Promise.all([
    fixedHash(left),
    fixedHash(right),
  ]);
  const subtle = crypto.subtle as TimingSafeSubtle;
  if (typeof subtle.timingSafeEqual === "function")
    return subtle.timingSafeEqual(leftHash, rightHash);
  const leftBytes = new Uint8Array(leftHash);
  const rightBytes = new Uint8Array(rightHash);
  let difference = 0;
  for (let index = 0; index < leftBytes.length; index++)
    difference |= leftBytes[index]! ^ rightBytes[index]!;
  return difference === 0;
}

export async function verifyPhrase(
  phrase: string,
  salt: string,
  expectedVerifier: string,
): Promise<boolean> {
  const actual = await derivePhraseVerifier(phrase, salt);
  return timingSafeStringEqual(actual, expectedVerifier);
}

async function hmac(value: string, signingKey: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(signingKey),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return bytesToBase64Url(
    new Uint8Array(
      await crypto.subtle.sign("HMAC", key, encoder.encode(value)),
    ),
  );
}

export async function signSession(
  signingKey: string,
  now = Date.now(),
  sessionId = crypto.randomUUID(),
): Promise<{ value: string; cookie: string }> {
  const payload = bytesToBase64Url(
    encoder.encode(
      JSON.stringify({
        sid: sessionId,
        exp: now + SESSION_TTL_MS,
      } satisfies SessionPayload),
    ),
  );
  const value = `${payload}.${await hmac(payload, signingKey)}`;
  return {
    value,
    cookie: `bpmn_session=${value}; Path=/; Max-Age=${SESSION_TTL_MS / 1000}; HttpOnly; Secure; SameSite=Strict`,
  };
}

export async function verifySession(
  value: string | null,
  signingKey: string,
  now = Date.now(),
): Promise<SessionPayload | null> {
  if (!value) return null;
  const [payload, signature, extra] = value.split(".");
  if (
    !payload ||
    !signature ||
    extra ||
    !(await timingSafeStringEqual(signature, await hmac(payload, signingKey)))
  )
    return null;
  try {
    const decoded = JSON.parse(
      new TextDecoder().decode(base64UrlToBytes(payload)),
    ) as Partial<SessionPayload>;
    if (
      typeof decoded.sid !== "string" ||
      typeof decoded.exp !== "number" ||
      decoded.exp < now
    )
      return null;
    return { sid: decoded.sid, exp: decoded.exp };
  } catch {
    return null;
  }
}

export function readCookie(request: Request, name: string): string | null {
  const pair = request.headers
    .get("Cookie")
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`));
  return pair ? pair.slice(name.length + 1) : null;
}

export function validateMutationOrigin(request: Request): boolean {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return true;
  const origin = request.headers.get("Origin");
  return origin !== null && origin === new URL(request.url).origin;
}

export function getRequiredSecret(
  env: Env,
  name:
    | "AUTH_PHRASE_SALT"
    | "AUTH_PHRASE_VERIFIER"
    | "SESSION_SIGNING_KEY"
    | "OPENAI_API_KEY"
    | "FEEDBACK_EXPORT_TOKEN",
): string {
  const value = env[name];
  if (typeof value !== "string" || value.length === 0)
    throw new Error(`Missing required secret binding: ${name}`);
  return value;
}
