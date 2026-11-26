import { describe, it, expect, vi, beforeEach } from "vitest";
import { initialSync, deltaSync, syncInitialChanges, backfillBodies } from "./sync";
import { GmailApiError, GmailClient, type GmailMessage, type GmailThread } from "./client";

import { deleteThread, setThreadLabels, getThreadLabelIds, upsertThread } from "../db/threads";
import { getSetting, setSetting } from "../db/settings";
import { upsertMessage, getThreadMessageStates, setMessageFlags, getThreadsMissingBodies, deleteThreadMessagesExcept, type MessageState } from "../db/messages";
import { updateAccountSyncState } from "../db/accounts";
import { deleteEmbeddingsForMessages } from "../db/embeddings";
import { applyFiltersToMessages } from "../filters/filterEngine";

vi.mock("../db/labels",()=>({upsertLabel:vi.fn()}));
vi.mock("@/services/ai/embeddingIndexer",()=>({indexBatchForAccount:vi.fn()}));
// Mock all DB modules
vi.mock("../db/threads", () => ({
  deleteThread: vi.fn(),
  upsertThread: vi.fn(),
  setThreadLabels: vi.fn(),
  getThreadLabelIds: vi.fn().mockResolvedValue([]),
  getThreadById: vi.fn().mockResolvedValue(undefined),
  getMutedThreadIds: vi.fn().mockResolvedValue(new Set()),
}));
vi.mock("../db/messages", () => ({
  upsertMessage: vi.fn(),
  getThreadMessageStates: vi.fn().mockResolvedValue([]),
  setMessageFlags: vi.fn(),
  deleteThreadMessagesExcept: vi.fn(),
  getThreadsMissingBodies: vi.fn().mockResolvedValue([]),
}));
vi.mock("../db/embeddings", () => ({ deleteEmbeddingsForMessages: vi.fn().mockResolvedValue(undefined) }));
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
  parseGmailMessage: (msg: { id: string; threadId: string; labelIds: string[]; payload?: { parts?: unknown[] } }) => ({
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
    bodyHtml: msg.payload?.parts ? "<p>test</p>" : null,
    bodyText: msg.payload?.parts ? "test" : null,
    rawSize: 100,
    internalDate: "1704067200000",
    hasAttachments: false,
    attachments: [],
  }),
}));

function message(id: string, threadId: string, labelIds: string[] = ["INBOX", "UNREAD"], full = true): GmailMessage {
  return {
    id, threadId, labelIds, snippet: "test", historyId: "200", internalDate: "1704067200000", sizeEstimate: 100,
    payload: { partId: "", mimeType: "text/plain", filename: "", headers: [], body: { size: 0 }, ...(full ? { parts: [] } : {}) },
  } as GmailMessage;
}

function state(id: string, overrides: Partial<MessageState> = {}): MessageState {
  return { id, subject: `Subject ${id}`, snippet: `snippet ${id}`, date: 1, is_read: 1, is_starred: 0, body_cached: 1, ...overrides };
}

type ThreadFactory = (threadId: string, format?: string) => GmailThread | null;
const defaultThread: ThreadFactory = (threadId) => ({ id: threadId, historyId: "200", messages: [message(`msg-${threadId}`, threadId)] });

