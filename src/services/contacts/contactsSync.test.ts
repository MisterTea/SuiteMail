import { describe, it, expect, vi, beforeEach } from "vitest";
import { syncGoogleContacts, syncContactsForAccount } from "./contactsSync";

const mockGetAccount = vi.fn();
const mockUpsertContact = vi.fn();
const mockGetGmailClient = vi.fn();

vi.mock("../db/accounts", () => ({
  getAccount: (...args: unknown[]) => mockGetAccount(...args),
  getAllAccounts: vi.fn(() => Promise.resolve([])),
}));

vi.mock("../db/contacts", () => ({
  upsertContact: (...args: unknown[]) => mockUpsertContact(...args),
}));

vi.mock("../gmail/tokenManager", () => ({
  getGmailClient: (...args: unknown[]) => mockGetGmailClient(...args),
}));

describe("contactsSync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("syncs contacts from Google People API", async () => {
    const mockClient = {
      request: vi.fn().mockResolvedValue({
        connections: [
          {
            names: [{ displayName: "Diana Prince" }],
            emailAddresses: [{ value: "diana@themyscira.gov" }],
            photos: [{ url: "https://photos.example.com/diana.jpg" }],
          },
        ],
      }),
    };
    mockGetGmailClient.mockResolvedValue(mockClient);

    const res = await syncGoogleContacts("acc-google");
    expect(res.syncedCount).toBe(1);
    expect(mockUpsertContact).toHaveBeenCalledWith(
      "diana@themyscira.gov",
      "Diana Prince",
      "https://photos.example.com/diana.jpg",
    );
  });

  it("dispatches to Google sync when account provider is gmail_api", async () => {
    mockGetAccount.mockResolvedValue({
      id: "acc-1",
      email: "user@gmail.com",
      provider: "gmail_api",
    });

    const mockClient = {
      request: vi.fn().mockResolvedValue({ connections: [] }),
    };
    mockGetGmailClient.mockResolvedValue(mockClient);

    const res = await syncContactsForAccount("acc-1");
    expect(res.syncedCount).toBe(0);
    expect(mockGetGmailClient).toHaveBeenCalledWith("acc-1");
  });
});
