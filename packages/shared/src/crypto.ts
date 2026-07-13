import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, scryptSync } from "node:crypto";

// AES-256-GCM for at-rest encryption of LibreChat API keys (REQUIREMENTS
// §4) and other secrets stored in Postgres. AES-256-GCM is a FIPS-approved
// mode (REQUIREMENTS §10) — final FIPS-module wiring happens at the
// container/runtime level (Node built in FIPS mode), not in this code.
//
// `masterKey` is expected to come from API_KEY_ENCRYPTION_KEY (a K8s
// Secret in production, a randomly generated value in the local Compose
// setup — REQUIREMENTS §9) — never hardcoded or defaulted here.

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const SALT = "nexus-scheduler-static-salt-v1"; // fixed salt is fine: the secret is the master key, not the salt
const MIN_MASTER_KEY_LENGTH = 32;

function deriveKey(masterKey: string): Buffer {
  // Each consuming service's own config schema already enforces a
  // minimum length, but that's easy to miss for a future caller (a
  // script, a test, a new service) that reaches this function directly.
  // scryptSync('', SALT) happily returns a deterministic key, silently
  // "encrypting" every secret under a globally-predictable value instead
  // of failing — this is the one place that must refuse to let that happen.
  if (masterKey.length < MIN_MASTER_KEY_LENGTH) {
    throw new Error(
      `API_KEY_ENCRYPTION_KEY must be at least ${MIN_MASTER_KEY_LENGTH} characters (got ${masterKey.length})`,
    );
  }
  return scryptSync(masterKey, SALT, 32);
}

export function encryptSecret(plaintext: string, masterKey: string): string {
  const key = deriveKey(masterKey);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]).toString("base64");
}

export function decryptSecret(encoded: string, masterKey: string): string {
  const key = deriveKey(masterKey);
  const raw = Buffer.from(encoded, "base64");
  const iv = raw.subarray(0, IV_LENGTH);
  const authTag = raw.subarray(IV_LENGTH, IV_LENGTH + 16);
  const ciphertext = raw.subarray(IV_LENGTH + 16);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

// Generates a fresh per-destination signing secret for outbound webhooks
// (REQUIREMENTS §2.2) — 256 bits, hex-encoded so it's easy to hand a
// receiving system for HMAC verification without any binary handling.
export function generateWebhookSecret(): string {
  return randomBytes(32).toString("hex");
}

// HMAC-SHA256 over the raw JSON body — receivers verify authenticity by
// recomputing this with the same shared secret (§2.2).
export function signWebhookPayload(rawBody: string, secret: string): string {
  return createHmac("sha256", secret).update(rawBody).digest("hex");
}

// Password-reset tokens (§4/§5): high-entropy and single-use, so a plain
// one-way hash is sufficient (and fast, unlike bcrypt/scrypt which are
// deliberately slow for low-entropy secrets like passwords) — brute-
// forcing a 256-bit random token via hash lookup isn't feasible. Only
// the hash is ever stored; the raw token exists just long enough to
// email it and immediately compare on redemption.
export function generateResetToken(): string {
  return randomBytes(32).toString("hex");
}

export function hashResetToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
