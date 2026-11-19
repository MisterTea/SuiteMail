import { describe, it, expect, vi, beforeEach } from "vitest";
import { useAccountStore } from "@/stores/accountStore";
import { fallbackSenderName, resolveSenderDisplayName } from "./senderIdentity";

vi.mock("@/services/db/sendAsAliases", () => ({
  getAliasesForAccount: vi.fn(),
}));

vi.mock("@/services/db/accounts", () => ({
  getAccount: vi.fn(),
}));

import { getAliasesForAccount } from "@/services/db/sendAsAliases";
import { getAccount } from "@/services/db/accounts";

describe("fallbackSenderName", () => {
  const accounts = [{ email: "jgmath2000@gmail.com", displayName: "Jason Gauci" }];

  it("keeps a stored display name", () => {
    expect(fallbackSenderName("Ada Lovelace", "ada@example.com", accounts)).toBe("Ada Lovelace");
  });

  it("uses the account name when mail from the user has no stored name", () => {
    expect(fallbackSenderName(null, "jgmath2000@gmail.com", accounts)).toBe("Jason Gauci");
  });

  it("leaves other senders without a name unchanged", () => {
    expect(fallbackSenderName(null, "other@example.com", accounts)).toBeNull();
  });
});

describe("resolveSenderDisplayName", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAccountStore.setState({
      accounts: [{
        id: "acc-1",
        email: "jgmath2000@gmail.com",
        displayName: "Jason Gauci",
        avatarUrl: null,
        isActive: true,
      }],
      activeAccountId: "acc-1",
    });
  });

  it("prefers the send-as display name for that address", async () => {
    vi.mocked(getAliasesForAccount).mockResolvedValue([
      {
        id: "alias-1",
        account_id: "acc-1",
        email: "jgmath2000@gmail.com",
        display_name: "Jason Gauci",
        reply_to_address: null,
        signature_id: null,
        is_primary: 1,
        is_default: 1,
        treat_as_alias: 0,
        verification_status: "accepted",
        created_at: 0,
      },
    ]);

    await expect(resolveSenderDisplayName("acc-1", "jgmath2000@gmail.com")).resolves.toBe("Jason Gauci");
    expect(getAccount).not.toHaveBeenCalled();
  });

  it("uses the account profile name when no send-as name is stored", async () => {
    vi.mocked(getAliasesForAccount).mockResolvedValue([]);
    vi.mocked(getAccount).mockResolvedValue({
      id: "acc-1",
      email: "jgmath2000@gmail.com",
      display_name: "Jason Gauci",
    } as never);

    await expect(resolveSenderDisplayName("acc-1", "jgmath2000@gmail.com")).resolves.toBe("Jason Gauci");
  });

  it("does not apply the account name to a different address", async () => {
    vi.mocked(getAliasesForAccount).mockResolvedValue([]);
    vi.mocked(getAccount).mockResolvedValue({
      id: "acc-1",
      email: "jgmath2000@gmail.com",
      display_name: "Jason Gauci",
    } as never);

    await expect(resolveSenderDisplayName("acc-1", "alias@example.com")).resolves.toBeNull();
  });
});
