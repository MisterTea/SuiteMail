/**
 * Wire format for a SuiteMail contract.
 *
 * The letter stays ordinary HTML. After it, one <pre> holds an OpenPGP
 * signed message of the contract text plus the signer's armored public key.
 * Drafts use a separate unsigned fence so auto-save does not sign.
 */

export const CONTRACT_BEGIN = "-----BEGIN SUITEMAIL CONTRACT-----";
export const CONTRACT_END = "-----END SUITEMAIL CONTRACT-----";
export const DRAFT_BEGIN = "-----BEGIN SUITEMAIL CONTRACT DRAFT-----";
export const DRAFT_END = "-----END SUITEMAIL CONTRACT DRAFT-----";

const PGP_MESSAGE_BEGIN = "-----BEGIN PGP MESSAGE-----";
const PGP_MESSAGE_END = "-----END PGP MESSAGE-----";
const PGP_PUBLIC_BEGIN = "-----BEGIN PGP PUBLIC KEY BLOCK-----";
const PGP_PUBLIC_END = "-----END PGP PUBLIC KEY BLOCK-----";

const CONTRACT_PRE =
  /(?:<hr\s*\/?>\s*)?<pre class="suitemail-contract(?:-draft)?">[\s\S]*?<\/pre>/gi;

export interface ParsedContract {
  signedMessage: string;
  publicKey: string;
}

/** UTF-8 contract bytes: LF line endings and one trailing newline. */
export function canonicalizeContract(text: string): string {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\s+$/u, "");
  return `${normalized}\n`;
}

/** Drop the canonical trailing newline for a textarea. */
export function contractTextForEditor(canonical: string): string {
  return canonical.replace(/\n$/, "");
}

function decodeBasicEntities(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

function escapePre(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function extractArmor(source: string, begin: string, end: string): string | null {
  const start = source.indexOf(begin);
  if (start < 0) return null;
  const stop = source.indexOf(end, start + begin.length);
  if (stop < 0) return null;
  return source.slice(start, stop + end.length).trim();
}

function lastMarkedRegion(source: string, begin: string, end: string): string | null {
  let searchFrom = 0;
  let inner: string | null = null;
  while (searchFrom < source.length) {
    const start = source.indexOf(begin, searchFrom);
    if (start < 0) break;
    const stop = source.indexOf(end, start + begin.length);
    if (stop < 0) break;
    inner = source.slice(start + begin.length, stop);
    searchFrom = stop + end.length;
  }
  return inner;
}

export function buildContractArmor(signedMessage: string, publicKey: string): string {
  return [
    CONTRACT_BEGIN,
    signedMessage.trim(),
    publicKey.trim(),
    CONTRACT_END,
  ].join("\n");
}

export function embedContractHtml(letterHtml: string, signedMessage: string, publicKey: string): string {
  const armor = buildContractArmor(signedMessage, publicKey);
  const base = stripContractMarkup(letterHtml);
  return `${base}<hr /><pre class="suitemail-contract">${escapePre(armor)}</pre>`;
}

export function parseContractSource(source: string | null | undefined): ParsedContract | null {
  if (!source) return null;
  const decoded = decodeBasicEntities(source);
  const inner = lastMarkedRegion(decoded, CONTRACT_BEGIN, CONTRACT_END);
  if (inner == null) return null;
  const signedMessage = extractArmor(inner, PGP_MESSAGE_BEGIN, PGP_MESSAGE_END);
  const publicKey = extractArmor(inner, PGP_PUBLIC_BEGIN, PGP_PUBLIC_END);
  if (!signedMessage || !publicKey) return null;
  return { signedMessage, publicKey };
}

/** Prefer the plain-text part. Fall back to HTML, which keeps the same markers. */
export function parseContractFromMessage(
  html: string | null | undefined,
  text: string | null | undefined,
): ParsedContract | null {
  return parseContractSource(text) ?? parseContractSource(html);
}

export function messageHasContract(
  html: string | null | undefined,
  text: string | null | undefined,
): boolean {
  return parseContractFromMessage(html, text) != null;
}

/** Remove signed blocks and draft fences from HTML or plain text. */
export function stripContractMarkup(source: string): string {
  return source
    .replace(CONTRACT_PRE, "")
    .replace(/\n*-----BEGIN SUITEMAIL CONTRACT DRAFT-----[\s\S]*?-----END SUITEMAIL CONTRACT DRAFT-----/g, "")
    .replace(/\n*-----BEGIN SUITEMAIL CONTRACT-----[\s\S]*?-----END SUITEMAIL CONTRACT-----/g, "");
}

export function embedDraftContract(html: string, contractText: string): string {
  const base = stripContractMarkup(html);
  if (!contractText.trim()) return base;
  const fence = `${DRAFT_BEGIN}\n${contractText.replace(/\r\n/g, "\n").replace(/\r/g, "\n")}\n${DRAFT_END}`;
  return `${base}<pre class="suitemail-contract-draft">${escapePre(fence)}</pre>`;
}

export function peelDraftContract(source: string): { html: string; contractText: string | null } {
  const decoded = decodeBasicEntities(source);
  const inner = lastMarkedRegion(decoded, DRAFT_BEGIN, DRAFT_END);
  const contractText = inner == null
    ? null
    : inner.replace(/^\n/, "").replace(/\n$/, "");
  return { html: stripContractMarkup(source), contractText };
}
