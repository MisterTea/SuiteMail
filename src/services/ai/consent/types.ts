export type ConsentType =
  | "send_email"
  | "batch_send_emails"
  | "move_emails"
  | "relabel_emails"
  | "delete_emails"
  | "custom";

export interface EmailDetails {
  to: string[];
  subject: string;
  body: string;
  cc?: string[];
  bcc?: string[];
  threadId?: string;
}

export interface AffectedEmail {
  id: string;
  threadId: string;
  subject: string;
  sender: string;
  date: string | number;
  snippet?: string;
}

export interface EmailChanges {
  action: "move" | "relabel" | "delete" | string;
  targetFolder?: string;
  addLabels?: string[];
  removeLabels?: string[];
  permanent?: boolean;
}

export interface ConsentRequest {
  id: string;
  type: ConsentType;
  title: string;
  description: string;
  tool: string;
  args: Record<string, unknown>;
  emails?: EmailDetails[];
  affectedEmails?: AffectedEmail[];
  changes?: EmailChanges;
}

export class ConsentRefusedError extends Error {
  constructor(public readonly toolName: string, message?: string) {
    super(message ?? `Consent refused by user for tool '${toolName}'. Agentic loop stopped.`);
    this.name = "ConsentRefusedError";
  }
}

export const MUTABLE_TOOLS = new Set<string>([
  "send_email",
  "batch_send_emails",
  "move_emails",
  "relabel_emails",
  "delete_emails",
]);

export function isMutableTool(toolName: string): boolean {
  return MUTABLE_TOOLS.has(toolName);
}
