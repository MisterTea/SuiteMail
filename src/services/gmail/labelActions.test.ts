import { describe, expect, it } from "vitest";
import { gmailLabelDelta } from "./labelActions";

describe("gmailLabelDelta", () => {
  it.each([
    ["archive", {}, { addLabelIds: [], removeLabelIds: ["INBOX"] }],
    ["markRead", { read: true }, { addLabelIds: [], removeLabelIds: ["UNREAD"] }],
    ["markRead", { read: false }, { addLabelIds: ["UNREAD"], removeLabelIds: [] }],
    ["star", { starred: true }, { addLabelIds: ["STARRED"], removeLabelIds: [] }],
    ["star", { starred: false }, { addLabelIds: [], removeLabelIds: ["STARRED"] }],
    ["spam", { isSpam: true }, { addLabelIds: ["SPAM"], removeLabelIds: ["INBOX"] }],
    ["spam", { isSpam: false }, { addLabelIds: ["INBOX"], removeLabelIds: ["SPAM"] }],
    ["moveToFolder", { folderPath: "Label_7" }, { addLabelIds: ["Label_7"], removeLabelIds: [] }],
    ["addLabel", { labelId: "Label_1" }, { addLabelIds: ["Label_1"], removeLabelIds: [] }],
    ["removeLabel", { labelId: "Label_1" }, { addLabelIds: [], removeLabelIds: ["Label_1"] }],
  ])("matches the Gmail provider for %s %j", (op, params, delta) => {
    expect(gmailLabelDelta(op, params)).toEqual(delta);
  });

  it("leaves trash, delete, sends and malformed label ops to the per-thread path", () => {
    for (const op of ["trash", "permanentDelete", "sendMessage", "createDraft"]) expect(gmailLabelDelta(op, {})).toBeNull();
    expect(gmailLabelDelta("addLabel", {})).toBeNull();
    expect(gmailLabelDelta("moveToFolder", { folderPath: 3 })).toBeNull();
  });
});