function createMockClient(historyItems: unknown[], threads: ThreadFactory = defaultThread): GmailClient {
  const getThread = vi.fn().mockImplementation(async (threadId: string, format?: string) => threads(threadId, format));
  return {
    getHistory: vi.fn().mockResolvedValue({ history: historyItems, historyId: "200" }),
    getThread,
    getThreads: vi.fn().mockImplementation(async (ids: string[], format?: string) => new Map(ids.map((id) => [id, threads(id, format)]))),
    getMessages: vi.fn().mockImplementation(async (ids: string[]) => new Map(ids.map((id) => [id, message(id, id.split("/")[0]!)]))),
    modifyThread: vi.fn(),
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

    const onMessagesStored = vi.fn();
    await deltaSync(client, "account-1", "99", undefined, onMessagesStored);

    expect(onMessagesStored).toHaveBeenCalledExactlyOnceWith(1);
    expect(mockNotify).toHaveBeenCalledWith(
      "Sender",
      "Subject for msg-thread-1",
      "thread-1",
      "account-1",
      "sender@example.com",
      "snippet",
      "2024-01-01T00:00:00Z",
    );
  });

  it("does not send notification for read messages", async () => {
    const client = createMockClient([
      { id: "100", messagesAdded: [{ message: { id: "msg-thread-2", threadId: "thread-2", labelIds: ["INBOX"] } }] },
    ]);

    await deltaSync(client, "account-1", "99");

    expect(mockNotify).not.toHaveBeenCalled();
  });

  it("does not send notification for sent messages", async () => {
    const client = createMockClient([
      { id: "100", messagesAdded: [{ message: { id: "msg-thread-3", threadId: "thread-3", labelIds: ["SENT"] } }] },
    ]);

    await deltaSync(client, "account-1", "99");

    expect(mockNotify).not.toHaveBeenCalled();
  });
});


describe("deltaSync missing threads", () => {
  beforeEach(() => vi.clearAllMocks());

  it("does not report new mail progress for a label-only change", async () => {
    const client = createMockClient([{
      id: "100",
      labelsAdded: [{ message: { id: "msg-thread-1", threadId: "thread-1" }, labelIds: ["STARRED"] }],
    }]);
    const onMessagesStored = vi.fn();

    await deltaSync(client, "account-1", "99", undefined, onMessagesStored);

    // The thread isn't stored locally, so it is downloaded as before.
    expect(client.getThreads).toHaveBeenCalledWith(["thread-1"], "full");
    expect(upsertMessage).toHaveBeenCalled();
    expect(onMessagesStored).not.toHaveBeenCalled();
  });

  it("removes a thread whose last local message was deleted, without downloading anything", async () => {
    vi.mocked(getThreadMessageStates).mockResolvedValueOnce([state("deleted-message")]);
    const client = createMockClient([{
      messagesDeleted: [{ message: { id: "deleted-message", threadId: "deleted-thread" } }],
    }]);
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await deltaSync(client, "account-1", "99");
      expect(deleteThreadMessagesExcept).toHaveBeenCalledWith("account-1", "deleted-thread", []);
      expect(deleteThread).toHaveBeenCalledExactlyOnceWith("account-1", "deleted-thread");
      expect(client.getThreads).not.toHaveBeenCalled();
      expect(updateAccountSyncState).toHaveBeenCalledWith("account-1", "200");
      expect(errorLog).not.toHaveBeenCalled();
    } finally {
      errorLog.mockRestore();
    }
  });

  it("removes a thread that 404s when downloaded and advances the sync cursor", async () => {
    const client = createMockClient([{
      labelsAdded: [{ message: { id: "gone", threadId: "gone-thread" }, labelIds: ["Label_1"] }],
    }], () => null);

    await deltaSync(client, "account-1", "99");

    expect(deleteThread).toHaveBeenCalledExactlyOnceWith("account-1", "gone-thread");
    expect(updateAccountSyncState).toHaveBeenCalledWith("account-1", "200");
  });

  it("preserves cached threads on other API errors", async () => {
    const client = createMockClient([{
      labelsAdded: [{ message: { id: "message", threadId: "thread" }, labelIds: ["Label_1"] }],
    }]);
    const error = new GmailApiError(403, "Forbidden");
    vi.mocked(client.getThreads).mockRejectedValue(error);

    await expect(deltaSync(client, "account-1", "99")).rejects.toThrow("Forbidden");
    expect(updateAccountSyncState).not.toHaveBeenCalled();
    expect(deleteThread).not.toHaveBeenCalled();
  });
});

