import { describe, expect, it } from "vitest";
import {
  derivePhraseVerifier,
  normalizeMnemonic,
  signSession,
  verifyPhrase,
  verifySession,
  validateMutationOrigin,
} from "../../app/lib/auth.server";

describe("private authentication", () => {
  it("normalizes Unicode and whitespace deterministically", () => {
    expect(normalizeMnemonic("  ТеСТ\u00a0  ФРАЗА  ")).toBe("тест фраза");
  });

  it("derives and timing-safely verifies a PBKDF2 verifier", async () => {
    const salt = "c2FsdC1mb3ItdGVzdHM";
    const verifier = await derivePhraseVerifier("amber river crane", salt);
    expect(await verifyPhrase(" AMBER   river crane ", salt, verifier)).toBe(
      true,
    );
    expect(await verifyPhrase("amber river train", salt, verifier)).toBe(false);
  });

  it("signs expiring HttpOnly session cookies", async () => {
    const now = 1_800_000_000_000;
    const signed = await signSession(
      "test-signing-key-with-enough-entropy",
      now,
      "session-1",
    );
    expect(
      await verifySession(
        signed.value,
        "test-signing-key-with-enough-entropy",
        now + 1000,
      ),
    ).toMatchObject({ sid: "session-1" });
    expect(
      await verifySession(
        signed.value,
        "test-signing-key-with-enough-entropy",
        now + 86_400_001,
      ),
    ).toBeNull();
    expect(signed.cookie).toContain("HttpOnly");
    expect(signed.cookie).toContain("Secure");
    expect(signed.cookie).toContain("SameSite=Strict");
  });

  it("accepts only same-origin mutation requests", () => {
    expect(
      validateMutationOrigin(
        new Request("https://app.test/x", {
          method: "POST",
          headers: { Origin: "https://app.test" },
        }),
      ),
    ).toBe(true);
    expect(
      validateMutationOrigin(
        new Request("https://app.test/x", {
          method: "POST",
          headers: { Origin: "https://evil.test" },
        }),
      ),
    ).toBe(false);
  });
});
