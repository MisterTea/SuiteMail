import { describe, it, expect, vi, beforeEach } from "vitest";
import { initialSync, deltaSync, syncInitialChanges } from "./sync";
import { GmailApiError, GmailClient } from "./client";

import { deleteThread } from "../db/threads";
import { getSetting, setSetting } from "../db/settings";
import { upsertMessage } from "../db/messages";
import { updateAccountSyncState } from "../db/accounts";

vi.mock("../db/labels",()=>({upsertLabel:vi.fn()}));
vi.mock("@/services/ai/embeddingIndexer",()=>({indexBatchForAccount:vi.fn()}));
// Mock all DB modules
vi.mock("../db/threads", () => ({
  deleteThread: vi.fn(),
  upsertThread: vi.fn(),
  setThreadLabels: vi.fn(),
  getMutedThreadIds: vi.fn().mockResolvedValue(new Set()),
}));
vi.mock("../db/messages", () => ({
  upsertMessage: vi.fn(),
}));
vi.mock("../db/attachments", () => ({
  upsertAttachment: vi.fn(),
}));
vi.mock("../db/accounts", () => ({
  updateAccountSyncState: vi.fn(),
}));
vi.mock("../db/settings", () => ({
  getSetting: vi.fn().mockResolvedValue(null),
  setSetting: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../db/threadCategories", () => ({
  getThreadCategoryWithManual: vi.fn().mockResolvedValue(null),
  setThreadCategory: vi.fn(),
  getThreadCategory: vi.fn().mockResolvedValue(null),
}));
vi.mock("../db/notificationVips", () => ({
  getVipSenders: vi.fn().mockResolvedValue(new Set()),
}));
vi.mock("@/services/categorization/ruleEngine", () => ({
  categorizeByRules: vi.fn().mockReturnValue("Primary"),
}));
vi.mock("../filters/filterEngine", () => ({
  applyFiltersToMessages: vi.fn(),
  isEmailFiltered: vi.fn().mockResolvedValue(false),
  markEmailFiltered: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/services/ai/categorizationManager", () => ({
  categorizeNewThreads: vi.fn(),
}));
vi.mock("@/services/db/bundleRules", () => ({
  getBundleRule: vi.fn().mockResolvedValue(null),
  holdThread: vi.fn(),
  getNextDeliveryTime: vi.fn(),
}));
vi.mock("@/services/db/pendingOperations", () => ({
  getPendingOpsForResource: vi.fn().mockResolvedValue([]),
}));

const mockNotify = vi.fn();
const mockShouldNotify = vi.fn().mockReturnValue(true);
vi.mock("../notifications/notificationManager", () => ({
  queueNewEmailNotification: (...args: unknown[]) => mockNotify(...args),
  shouldNotifyForMessage: (...args: unknown[]) => mockShouldNotify(...args),
}));

// Mock parseGmailMessage
vi.mock("./messageParser", () => ({
  parseGmailMessage: (msg: { id: string; threadId: string; labelIds: string[] }) => ({
    id: msg.id,
    threadId: msg.threadId,
    labelIds: msg.labelIds ?? [],
    fromAddress: "sender@example.com",
    fromName: "Sender",
    toAddresses: "me@example.com",
    ccAddresses: "",
    bccAddresses: "",
    replyTo: "",
    subject: `Subject for ${msg.id}`,
    snippet: "snippet",
    date: "2024-01-01T00:00:00Z",
    isRead: !msg.labelIds?.includes("UNREAD"),
    isStarred: false,
    bodyHtml: "<p>test</p>",
    bodyText: "test",
    rawSize: 100,
    internalDate: "1704067200000",
    hasAttachments: false,
    attachments: [],
  }),
}));