describe("deltaSync incremental changes", () => {
  beforeEach(() => vi.clearAllMocks());

  it("applies label-only history locally without downloading the thread", async () => {
    // Thread T has m1 and m2 locally; elsewhere the user read m2 and archived the conversation.
    vi.mocked(getThreadMessageStates)
      .mockResolvedValueOnce([state("T"), state("m2", { is_read: 0 })])
      .mockResolvedValueOnce([state("T"), state("m2")]);
    vi.mocked(getThreadLabelIds).mockResolvedValueOnce(["INBOX", "UNREAD", "Label_1"]);
    const client = createMockClient([
      { labelsRemoved: [{ message: { id: "m2", threadId: "T" }, labelIds: ["UNREAD"] }] },
      { labelsRemoved: [{ message: { id: "T", threadId: "T" }, labelIds: ["INBOX"] }, { message: { id: "m2", threadId: "T" }, labelIds: ["INBOX"] }] },
    ]);

    await deltaSync(client, "account-1", "99");

    expect(client.getThreads).not.toHaveBeenCalled();
    expect(client.getMessages).not.toHaveBeenCalled();
    expect(setMessageFlags).toHaveBeenCalledWith("account-1", "m2", { isRead: true, isStarred: undefined });
    expect(setThreadLabels).toHaveBeenCalledWith("account-1", "T", ["Label_1"]);
    expect(upsertThread).toHaveBeenCalledWith(expect.objectContaining({ id: "T", isRead: true, messageCount: 2, snippet: "snippet m2" }));
    expect(updateAccountSyncState).toHaveBeenCalledWith("account-1", "200");
  });

  it("fetches only the new message of a reply to a stored thread", async () => {
    vi.mocked(getThreadMessageStates)
      .mockResolvedValueOnce([state("T"), state("m2")])
      .mockResolvedValueOnce([state("T"), state("m2"), state("m3", { is_read: 0 })]);
    vi.mocked(getThreadLabelIds).mockResolvedValueOnce(["Label_1"]);
    const client = createMockClient([{ messagesAdded: [{ message: { id: "m3", threadId: "T", labelIds: ["INBOX", "UNREAD"] } }] }]);
    vi.mocked(client.getMessages).mockResolvedValue(new Map([["m3", message("m3", "T")]]));
    const onMessagesStored = vi.fn();

    await deltaSync(client, "account-1", "99", undefined, onMessagesStored);

    expect(client.getMessages).toHaveBeenCalledWith(["m3"], "full");
    expect(client.getThreads).not.toHaveBeenCalled();
    expect(upsertMessage).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: "m3", bodyCached: true }));
    expect(setThreadLabels).toHaveBeenCalledWith("account-1", "T", expect.arrayContaining(["Label_1", "INBOX", "UNREAD"]));
    expect(upsertThread).toHaveBeenCalledWith(expect.objectContaining({ id: "T", messageCount: 3, isRead: false }));
    expect(applyFiltersToMessages).toHaveBeenCalledWith("account-1", [expect.objectContaining({ id: "m3" })]);
    expect(onMessagesStored).toHaveBeenCalledExactlyOnceWith(1);
  });

  it("stores a brand-new conversation from messages.get alone", async () => {
    vi.mocked(getThreadMessageStates).mockResolvedValueOnce([]).mockResolvedValueOnce([state("N", { is_read: 0 })]);
    const client = createMockClient([{ messagesAdded: [{ message: { id: "N", threadId: "N", labelIds: ["INBOX", "UNREAD"] } }] }]);
    vi.mocked(client.getMessages).mockResolvedValue(new Map([["N", message("N", "N")]]));

    await deltaSync(client, "account-1", "99");

    expect(client.getMessages).toHaveBeenCalledWith(["N"], "full");
    expect(client.getThreads).not.toHaveBeenCalled();
    // The thread row exists before its message is inserted.
    expect(vi.mocked(upsertThread).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(upsertMessage).mock.invocationCallOrder[0]!);
  });

  it("downloads a reply whose thread isn't stored locally (older messages are missing)", async () => {
    const client = createMockClient([{ messagesAdded: [{ message: { id: "m9", threadId: "OLD", labelIds: ["INBOX"] } }] }]);

    await deltaSync(client, "account-1", "99");

    expect(client.getThreads).toHaveBeenCalledWith(["OLD"], "full");
    expect(client.getMessages).not.toHaveBeenCalled();
  });

  it("uses format=minimal when a removal can't be settled from history (another message may keep the label)", async () => {
    // m2 is the user's own reply (SENT, no INBOX), so archiving only produced an event for T.
    vi.mocked(getThreadMessageStates).mockResolvedValue([state("T"), state("m2")]);
    vi.mocked(getThreadLabelIds).mockResolvedValueOnce(["INBOX", "SENT"]);
    const client = createMockClient(
      [{ labelsRemoved: [{ message: { id: "T", threadId: "T" }, labelIds: ["INBOX"] }] }],
      (id) => ({ id, historyId: "200", messages: [message("T", "T", []), message("m2", "T", ["SENT"])] }),
    );

    await deltaSync(client, "account-1", "99");
    vi.mocked(getThreadMessageStates).mockResolvedValue([]);

    expect(client.getThreads).toHaveBeenCalledExactlyOnceWith(["T"], "minimal");
    expect(setThreadLabels).toHaveBeenCalledWith("account-1", "T", ["SENT"]);
  });

  it("re-downloads a thread when format=minimal shows messages we don't have", async () => {
    vi.mocked(getThreadMessageStates).mockResolvedValue([state("T")]);
    const client = createMockClient(
      [{ labelsRemoved: [{ message: { id: "x", threadId: "T" }, labelIds: ["Label_1"] }] }],
      (id, format) => ({ id, historyId: "200", messages: [message("T", "T", [], format !== "minimal"), message("unknown", "T", ["INBOX"], format !== "minimal")] }),
    );

    await deltaSync(client, "account-1", "99");
    vi.mocked(getThreadMessageStates).mockResolvedValue([]);

    expect(client.getThreads).toHaveBeenNthCalledWith(1, ["T"], "minimal");
    expect(client.getThreads).toHaveBeenNthCalledWith(2, ["T"], "full");
    expect(upsertMessage).toHaveBeenCalledWith(expect.objectContaining({ id: "unknown" }));
  });
});


