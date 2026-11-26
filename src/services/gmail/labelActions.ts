/**
 * Gmail label changes for thread actions that can be applied as messages.batchModify.
 * Mirrors GmailApiProvider (archive, markRead, star, spam, moveToFolder, addLabel, removeLabel).
 * Trash and permanent delete are excluded: they are not plain label edits.
 */
export interface GmailLabelDelta {
  addLabelIds: string[];
  removeLabelIds: string[];
}

export function gmailLabelDelta(operationType: string, params: Record<string, unknown>): GmailLabelDelta | null {
  switch (operationType) {
    case "archive":
      return { addLabelIds: [], removeLabelIds: ["INBOX"] };
    case "markRead":
      return params.read ? { addLabelIds: [], removeLabelIds: ["UNREAD"] } : { addLabelIds: ["UNREAD"], removeLabelIds: [] };
    case "star":
      return params.starred ? { addLabelIds: ["STARRED"], removeLabelIds: [] } : { addLabelIds: [], removeLabelIds: ["STARRED"] };
    case "spam":
      return params.isSpam ? { addLabelIds: ["SPAM"], removeLabelIds: ["INBOX"] } : { addLabelIds: ["INBOX"], removeLabelIds: ["SPAM"] };
    case "moveToFolder":
      return typeof params.folderPath === "string" ? { addLabelIds: [params.folderPath], removeLabelIds: [] } : null;
    case "addLabel":
      return typeof params.labelId === "string" ? { addLabelIds: [params.labelId], removeLabelIds: [] } : null;
    case "removeLabel":
      return typeof params.labelId === "string" ? { addLabelIds: [], removeLabelIds: [params.labelId] } : null;
    default:
      return null;
  }
}
