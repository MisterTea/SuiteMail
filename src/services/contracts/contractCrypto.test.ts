// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import * as openpgp from "openpgp";
import { appendSealedContract, signContractText, verifyContract } from "./contractCrypto";
import { embedContractHtml, parseContractFromMessage } from "./contractMessage";

const mockDbIdentities: Record<string, {
  id: string;
  email: string;
  armored_public_key: string;
  armored_private_key: string;
  fingerprint: string;
}> = {};
const mockSettings: Record<string, string> = {};

vi.mock("../db/pgpIdentities", () => ({
  getAppPgpIdentity: vi.fn(async (id = "default") => mockDbIdentities[id] ?? null),
  upsertAppPgpIdentity: vi.fn(async (identity) => {
    mockDbIdentities[identity.id] = identity;
  }),
}));

vi.mock("../db/settings", () => ({
  getSetting: vi.fn(async (key: string) => mockSettings[key] ?? null),
  setSetting: vi.fn(async (key: string, value: string) => {
    mockSettings[key] = value;
  }),
}));

function toPlain(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function tamperArmor(armored: string): string {
  const lines = armored.split("\n");
  const index = lines.findIndex((line) => /^[A-Za-z0-9+/]{20,}$/.test(line.trim()));
  if (index < 0) throw new Error("signed message has no armor body");
  const line = lines[index] ?? "";
  const flipped = `${line.startsWith("A") ? "B" : "A"}${line.slice(1)}`;
  lines[index] = flipped;
  return lines.join("\n");
}

describe("contractCrypto", () => {
  beforeEach(() => {
    for (const key of Object.keys(mockDbIdentities)) delete mockDbIdentities[key];
    for (const key of Object.keys(mockSettings)) delete mockSettings[key];
  });

  it("leaves the letter unchanged when the contract is empty", async () => {
    const html = await appendSealedContract("<p>Hello</p>", "   ", "alice@example.com");
    expect(html).toBe("<p>Hello</p>");
  });

  it("signs a contract, and the plain-text part still verifies", async () => {
    const html = await appendSealedContract("<p>Hello</p>", "Pay ten dollars", "alice@example.com");
    expect(html).toContain("-----BEGIN PGP MESSAGE-----");
    expect(html).toContain("-----BEGIN PGP PUBLIC KEY BLOCK-----");
    expect(html).toContain("<p>Hello</p>");

    const parsed = parseContractFromMessage(null, toPlain(html));
    expect(parsed).not.toBeNull();
    const opened = await verifyContract(parsed!);
    expect(opened.verified).toBe(true);
    expect(opened.text).toBe("Pay ten dollars\n");
  }, 20000);

  it("rejects a contract whose signed message was changed", async () => {
    const html = await appendSealedContract("<p>Hello</p>", "Pay ten dollars", "alice@example.com");
    const parsed = parseContractFromMessage(html, null);
    expect(parsed).not.toBeNull();
    const tampered = {
      ...parsed!,
      signedMessage: tamperArmor(parsed!.signedMessage),
    };
    const opened = await verifyContract(tampered);
    expect(opened.verified).toBe(false);
  }, 20000);

  it("verifies a mutated contract signed by the other party", async () => {
    const aliceHtml = await appendSealedContract("<p>Offer</p>", "Pay ten dollars", "alice@example.com");
    const aliceParsed = parseContractFromMessage(aliceHtml, null);
    const aliceOpened = await verifyContract(aliceParsed!);
    expect(aliceOpened.verified).toBe(true);

    const bob = await openpgp.generateKey({
      userIDs: [{ name: "Bob", email: "bob@example.com" }],
      type: "curve25519",
    });
    const mutated = `${aliceOpened.text ?? ""}ACCEPT`;
    const signed = await signContractText(mutated, bob.privateKey);
    const bobHtml = embedContractHtml("<p>I agree</p>", signed, bob.publicKey);
    const bobParsed = parseContractFromMessage(bobHtml, null);
    const bobOpened = await verifyContract(bobParsed!);

    expect(bobOpened.verified).toBe(true);
    expect(bobOpened.text).toContain("ACCEPT");
    expect(bobOpened.fingerprint).not.toBe(aliceOpened.fingerprint);
  }, 30000);
});
