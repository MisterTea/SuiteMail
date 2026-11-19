import { verifyContract } from "./contractCrypto";
import {
  contractTextForEditor,
  parseContractFromMessage,
} from "./contractMessage";

export interface ContractReplyFields {
  contractActive: boolean;
  contractText: string;
}

/**
 * Prefill a reply composer with the contract recovered from a message.
 * Messages without a contract leave the contract region closed.
 */
export async function contractReplyFields(
  html: string | null | undefined,
  text: string | null | undefined,
): Promise<ContractReplyFields> {
  const parsed = parseContractFromMessage(html, text);
  if (!parsed) return { contractActive: false, contractText: "" };
  try {
    const result = await verifyContract(parsed);
    return {
      contractActive: true,
      contractText: result.text ? contractTextForEditor(result.text) : "",
    };
  } catch {
    return { contractActive: true, contractText: "" };
  }
}