function createMockClient(historyItems: unknown[]): GmailClient {
  return {
    getHistory: vi.fn().mockResolvedValue({
      history: historyItems,
      historyId: "200",
    }),
    getThread: vi.fn().mockImplementation((threadId: string) =>
      Promise.resolve({
        id: threadId,
        historyId: "200",
        messages: [
          {
            id: `msg-${threadId}`,
            threadId,
            labelIds: ["INBOX", "UNREAD"],
            snippet: "test",
            historyId: "200",
            internalDate: "1704067200000",
            payload: { partId: "", mimeType: "text/plain", filename: "", headers: [], body: { size: 0 } },
            sizeEstimate: 100,
          },
        ],
      }),
    ),
  } as unknown as GmailClient;
}

describe("deltaSync notifications", () => {
  beforeEach(() => {
    mockNotify.mockClear();
    mockShouldNotify.mockClear();
    mockShouldNotify.mockReturnValue(true);
  });

  it("sends notification for new unread inbox message", async () => {
    const client = createMockClient([
      {
        id: "100",
        messagesAdded: [
          {
            message: {
              id: "msg-thread-1",
              threadId: "thread-1",
              labelIds: ["INBOX", "UNREAD"],
            },
          },
        ],
      },
    ]);

    await deltaSync(client, "account-1", "99");

    expect(mockNotify).toHaveBeenCalledWith(
      "Sender",
      "Subject for msg-thread-1",
      "thread-1",
      "account-1",
      "sender@example.com",
    );
  });

  it("does not send notification for read messages", async () => {
    const client = createMockClient([
      {
        id: "100",
        messagesAdded: [
          {
            message: {
              id: "msg-thread-2",
              threadId: "thread-2",
              labelIds: ["INBOX"], // no UNREAD
            },
          },
        ],
      },
    ]);

    await deltaSync(client, "account-1", "99");

    expect(mockNotify).not.toHaveBeenCalled();
  });

  it("does not send notification for sent messages", async () => {
    const client = createMockClient([
      {
        id: "100",
        messagesAdded: [
          {
            message: {
              id: "msg-thread-3",
              threadId: "thread-3",
              labelIds: ["SENT"],
            },
          },
        ],
      },
    ]);

    await deltaSync(client, "account-1", "99");

    expect(mockNotify).not.toHaveBeenCalled();
  });
});


describe("deltaSync missing threads", () => {
  beforeEach(() => vi.clearAllMocks());

  it("removes a missing thread locally and advances the sync cursor", async () => {
    const client = createMockClient([{
      messagesDeleted: [{ message: { id: "deleted-message", threadId: "deleted-thread" } }],
    }]);
    vi.mocked(client.getThread).mockRejectedValue(new GmailApiError(404, "Not Found"));
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await deltaSync(client, "account-1", "99");
      expect(deleteThread).toHaveBeenCalledExactlyOnceWith("account-1", "deleted-thread");
      expect(updateAccountSyncState).toHaveBeenCalledWith("account-1", "200");
      expect(errorLog).not.toHaveBeenCalled();
    } finally {
      errorLog.mockRestore();
    }
  });

  it("preserves cached threads on other API errors", async () => {
    const client = createMockClient([{
      messagesDeleted: [{ message: { id: "message", threadId: "thread" } }],
    }]);
    const error = new GmailApiError(403, "Forbidden");
    vi.mocked(client.getThread).mockRejectedValue(error);
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await expect(deltaSync(client, "account-1", "99")).rejects.toThrow("Forbidden");
      expect(updateAccountSyncState).not.toHaveBeenCalled();
      expect(deleteThread).not.toHaveBeenCalled();
      expect(errorLog).toHaveBeenCalledWith("Failed to re-sync thread thread:", error);
    } finally {
      errorLog.mockRestore();
    }
  });
});


