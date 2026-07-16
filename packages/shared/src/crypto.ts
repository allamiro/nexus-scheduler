import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  pbkdf2Sync,
  randomBytes,
  scryptSync,
} from "node:crypto";

// AES-256-GCM for at-rest encryption of LibreChat API keys (REQUIREMENTS
// §4) and other secrets stored in Postgres. AES-256-GCM is a FIPS-approved
// mode (REQUIREMENTS §10) — final FIPS-module wiring happens at the
// container/runtime level (Node built in FIPS mode), not in this code.
//
// The KDF has to be FIPS-approved too, or that wiring can never actually be
// switched on: scrypt is not, so under a FIPS-enabled OpenSSL it fails with
// `error:0308010C:digital envelope routines::unsupported` and *nothing* can
// be encrypted or decrypted. PBKDF2-HMAC-SHA256 is approved (SP 800-132) and,
// like scrypt, is a deliberately-stretching KDF — the master key below is
// only length-checked, never entropy-checked, so that stretching is doing
// real work and HKDF (fast, and meant for already-high-entropy input) would
// be the wrong trade here.
//
// `masterKey` is expected to come from API_KEY_ENCRYPTION_KEY (a K8s
// Secret in production, a randomly generated value in the local Compose
// setup — REQUIREMENTS §9) — never hardcoded or defaulted here.

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const SALT = "nexus-scheduler-static-salt-v1"; // fixed salt is fine: the secret is the master key, not the salt
const MIN_MASTER_KEY_LENGTH = 32;

// OWASP's floor for PBKDF2-HMAC-SHA256. Deliberately expensive, which is the
// point of a stretching KDF — see the cache below for why that cost is paid
// once per master key rather than once per secret.
const PBKDF2_ITERATIONS = 600_000;
const PBKDF2_DIGEST = "sha256";

// Ciphertexts carry no version field, so the KDF that produced one can only
// be identified by tagging the output. Values written before this change are
// bare base64 and are decrypted with scrypt; anything written now is prefixed
// and uses PBKDF2. On a FIPS host the legacy branch necessarily fails — but
// no legacy value can exist there, because writing one was already impossible.
const V2_PREFIX = "v2:";

// deriveKey is called on *every* encrypt and decrypt (the worker decrypts a
// key per run), and 600k PBKDF2 iterations is ~0.5s. The derived key is a
// pure function of the master key, and a process holds one master key for its
// lifetime, so deriving it more than once is pure waste. Keyed by master key
// rather than a single slot so tests — which mix several keys — stay correct.
const derivedKeyCache = new Map<string, Buffer>();

function assertUsableMasterKey(masterKey: string): void {
  // Each consuming service's own config schema already enforces a
  // minimum length, but that's easy to miss for a future caller (a
  // script, a test, a new service) that reaches this function directly.
  // Deriving from '' happily returns a deterministic key, silently
  // "encrypting" every secret under a globally-predictable value instead
  // of failing — this is the one place that must refuse to let that happen.
  if (masterKey.length < MIN_MASTER_KEY_LENGTH) {
    throw new Error(
      `API_KEY_ENCRYPTION_KEY must be at least ${MIN_MASTER_KEY_LENGTH} characters (got ${masterKey.length})`,
    );
  }
}

function deriveKey(masterKey: string): Buffer {
  assertUsableMasterKey(masterKey);
  const cached = derivedKeyCache.get(masterKey);
  if (cached) {
    return cached;
  }
  const key = pbkdf2Sync(masterKey, SALT, PBKDF2_ITERATIONS, 32, PBKDF2_DIGEST);
  derivedKeyCache.set(masterKey, key);
  return key;
}

// Only ever used to read secrets written before the move to PBKDF2.
function deriveLegacyScryptKey(masterKey: string): Buffer {
  assertUsableMasterKey(masterKey);
  try {
    return scryptSync(masterKey, SALT, 32);
  } catch (err) {
    // Otherwise this surfaces as a bare "invalid scrypt params", which says
    // nothing about what is actually wrong or what to do about it.
    throw new Error(
      "Failed to decrypt a secret written before the PBKDF2 migration: scrypt is unavailable " +
        "(expected when Node runs in FIPS mode, as scrypt is not FIPS-approved). Such a value " +
        "cannot have been written on this host; re-enter the secret to store it under PBKDF2. " +
        `Underlying error: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

export function encryptSecret(plaintext: string, masterKey: string): string {
  const key = deriveKey(masterKey);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return V2_PREFIX + Buffer.concat([iv, authTag, ciphertext]).toString("base64");
}

export function decryptSecret(encoded: string, masterKey: string): string {
  const isV2 = encoded.startsWith(V2_PREFIX);
  const key = isV2 ? deriveKey(masterKey) : deriveLegacyScryptKey(masterKey);
  const raw = Buffer.from(isV2 ? encoded.slice(V2_PREFIX.length) : encoded, "base64");
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
