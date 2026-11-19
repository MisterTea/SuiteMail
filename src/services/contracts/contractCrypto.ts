import {
  canonicalizeContract,
  embedContractHtml,
  stripContractMarkup,
  type ParsedContract,
} from "./contractMessage";

export interface VerifiedContract {
  verified: boolean;
  /** Recovered contract text when the signed message can be read. */
  text: string | null;
  fingerprint: string | null;
}

function asText(data: unknown): string | null {
  if (typeof data === "string") return data;
  if (data instanceof Uint8Array) return new TextDecoder().decode(data);
  return null;
}

/**
 * Sign contract text with an OpenPGP private key.
 * The armored result is a signed message the recipient opens with the public key.
 */
export async function signContractText(
  contractText: string,
  armoredPrivateKey: string,
): Promise<string> {
  const openpgp = await import("openpgp");
  const canonical = canonicalizeContract(contractText);
  const privateKey = await openpgp.readPrivateKey({ armoredKey: armoredPrivateKey });
  const message = await openpgp.createMessage({ text: canonical });
  const signed = await openpgp.sign({
    message,
    signingKeys: privateKey,
    format: "armored",
  });
  if (typeof signed !== "string") {
    throw new Error("Expected an armored signed contract");
  }
  return signed.trim();
}

/**
 * Append a signed contract to the letter HTML.
 * An empty contract leaves the letter unchanged, aside from dropping any draft fence.
 */
export async function appendSealedContract(
  letterHtml: string,
  contractText: string,
  fromEmail: string,
): Promise<string> {
  if (!contractText.trim()) {
    return stripContractMarkup(letterHtml);
  }
  const { initAppPgpKey } = await import("../crypto/pgpService");
  const identity = await initAppPgpKey(fromEmail);
  const signed = await signContractText(contractText, identity.armored_private_key);
  return embedContractHtml(letterHtml, signed, identity.armored_public_key);
}

/**
 * Recover a contract with the public key that was appended to the message.
 * A bad signature does not count as verified.
 */
export async function verifyContract(parsed: ParsedContract): Promise<VerifiedContract> {
  let fingerprint: string | null = null;
  try {
    const openpgp = await import("openpgp");
    const publicKey = await openpgp.readKey({ armoredKey: parsed.publicKey });
    fingerprint = publicKey.getFingerprint().toLowerCase();
    const message = await openpgp.readMessage({ armoredMessage: parsed.signedMessage });
    const verification = await openpgp.verify({
      message,
      verificationKeys: publicKey,
    });
    const signature = verification.signatures[0];
    let verified = false;
    if (signature) {
      try {
        await signature.verified;
        verified = true;
      } catch {
        verified = false;
      }
    }
    return {
      verified,
      text: asText(verification.data),
      fingerprint,
    };
  } catch {
    return { verified: false, text: null, fingerprint };
  }
}