describe("initialSync streaming and recovery",()=>{
 beforeEach(()=>vi.clearAllMocks());
 function client(){
  return {getProfile:vi.fn().mockResolvedValue({historyId:"100"}),listLabels:vi.fn().mockResolvedValue({labels:[]}),listThreads:vi.fn(),getThread:vi.fn().mockImplementation(async(id:string)=>({id,historyId:"999",messages:[{id:"m-"+id,threadId:id,labelIds:["INBOX"]}]}))} as unknown as GmailClient;
 }
 it("stores the first page before listing the next, publishes progress, and retains the pre-download history cursor",async()=>{
  const c=client();vi.mocked(c.listThreads).mockResolvedValueOnce({threads:[{id:"first",snippet:""}],nextPageToken:"page2",resultSizeEstimate:2}).mockImplementationOnce(async()=>{
   expect(upsertMessage).toHaveBeenCalledWith(expect.objectContaining({id:"m-first"}));return {threads:[{id:"second",snippet:""}]};
  });
  const progress=vi.fn();const event=vi.spyOn(window,"dispatchEvent");await initialSync(c,"initial",365,progress);
  expect(updateAccountSyncState).toHaveBeenCalledWith("initial","100");
  expect(progress).toHaveBeenLastCalledWith({phase:"done",current:2,total:2});
  expect(event).toHaveBeenCalledWith(expect.objectContaining({type:"suitemail-sync-progress"}));event.mockRestore();
 });
 it("does not skip a failed thread or mark a partially downloaded mailbox complete; resumes completed work",async()=>{
  const c=client();vi.mocked(c.listThreads).mockResolvedValue({threads:[{id:"first",snippet:""},{id:"second",snippet:""}]});
  const fetchThread=vi.mocked(c.getThread).getMockImplementation()!;
  vi.mocked(c.getThread).mockImplementation(async(id,...args)=>{if(id==="second")throw new GmailApiError(403,"quota");return fetchThread(id,...args);});
  await expect(initialSync(c,"resume")).rejects.toThrow("quota");expect(updateAccountSyncState).not.toHaveBeenCalled();
  const checkpoint=vi.mocked(setSetting).mock.calls.filter(([key])=>key==="gmail_initial_sync:resume").at(-1)![1];
  expect(JSON.parse(checkpoint).storedIds).toEqual(["first"]);
  vi.mocked(getSetting).mockImplementation(async(key)=>key==="gmail_initial_sync:resume"?checkpoint:null);
  vi.mocked(c.getThread).mockClear().mockImplementation(fetchThread);
  await initialSync(c,"resume");expect(c.getThread).toHaveBeenCalledExactlyOnceWith("second","full");expect(updateAccountSyncState).toHaveBeenCalledWith("resume","100");
  vi.mocked(getSetting).mockResolvedValue(null);
 });
 it("polls newly arrived mail between bounded initial-sync chunks without skipping older mail",async()=>{
  const saved=new Map<string,string>();
  vi.mocked(getSetting).mockImplementation(async key=>saved.get(key) || null);
  vi.mocked(setSetting).mockImplementation(async(key,value)=>{saved.set(key,value);});
  const c=client();vi.mocked(c.listThreads).mockResolvedValue({threads:[{id:"older-first",snippet:""},{id:"older-second",snippet:""}]});
  c.getHistory=vi.fn().mockResolvedValue({historyId:"200",history:[{messagesAdded:[{message:{id:"new-message",threadId:"new-thread",labelIds:["INBOX"]}}]}]});
  await initialSync(c,"interleave",365,undefined,{maxThreads:1});
  expect(updateAccountSyncState).not.toHaveBeenCalled();
  await syncInitialChanges(c,"interleave");
  expect(c.getThread).toHaveBeenNthCalledWith(2,"new-thread","full");
  expect(updateAccountSyncState).not.toHaveBeenCalled();
  expect(JSON.parse(saved.get("gmail_initial_sync:interleave")!).historyId).toBe("200");
  await initialSync(c,"interleave",365,undefined,{maxThreads:1});
  expect(c.getThread).toHaveBeenNthCalledWith(3,"older-second","full");
  expect(updateAccountSyncState).toHaveBeenCalledWith("interleave","200");
  vi.mocked(getSetting).mockResolvedValue(null);vi.mocked(setSetting).mockResolvedValue(undefined);
 });

});
