import { describe, it, expect, beforeEach, vi } from "vitest";
import { setSetting } from "../services/db/settings";
import { hasMailAccount, useAccountStore, type Account } from "./accountStore";

vi.mock("../services/db/settings", () => ({ setSetting: vi.fn().mockResolvedValue(undefined) }));

const mockAccount: Account = {
  id: "acc-1",
  email: "test@gmail.com",
  displayName: "Test User",
  avatarUrl: null,
  isActive: true,
};

const mockAccount2: Account = {
  id: "acc-2",
  email: "work@gmail.com",
  displayName: "Work Account",
  avatarUrl: null,
  isActive: true,
};

describe("accountStore", () => {
  beforeEach(() => {
    useAccountStore.setState({
      accounts: [],
      activeAccountId: null,
    });
  });

  it("treats an empty list and calendar-only accounts as having no mail", () => {
    expect(hasMailAccount([])).toBe(false);
    expect(hasMailAccount([{ provider: "caldav" }, { provider: "caldav" }])).toBe(false);
    expect(hasMailAccount([{ provider: "gmail_api" }])).toBe(true);
    expect(hasMailAccount([{ provider: "imap" }])).toBe(true);
    expect(hasMailAccount([{ provider: "caldav" }, { provider: "imap" }])).toBe(true);
    expect(hasMailAccount([{}])).toBe(true);
  });

  it("should start with no accounts", () => {
    const state = useAccountStore.getState();
    expect(state.accounts).toHaveLength(0);
    expect(state.activeAccountId).toBeNull();
  });

  it("should add an account and set it as active", () => {
    useAccountStore.getState().addAccount(mockAccount);
    const state = useAccountStore.getState();
    expect(state.accounts).toHaveLength(1);
    expect(state.activeAccountId).toBe("acc-1");
  });

  it("should switch to a newly added account", () => {
    useAccountStore.getState().addAccount(mockAccount);
    useAccountStore.getState().addAccount(mockAccount2);
    const state = useAccountStore.getState();
    expect(state.accounts).toHaveLength(2);
    expect(state.activeAccountId).toBe("acc-2");
    expect(setSetting).toHaveBeenLastCalledWith("active_account_id", "acc-2");
  });

  it("preserves the newly selected account when reloading accounts after save", () => {
    useAccountStore.getState().setAccounts([mockAccount]);
    useAccountStore.getState().addAccount(mockAccount2);
    const selected = useAccountStore.getState().activeAccountId;
    useAccountStore.getState().setAccounts([mockAccount, mockAccount2], selected);
    expect(useAccountStore.getState().activeAccountId).toBe("acc-2");
  });

  it("should switch active account", () => {
    useAccountStore.getState().addAccount(mockAccount);
    useAccountStore.getState().addAccount(mockAccount2);
    useAccountStore.getState().setActiveAccount("acc-2");
    expect(useAccountStore.getState().activeAccountId).toBe("acc-2");
  });

  it("should remove account and update active if needed", () => {
    useAccountStore.getState().addAccount(mockAccount);
    useAccountStore.getState().addAccount(mockAccount2);
    useAccountStore.getState().removeAccount("acc-1");

    const state = useAccountStore.getState();
    expect(state.accounts).toHaveLength(1);
    expect(state.activeAccountId).toBe("acc-2");
  });

  it("should set active to null when last account removed", () => {
    useAccountStore.getState().addAccount(mockAccount);
    useAccountStore.getState().removeAccount("acc-1");

    const state = useAccountStore.getState();
    expect(state.accounts).toHaveLength(0);
    expect(state.activeAccountId).toBeNull();
  });

  it("should set accounts from array", () => {
    useAccountStore.getState().setAccounts([mockAccount, mockAccount2]);
    const state = useAccountStore.getState();
    expect(state.accounts).toHaveLength(2);
    expect(state.activeAccountId).toBe("acc-1");
  });
});