describe("initialSync streaming and recovery",()=>{
 beforeEach(()=>vi.clearAllMocks());
 function client(){
  const c=createMockClient([],(id)=>({id,historyId:"999",messages:[message("m-"+id,id,["INBOX"],false)]}));
  return Object.assign(c,{getProfile:vi.fn().mockResolvedValue({historyId:"100"}),listLabels:vi.fn().mockResolvedValue({labels:[]}),listThreads:vi.fn()}) as unknown as GmailClient;
 }
 it("stores the first page before listing the next, publishes progress, and retains the pre-download history cursor",async()=>{
  const c=client();vi.mocked(c.listThreads).mockResolvedValueOnce({threads:[{id:"first",snippet:"",historyId:""}],nextPageToken:"page2",resultSizeEstimate:2}).mockImplementationOnce(async()=>{
   expect(upsertMessage).toHaveBeenCalledWith(expect.objectContaining({id:"m-first"}));return {threads:[{id:"second",snippet:"",historyId:""}]};
  });
  const progress=vi.fn();const event=vi.spyOn(window,"dispatchEvent");await initialSync(c,"initial",365,progress);
  expect(c.listThreads).toHaveBeenCalledWith(expect.objectContaining({maxResults:500}));
  expect(updateAccountSyncState).toHaveBeenCalledWith("initial","100");
  expect(progress).toHaveBeenLastCalledWith({phase:"done",current:2,total:2});
  expect(event).toHaveBeenCalledWith(expect.objectContaining({type:"suitemail-sync-progress"}));event.mockRestore();
 });
 it("downloads headers in batched format=metadata requests and defers bodies and filters",async()=>{
  const c=client();vi.mocked(c.listThreads).mockResolvedValue({threads:Array.from({length:30},(_,i)=>({id:`t${i}`,snippet:"",historyId:""}))});
  await initialSync(c,"meta");
  expect(vi.mocked(c.getThreads).mock.calls.map(([ids,format])=>[ids.length,format])).toEqual([[25,"metadata"],[5,"metadata"]]);
  expect(c.getThread).not.toHaveBeenCalled();
  expect(upsertMessage).toHaveBeenCalledWith(expect.objectContaining({id:"m-t0",bodyHtml:null,bodyText:null,bodyCached:false}));
  expect(applyFiltersToMessages).not.toHaveBeenCalled();
 });
 it("reports saved messages and skips threads that disappeared before fetching", async () => {
  const c = client();
  vi.mocked(c.listThreads).mockResolvedValue({ threads: [{ id: "missing", snippet: "", historyId: "" }, { id: "saved", snippet: "", historyId: "" }] });
  vi.mocked(c.getThreads).mockResolvedValueOnce(new Map([["missing", null], ["saved", { id: "saved", historyId: "1", messages: [message("m-saved", "saved", ["INBOX"], false)] }]]));
  const onMessagesStored = vi.fn();

  await initialSync(c, "initial", 365, undefined, { onMessagesStored });

  expect(onMessagesStored).toHaveBeenCalledExactlyOnceWith(1);
 });
 it("does not skip a failed thread or mark a partially downloaded mailbox complete; resumes completed work",async()=>{
  const c=client();vi.mocked(c.listThreads).mockImplementation(async({pageToken}={})=>pageToken?{threads:[{id:"second",snippet:"",historyId:""}]}:{threads:[{id:"first",snippet:"",historyId:""}],nextPageToken:"p2"});
  const fetchThreads=vi.mocked(c.getThreads).getMockImplementation()!;
  vi.mocked(c.getThreads).mockImplementation(async(ids,...args)=>{if(ids.includes("second"))throw new GmailApiError(403,"quota");return fetchThreads(ids,...args);});
  await expect(initialSync(c,"resume")).rejects.toThrow("quota");expect(updateAccountSyncState).not.toHaveBeenCalled();
  const checkpoint=vi.mocked(setSetting).mock.calls.filter(([key])=>key==="gmail_initial_sync:resume").at(-1)![1];
  expect(JSON.parse(checkpoint)).toMatchObject({pageToken:"p2",completed:1,storedIds:[]});
  vi.mocked(getSetting).mockImplementation(async(key)=>key==="gmail_initial_sync:resume"?checkpoint:null);
  vi.mocked(c.getThreads).mockClear().mockImplementation(fetchThreads);
  await initialSync(c,"resume");expect(c.getThreads).toHaveBeenCalledExactlyOnceWith(["second"],"metadata");expect(updateAccountSyncState).toHaveBeenCalledWith("resume","100");
  vi.mocked(getSetting).mockResolvedValue(null);
 });
 it("stops at the deadline and resumes from its checkpoint",async()=>{
  const saved=new Map<string,string>();
  vi.mocked(getSetting).mockImplementation(async key=>saved.get(key) || null);
  vi.mocked(setSetting).mockImplementation(async(key,value)=>{saved.set(key,value);});
  const c=client();vi.mocked(c.listThreads).mockResolvedValue({threads:Array.from({length:60},(_,i)=>({id:`t${i}`,snippet:"",historyId:""}))});
  let now=1_000_000;const clock=vi.spyOn(Date,"now").mockImplementation(()=>now);
  vi.mocked(c.getThreads).mockImplementation(async(ids)=>{now+=10_000;return new Map(ids.map(id=>[id,{id,historyId:"1",messages:[message("m-"+id,id,["INBOX"],false)]}]));});
  await initialSync(c,"budget",365,undefined,{deadline:1_015_000});
  expect(c.getThreads).toHaveBeenCalledTimes(2);expect(updateAccountSyncState).not.toHaveBeenCalled();
  expect(JSON.parse(saved.get("gmail_initial_sync:budget")!).completed).toBe(50);
  await initialSync(c,"budget");
  expect(vi.mocked(c.getThreads).mock.calls[2]![0]).toEqual(Array.from({length:10},(_,i)=>`t${50+i}`));
  expect(updateAccountSyncState).toHaveBeenCalledWith("budget","100");
  clock.mockRestore();vi.mocked(getSetting).mockResolvedValue(null);vi.mocked(setSetting).mockResolvedValue(undefined);
 });
 it("polls newly arrived mail between bounded initial-sync chunks without skipping older mail",async()=>{
  const saved=new Map<string,string>();
  vi.mocked(getSetting).mockImplementation(async key=>saved.get(key) || null);
  vi.mocked(setSetting).mockImplementation(async(key,value)=>{saved.set(key,value);});
  const c=client();vi.mocked(c.listThreads).mockResolvedValue({threads:[{id:"older-first",snippet:"",historyId:""},{id:"older-second",snippet:"",historyId:""}]});
  c.getHistory=vi.fn().mockResolvedValue({historyId:"200",history:[{messagesAdded:[{message:{id:"new-message",threadId:"new-thread",labelIds:["INBOX"]}}]}]});
  await initialSync(c,"interleave",365,undefined,{maxThreads:1});
  expect(updateAccountSyncState).not.toHaveBeenCalled();
  await syncInitialChanges(c,"interleave");
  expect(c.getThreads).toHaveBeenNthCalledWith(2,["new-thread"],"full");
  expect(updateAccountSyncState).not.toHaveBeenCalled();
  expect(JSON.parse(saved.get("gmail_initial_sync:interleave")!).historyId).toBe("200");
  await initialSync(c,"interleave",365,undefined,{maxThreads:1});
  expect(c.getThreads).toHaveBeenNthCalledWith(3,["older-second"],"metadata");
  expect(updateAccountSyncState).toHaveBeenCalledWith("interleave","200");
  vi.mocked(getSetting).mockResolvedValue(null);vi.mocked(setSetting).mockResolvedValue(undefined);
 });
});

