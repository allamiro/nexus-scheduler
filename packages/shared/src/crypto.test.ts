import { createCipheriv, getFips, randomBytes, scryptSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  decryptSecret,
  encryptSecret,
  generateResetToken,
  generateWebhookSecret,
  hashResetToken,
  signWebhookPayload,
} from "./crypto.js";

const VALID_KEY = "a-valid-32-character-master-key!!";

// Reproduces the pre-PBKDF2 on-disk format (scrypt-derived key, bare base64,
// no version prefix) so the legacy read path is exercised against a real
// value rather than a hand-written constant that could drift.
function encryptLegacyScrypt(plaintext: string, masterKey: string): string {
  const key = scryptSync(masterKey, "nexus-scheduler-static-salt-v1", 32);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64");
}

// scrypt is not FIPS-approved, so on a FIPS host these cannot run at all —
// which is the whole point of this change. Skipped rather than failed: a
// legacy value could never have been written on such a host either.
const describeLegacy = getFips() ? describe.skip : describe;

describe("encryptSecret / decryptSecret", () => {
  it("round-trips a plaintext secret", () => {
    const plaintext = "sk-super-secret-librechat-api-key";
    const encrypted = encryptSecret(plaintext, VALID_KEY);
    expect(encrypted).not.toContain(plaintext);
    expect(decryptSecret(encrypted, VALID_KEY)).toBe(plaintext);
  });

  it("round-trips an empty string", () => {
    const encrypted = encryptSecret("", VALID_KEY);
    expect(decryptSecret(encrypted, VALID_KEY)).toBe("");
  });

  it("produces different ciphertext for the same plaintext on each call (random IV)", () => {
    const a = encryptSecret("same plaintext", VALID_KEY);
    const b = encryptSecret("same plaintext", VALID_KEY);
    expect(a).not.toBe(b);
    expect(decryptSecret(a, VALID_KEY)).toBe("same plaintext");
    expect(decryptSecret(b, VALID_KEY)).toBe("same plaintext");
  });

  it("fails to decrypt with the wrong master key", () => {
    const encrypted = encryptSecret("secret", VALID_KEY);
    const otherKey = "a-different-32-character-master!!";
    expect(() => decryptSecret(encrypted, otherKey)).toThrow();
  });

  it("fails to decrypt tampered ciphertext (GCM auth tag check)", () => {
    const encrypted = encryptSecret("secret", VALID_KEY);
    // Strip the version prefix before decoding and restore it afterwards:
    // base64-decoding the prefixed string would silently drop the marker and
    // send the value down the legacy path, so this would pass without ever
    // testing the auth tag.
    const raw = Buffer.from(encrypted.slice("v2:".length), "base64");
    // Flip a bit somewhere in the ciphertext portion (past IV + auth tag).
    raw[raw.length - 1] = raw[raw.length - 1]! ^ 0xff;
    const tampered = `v2:${raw.toString("base64")}`;
    expect(() => decryptSecret(tampered, VALID_KEY)).toThrow();
  });

  // The stored format is the compatibility contract: without a marker there
  // is no way to tell which KDF produced a value, so this is load-bearing
  // rather than cosmetic.
  it("tags new ciphertext with the v2 prefix", () => {
    expect(encryptSecret("secret", VALID_KEY)).toMatch(/^v2:/);
  });

  // Regression for #16: an empty or too-short master key used to derive
  // a silently "working" but globally-predictable key via
  // scryptSync('', SALT) instead of failing loudly.
  it("throws on an empty master key instead of silently deriving a predictable key", () => {
    expect(() => encryptSecret("secret", "")).toThrow(/at least 32 characters/);
  });

  it("throws on a master key shorter than 32 characters", () => {
    expect(() => encryptSecret("secret", "short-key")).toThrow(/at least 32 characters/);
  });

  it("accepts a master key exactly at the 32-character minimum", () => {
    const exactly32 = "12345678901234567890123456789012";
    expect(exactly32).toHaveLength(32);
    const encrypted = encryptSecret("secret", exactly32);
    expect(decryptSecret(encrypted, exactly32)).toBe("secret");
  });
});

// Secrets written before this change must stay readable — an unreadable
// LibreChat key means every scheduled run for that key silently starts failing.
describeLegacy("backward compatibility with scrypt-era secrets", () => {
  it("decrypts a legacy (unprefixed, scrypt-derived) ciphertext", () => {
    const legacy = encryptLegacyScrypt("sk-legacy-key", VALID_KEY);
    expect(legacy).not.toMatch(/^v2:/);
    expect(decryptSecret(legacy, VALID_KEY)).toBe("sk-legacy-key");
  });

  it("still rejects a legacy ciphertext under the wrong master key", () => {
    const legacy = encryptLegacyScrypt("sk-legacy-key", VALID_KEY);
    expect(() => decryptSecret(legacy, "a-different-32-character-master!!")).toThrow();
  });

  it("re-encrypting a legacy secret upgrades it to the v2 format", () => {
    const legacy = encryptLegacyScrypt("sk-legacy-key", VALID_KEY);
    const upgraded = encryptSecret(decryptSecret(legacy, VALID_KEY), VALID_KEY);
    expect(upgraded).toMatch(/^v2:/);
    expect(decryptSecret(upgraded, VALID_KEY)).toBe("sk-legacy-key");
  });
});

describe("generateWebhookSecret", () => {
  it("generates a 64-character hex string (256 bits)", () => {
    const secret = generateWebhookSecret();
    expect(secret).toMatch(/^[0-9a-f]{64}$/);
  });

  it("generates a different value on each call", () => {
    expect(generateWebhookSecret()).not.toBe(generateWebhookSecret());
  });
});

describe("signWebhookPayload", () => {
  it("produces a deterministic HMAC-SHA256 hex digest for the same body and secret", () => {
    const body = JSON.stringify({ runId: "abc", status: "SUCCESS" });
    const secret = generateWebhookSecret();
    const sigA = signWebhookPayload(body, secret);
    const sigB = signWebhookPayload(body, secret);
    expect(sigA).toBe(sigB);
    expect(sigA).toMatch(/^[0-9a-f]{64}$/);
  });

  it("produces a different signature for a different body", () => {
    const secret = generateWebhookSecret();
    const sigA = signWebhookPayload(JSON.stringify({ a: 1 }), secret);
    const sigB = signWebhookPayload(JSON.stringify({ a: 2 }), secret);
    expect(sigA).not.toBe(sigB);
  });

  it("produces a different signature for a different secret", () => {
    const body = JSON.stringify({ a: 1 });
    const sigA = signWebhookPayload(body, generateWebhookSecret());
    const sigB = signWebhookPayload(body, generateWebhookSecret());
    expect(sigA).not.toBe(sigB);
  });
});

describe("generateResetToken / hashResetToken", () => {
  it("generates a 64-character hex token", () => {
    expect(generateResetToken()).toMatch(/^[0-9a-f]{64}$/);
  });

  it("generates a different token on each call", () => {
    expect(generateResetToken()).not.toBe(generateResetToken());
  });

  it("hashes the same token deterministically", () => {
    const token = generateResetToken();
    expect(hashResetToken(token)).toBe(hashResetToken(token));
  });

  it("produces different hashes for different tokens", () => {
    expect(hashResetToken(generateResetToken())).not.toBe(hashResetToken(generateResetToken()));
  });
});
