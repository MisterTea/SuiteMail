// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import * as openpgp from "openpgp";
import { acknowledgeContractKeyShown, observeContractKey } from "./contractKeys";

interface Row {
  email: string;
  fingerprint: string;
  armored_public_key: string;
}

const rows: Row[] = [];

vi.mock("../db/contractKeySightings", () => ({
  getContractKeySighting: vi.fn(async (email: string, fingerprint: string) => {
    return rows.find(
      (row) => row.email === email.toLowerCase() && row.fingerprint === fingerprint.toLowerCase(),
    ) ?? null;
  }),
  listContractKeySightings: vi.fn(async (email: string) => {
    return rows.filter((row) => row.email === email.toLowerCase());
  }),
  insertContractKeySighting: vi.fn(async (row: Row) => {
    const email = row.email.toLowerCase();
    const fingerprint = row.fingerprint.toLowerCase();
    if (rows.some((existing) => existing.email === email && existing.fingerprint === fingerprint)) return;
    rows.push({ ...row, email, fingerprint });
  }),
}));

describe("contract key sightings", () => {
  beforeEach(() => {
    rows.length = 0;
  });

  it("alerts the first time an email and key are seen, then stays quiet", async () => {
    const alice = await openpgp.generateKey({
      userIDs: [{ name: "Alice", email: "alice@example.com" }],
      type: "curve25519",
    });

    const first = await observeContractKey("Alice@Example.com", alice.publicKey);
    expect(first.isNew).toBe(true);
    expect(first.keyChanged).toBe(false);

    await acknowledgeContractKeyShown("alice@example.com", first.fingerprint, alice.publicKey);

    const second = await observeContractKey("alice@example.com", alice.publicKey);
    expect(second.isNew).toBe(false);
    expect(second.keyChanged).toBe(false);
  }, 20000);

  it("alerts again when the same address presents a different key", async () => {
    const firstKey = await openpgp.generateKey({
      userIDs: [{ name: "Alice", email: "alice@example.com" }],
      type: "curve25519",
    });
    const secondKey = await openpgp.generateKey({
      userIDs: [{ name: "Alice", email: "alice@example.com" }],
      type: "curve25519",
    });

    const first = await observeContractKey("alice@example.com", firstKey.publicKey);
    await acknowledgeContractKeyShown("alice@example.com", first.fingerprint, firstKey.publicKey);

    const changed = await observeContractKey("alice@example.com", secondKey.publicKey);
    expect(changed.isNew).toBe(true);
    expect(changed.keyChanged).toBe(true);
    expect(changed.fingerprint).not.toBe(first.fingerprint);
  }, 30000);
});