describe("backfillBodies", () => {
  beforeEach(() => vi.clearAllMocks());

  it("downloads full threads for metadata-only messages, then rebuilds their embeddings and applies filters", async () => {
    vi.mocked(getThreadsMissingBodies).mockResolvedValueOnce(["t1", "t2"]).mockResolvedValueOnce([]);
    vi.mocked(getThreadMessageStates).mockResolvedValue([state("m-t1", { body_cached: 0 })]);
    const client = createMockClient([], (id) => ({ id, historyId: "1", messages: [message(`m-${id}`, id)] }));

    const stored = await backfillBodies(client, "acct", { sinceMs: 123 });

    expect(stored).toBe(2);
    expect(getThreadsMissingBodies).toHaveBeenCalledWith("acct", 8, 123);
    expect(client.getThreads).toHaveBeenCalledExactlyOnceWith(["t1", "t2"], "full");
    expect(upsertMessage).toHaveBeenCalledWith(expect.objectContaining({ id: "m-t1", bodyCached: true, bodyHtml: "<p>test</p>" }));
    expect(deleteEmbeddingsForMessages).toHaveBeenCalledWith("acct", ["m-t1"]);
    expect(applyFiltersToMessages).toHaveBeenCalled();
    vi.mocked(getThreadMessageStates).mockResolvedValue([]);
  });

  it("deletes threads that no longer exist and stops when no progress is possible", async () => {
    vi.mocked(getThreadsMissingBodies).mockResolvedValue(["gone"]);
    const client = createMockClient([], () => null);

    await backfillBodies(client, "acct");

    expect(deleteThread).toHaveBeenCalledWith("acct", "gone");
    expect(client.getThreads).toHaveBeenCalledTimes(1);
    vi.mocked(getThreadsMissingBodies).mockResolvedValue([]);
  });

  it("does nothing past its deadline", async () => {
    vi.mocked(getThreadsMissingBodies).mockResolvedValue(["t1"]);
    const client = createMockClient([]);
    expect(await backfillBodies(client, "acct", { deadline: Date.now() - 1 })).toBe(0);
    expect(await backfillBodies(client, "acct", { shouldStop: () => true })).toBe(0);
    expect(client.getThreads).not.toHaveBeenCalled();
    vi.mocked(getThreadsMissingBodies).mockResolvedValue([]);
  });
});
