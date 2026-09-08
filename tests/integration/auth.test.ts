import { describe, expect, it } from "vitest";
import { verifyPhrase } from "../../app/lib/auth.server";

describe("Worker authentication", () => {
  it("verifies the static 100000-iteration PBKDF2-SHA256 fixture", async () => {
    await expect(
      verifyPhrase(
        "test-only amber river compass",
        "YnBtbi1idWlsZGVyLWUyZQ",
        "mQR0bBCPoj4bGio8UUhrbzyb1TK4klPbw9YfgJHRArY",
      ),
    ).resolves.toBe(true);
  });
});
