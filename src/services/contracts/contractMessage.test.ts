import { describe, it, expect } from "vitest";
import {
  canonicalizeContract,
  contractTextForEditor,
  embedContractHtml,
  embedDraftContract,
  parseContractFromMessage,
  peelDraftContract,
  stripContractMarkup,
} from "./contractMessage";

const MESSAGE_ONE = "-----BEGIN PGP MESSAGE-----\nMESSAGE-ONE\n-----END PGP MESSAGE-----";
const MESSAGE_TWO = "-----BEGIN PGP MESSAGE-----\nMESSAGE-TWO\n-----END PGP MESSAGE-----";
const KEY_ONE = "-----BEGIN PGP PUBLIC KEY BLOCK-----\nKEY-ONE\n-----END PGP PUBLIC KEY BLOCK-----";
const KEY_TWO = "-----BEGIN PGP PUBLIC KEY BLOCK-----\nKEY-TWO\n-----END PGP PUBLIC KEY BLOCK-----";

describe("contractMessage", () => {
  it("canonicalizes line endings and keeps one trailing newline", () => {
    expect(canonicalizeContract("Pay ten\r\ndollars  \n")).toBe("Pay ten\ndollars\n");
    expect(contractTextForEditor("Pay ten\ndollars\n")).toBe("Pay ten\ndollars");
  });

  it("embeds a signed block after the letter and parses the last one", () => {
    const first = embedContractHtml("<p>Hello</p>", MESSAGE_ONE, KEY_ONE);
    const combined = `${first}${embedContractHtml("<p>Again</p>", MESSAGE_TWO, KEY_TWO)}`;
    const parsed = parseContractFromMessage(combined, null);
    expect(parsed?.signedMessage).toContain("MESSAGE-TWO");
    expect(parsed?.publicKey).toContain("KEY-TWO");
    expect(stripContractMarkup(combined)).toBe("<p>Hello</p><p>Again</p>");
  });

  it("prefers the plain-text part when both parts contain a contract", () => {
    const html = embedContractHtml("<p>Hello</p>", MESSAGE_ONE, KEY_ONE);
    const text = embedContractHtml("", MESSAGE_TWO, KEY_TWO).replace(/<[^>]+>/g, "");
    const parsed = parseContractFromMessage(html, text);
    expect(parsed?.signedMessage).toContain("MESSAGE-TWO");
  });

  it("round-trips an unsigned draft fence", () => {
    const saved = embedDraftContract("<p>Hello</p>", "Line one\nLine two");
    const peeled = peelDraftContract(saved);
    expect(peeled.contractText).toBe("Line one\nLine two");
    expect(peeled.html).toBe("<p>Hello</p>");
    expect(peeled.html).not.toContain("CONTRACT DRAFT");
  });
});
