import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { DbMessage } from "@/services/db/messages";
import { ContractCard } from "./ContractCard";
import { useComposerStore } from "@/stores/composerStore";

const verifyContract = vi.fn();
const observeContractKey = vi.fn();
const acknowledgeContractKeyShown = vi.fn();

vi.mock("@/services/contracts/contractCrypto", () => ({
  verifyContract: (...args: unknown[]) => verifyContract(...args),
}));

vi.mock("@/services/contracts/contractKeys", () => ({
  observeContractKey: (...args: unknown[]) => observeContractKey(...args),
  acknowledgeContractKeyShown: (...args: unknown[]) => acknowledgeContractKeyShown(...args),
}));

const contractHtml = [
  "<p>Hello</p>",
  "<hr />",
  "<pre class=\"suitemail-contract\">",
  "-----BEGIN SUITEMAIL CONTRACT-----",
  "-----BEGIN PGP MESSAGE-----",
  "dummy-message",
  "-----END PGP MESSAGE-----",
  "-----BEGIN PGP PUBLIC KEY BLOCK-----",
  "dummy-key",
  "-----END PGP PUBLIC KEY BLOCK-----",
  "-----END SUITEMAIL CONTRACT-----",
  "</pre>",
].join("");

function makeMessage(): DbMessage {
  return {
    id: "m1",
    account_id: "a1",
    thread_id: "t1",
    from_address: "alice@example.com",
    from_name: "Alice",
    to_addresses: "bob@example.com",
    cc_addresses: null,
    bcc_addresses: null,
    reply_to: null,
    subject: "Agreement",
    snippet: "Hello",
    date: 1,
    is_read: 1,
    is_starred: 0,
    body_html: contractHtml,
    body_text: null,
    body_cached: 1,
    raw_size: 100,
    internal_date: null,
    list_unsubscribe: null,
    list_unsubscribe_post: null,
    auth_results: null,
    message_id_header: null,
    references_header: null,
    in_reply_to_header: null,
    imap_uid: null,
    imap_folder: null,
  };
}

describe("ContractCard", () => {
  beforeEach(() => {
    verifyContract.mockReset();
    observeContractKey.mockReset();
    acknowledgeContractKeyShown.mockReset();
    useComposerStore.getState().closeComposer();
  });

  it("warns when the sender's public key is new", async () => {
    verifyContract.mockResolvedValue({
      verified: true,
      text: "Pay ten dollars\n",
      fingerprint: "abcdabcdabcdabcd",
    });
    observeContractKey.mockResolvedValue({
      isNew: true,
      keyChanged: true,
      fingerprint: "abcdabcdabcdabcd",
    });
    acknowledgeContractKeyShown.mockResolvedValue(undefined);

    render(<ContractCard message={makeMessage()} />);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("New public key for alice@example.com");
    expect(alert).toHaveTextContent("Verify the authority of this key");
    expect(alert).toHaveTextContent("This address previously used a different key");
    expect(acknowledgeContractKeyShown).toHaveBeenCalled();
    expect(screen.getByText("Pay ten dollars")).toBeInTheDocument();
  });

  it("stays quiet for a key that was already seen and can reply with the contract", async () => {
    verifyContract.mockResolvedValue({
      verified: true,
      text: "Pay ten dollars\n",
      fingerprint: "abcdabcdabcdabcd",
    });
    observeContractKey.mockResolvedValue({
      isNew: false,
      keyChanged: false,
      fingerprint: "abcdabcdabcdabcd",
    });

    render(<ContractCard message={makeMessage()} />);

    expect(await screen.findByText("Signature verified")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Revise and reply" }));
    const state = useComposerStore.getState();
    expect(state.mode).toBe("reply");
    expect(state.contractActive).toBe(true);
    expect(state.contractText).toBe("Pay ten dollars");
    expect(state.to).toEqual(["alice@example.com"]);
  });
});