import OpenAI from "openai";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { getSetting } from "@/services/db/settings";
import { PI_EMAIL_TOOLS, executePiEmailTool } from "./piEmailTools";
import type { SearchResult } from "@/services/db/search";
import type { FilterCriteria, FilterActions } from "@/services/db/filters";
import type { ConsentRequest } from "./consent/types";

const safeFetch: typeof fetch = async (input, init) => {
  try {
    return await tauriFetch(input, init);
  } catch (err) {
    if (
      err instanceof TypeError &&
      (err.message.includes("invoke") || err.message.includes("undefined"))
    ) {
      return await globalThis.fetch(input, init);
    }
    throw err;
  }
};

export interface PiAgentOptions {
  question: string;
  accountId: string;
  serverUrl?: string;
  model?: string;
  maxSteps?: number;
  onConsentRequest?: (request: ConsentRequest) => Promise<boolean>;
}

export interface PiAgentToolExecutionRecord {
  tool: string;
  args: Record<string, unknown>;
  output: string;
}

export interface PiAgentResult {
  answer: string;
  sourceMessages: SearchResult[];
  toolCallsExecuted: PiAgentToolExecutionRecord[];
  consentRefused?: boolean;
}

const PI_AGENT_SYSTEM_PROMPT = `You are SuperMail's intelligent local AI email assistant powered by Gemma 4.
You have direct access to the user's local SQLite email database and email operations via tools.

Guidelines:
1. Always search or query before answering questions about the user's emails.
2. Use 'search_emails' for finding emails by sender, keywords, dates, or read/unread state.
3. Use 'semantic_search_emails' when searching for broad concepts, topics, or ideas that might be phrased in multiple ways without knowing the exact words.
4. If an email thread snippet is insufficient, use 'get_thread' with the thread_id to inspect the full conversation history.
5. Use 'get_email_stats' when the user asks for counts, volume, top contacts, or statistics.
6. Use 'send_email' to send an email, or 'batch_send_emails' to send a batch of multiple emails.
7. Use 'move_emails' to move email threads to a folder (Archive, Trash, Spam, etc.).
8. Use 'relabel_emails' to add or remove labels from email threads.
9. Use 'delete_emails' to delete email threads.
10. IMPORTANT: Any mutable operation (sending emails, moving/relabeling, deleting) requires explicit user consent via a confirmation popover before it executes. If the user refuses consent, the agentic loop will immediately stop.
11. Use 'run_readonly_sql' only if standard tools cannot satisfy the specific aggregation or query requested.
12. Provide concise, clear, and direct answers. Cite dates, senders, and subjects where helpful.
13. If no relevant emails are found after searching, honestly inform the user. Never invent email content.`;

/**
 * Extract a markdown-embedded JSON tool call if Gemma produces a text-based tool invocation.
 */
function extractTextToolCall(content: string): { toolName: string; args: Record<string, unknown> } | null {
  const jsonMatch = content.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
  const candidate = jsonMatch ? jsonMatch[1] : content.trim().startsWith("{") && content.trim().endsWith("}") ? content.trim() : null;
  if (!candidate) return null;

  try {
    const parsed = JSON.parse(candidate);
    const toolName = parsed.tool ?? parsed.function ?? parsed.name;
    const args = parsed.parameters ?? parsed.arguments ?? parsed.args ?? {};
    const validTools = [
      "search_emails",
      "semantic_search_emails",
      "get_thread",
      "get_email_stats",
      "run_readonly_sql",
      "list_labels",
      "suggest_filter",
      "send_email",
      "batch_send_emails",
      "move_emails",
      "relabel_emails",
      "delete_emails",
    ];
    if (typeof toolName === "string" && validTools.includes(toolName)) {
      return {
        toolName,
        args: typeof args === "object" && args !== null ? (args as Record<string, unknown>) : {},
      };
    }
  } catch {
    // not valid JSON tool call
  }
  return null;
}

/**
 * Run an agentic question-answering loop using the local Pi harness and SQLite tools.
 */
export async function runPiEmailAgent(options: PiAgentOptions): Promise<PiAgentResult> {
  const { question, accountId, maxSteps = 5 } = options;

  const serverUrl =
    options.serverUrl ??
    (await getSetting("pi_server_url")) ??
    "http://localhost:3000";

  const model =
    options.model ??
    (await getSetting("pi_model")) ??
    "gemma-4-e4b";

  const client = new OpenAI({
    baseURL: `${serverUrl.replace(/\/+$/, "")}/v1`,
    apiKey: "pi-harness",
    dangerouslyAllowBrowser: true,
    fetch: safeFetch,
  });

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: PI_AGENT_SYSTEM_PROMPT },
    { role: "user", content: question },
  ];

  const sourceMessagesMap = new Map<string, SearchResult>();
  const toolCallsExecuted: PiAgentToolExecutionRecord[] = [];

  for (let step = 0; step < maxSteps; step++) {
    const response = await client.chat.completions.create({
      model,
      messages,
      tools: PI_EMAIL_TOOLS,
      tool_choice: "auto",
    });

    const choice = response.choices[0];
    if (!choice?.message) {
      break;
    }

    const message = choice.message;

    // Check for standard OpenAI tool calls
    if (message.tool_calls && message.tool_calls.length > 0) {
      messages.push(message);

      for (const tc of message.tool_calls) {
        if (tc.type !== "function") continue;
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(tc.function.arguments || "{}");
        } catch {
          args = {};
        }

        const toolResult = options.onConsentRequest
          ? await executePiEmailTool(tc.function.name, args, accountId, {
              onConsentRequest: options.onConsentRequest,
            })
          : await executePiEmailTool(tc.function.name, args, accountId);

        if (toolResult.consentRefused) {
          toolCallsExecuted.push({
            tool: tc.function.name,
            args,
            output: toolResult.text,
          });
          return {
            answer: `Operation cancelled: User refused consent for '${tc.function.name}'. The agentic loop was stopped.`,
            sourceMessages: Array.from(sourceMessagesMap.values()),
            toolCallsExecuted,
            consentRefused: true,
          };
        }

        if (toolResult.sourceMessages) {
          for (const msg of toolResult.sourceMessages) {
            sourceMessagesMap.set(msg.message_id, msg);
          }
        }

        toolCallsExecuted.push({
          tool: tc.function.name,
          args,
          output: toolResult.text,
        });

        messages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: toolResult.text,
        });
      }
      continue;
    }

    // Check for text-based JSON tool call fallback (common with compact local models)
    const content = message.content ?? "";
    const textToolCall = extractTextToolCall(content);
    if (textToolCall) {
      const toolResult = options.onConsentRequest
        ? await executePiEmailTool(textToolCall.toolName, textToolCall.args, accountId, {
            onConsentRequest: options.onConsentRequest,
          })
        : await executePiEmailTool(textToolCall.toolName, textToolCall.args, accountId);

      if (toolResult.consentRefused) {
        toolCallsExecuted.push({
          tool: textToolCall.toolName,
          args: textToolCall.args,
          output: toolResult.text,
        });
        return {
          answer: `Operation cancelled: User refused consent for '${textToolCall.toolName}'. The agentic loop was stopped.`,
          sourceMessages: Array.from(sourceMessagesMap.values()),
          toolCallsExecuted,
          consentRefused: true,
        };
      }

      if (toolResult.sourceMessages) {
        for (const msg of toolResult.sourceMessages) {
          sourceMessagesMap.set(msg.message_id, msg);
        }
      }

      toolCallsExecuted.push({
        tool: textToolCall.toolName,
        args: textToolCall.args,
        output: toolResult.text,
      });

      messages.push({ role: "assistant", content });
      messages.push({
        role: "user",
        content: `Tool '${textToolCall.toolName}' result:\n${toolResult.text}\n\nPlease proceed to answer the user's question or invoke another tool if needed.`,
      });
      continue;
    }

    // No tool calls: this is the final synthesized answer
    return {
      answer: content.trim(),
      sourceMessages: Array.from(sourceMessagesMap.values()),
      toolCallsExecuted,
    };
  }

  // If loop exhausted maxSteps, request a final answer synthesis
  messages.push({
    role: "user",
    content: "Based on the tool results retrieved so far, please provide your final answer to the original question.",
  });

  const finalResponse = await client.chat.completions.create({
    model,
    messages,
  });

  return {
    answer: finalResponse.choices[0]?.message?.content?.trim() ?? "Unable to complete query.",
    sourceMessages: Array.from(sourceMessagesMap.values()),
    toolCallsExecuted,
  };
}

// ============================================================================
// Filter Suggestion via Pi Agent
// ============================================================================

export interface SuggestFilterOptions {
  prompt: string;
  accountId: string;
  serverUrl?: string;
  model?: string;
  maxSteps?: number;
}

export interface SuggestedFilter {
  name: string;
  criteria: FilterCriteria;
  actions: FilterActions;
  explanation?: string;
  newFolder?: string;
}

export interface SuggestFilterResult {
  filter: SuggestedFilter;
  toolCallsExecuted: PiAgentToolExecutionRecord[];
}

const PI_FILTER_AGENT_SYSTEM_PROMPT = `You are SuperMail's intelligent email filter architect powered by Gemma 4.
The user specifies what they want an email filter to do in plain English.
Your goal is to determine the optimal filter rule consisting of:
- name: A short descriptive name for the filter rule
- newFolder?: Optional name of a new folder/label to create for these emails (e.g. "Newsletters", "Receipts", "Taxes", "Urgent")
- criteria: { from?: string, to?: string, subject?: string, body?: string, hasAttachment?: boolean }
- actions: { applyLabel?: string, archive?: boolean, star?: boolean, markRead?: boolean, trash?: boolean }
- explanation: A concise explanation of why this filter satisfies the user's intent

Guidelines:
1. You may call 'search_emails' to check real sender addresses, domains, or subjects from the local SQLite inbox if you need to determine the correct criteria.
2. You may call 'list_labels' to check existing labels for this account.
3. If the user asks to organize, categorize, or file emails into a folder or label that doesn't exist yet, specify 'newFolder' with the folder name, and set 'actions.applyLabel' to that folder name.
4. Once you determine the filter, call the 'suggest_filter' tool with { name, newFolder, criteria, actions, explanation }.
5. If calling tools via JSON text, output:
\`\`\`json
{
  "tool": "suggest_filter",
  "parameters": {
    "name": "...",
    "newFolder": "...",
    "criteria": { ... },
    "actions": { ... },
    "explanation": "..."
  }
}
\`\`\`
6. Always ensure the suggested filter has a meaningful name, at least one criterion, and at least one action.`;

export function parseFilterFromPayload(data: unknown): SuggestedFilter | null {
  if (!data || typeof data !== "object") return null;
  const obj = data as Record<string, unknown>;
  const name =
    typeof obj.name === "string" && obj.name.trim()
      ? obj.name.trim()
      : "Suggested Filter";

  const rawCriteria = (
    obj.criteria && typeof obj.criteria === "object" ? obj.criteria : {}
  ) as Record<string, unknown>;
  const criteria: FilterCriteria = {};
  if (typeof rawCriteria.from === "string" && rawCriteria.from.trim()) {
    criteria.from = rawCriteria.from.trim();
  }
  if (typeof rawCriteria.to === "string" && rawCriteria.to.trim()) {
    criteria.to = rawCriteria.to.trim();
  }
  if (typeof rawCriteria.subject === "string" && rawCriteria.subject.trim()) {
    criteria.subject = rawCriteria.subject.trim();
  }
  if (typeof rawCriteria.body === "string" && rawCriteria.body.trim()) {
    criteria.body = rawCriteria.body.trim();
  }
  if (typeof rawCriteria.hasAttachment === "boolean") {
    criteria.hasAttachment = rawCriteria.hasAttachment;
  }

  const rawActions = (
    obj.actions && typeof obj.actions === "object" ? obj.actions : {}
  ) as Record<string, unknown>;
  const actions: FilterActions = {};
  if (typeof rawActions.applyLabel === "string" && rawActions.applyLabel.trim()) {
    actions.applyLabel = rawActions.applyLabel.trim();
  }
  if (typeof rawActions.archive === "boolean") {
    actions.archive = rawActions.archive;
  }
  if (typeof rawActions.star === "boolean") {
    actions.star = rawActions.star;
  }
  if (typeof rawActions.markRead === "boolean") {
    actions.markRead = rawActions.markRead;
  }
  if (typeof rawActions.trash === "boolean") {
    actions.trash = rawActions.trash;
  }

  const explanation =
    typeof obj.explanation === "string" && obj.explanation.trim()
      ? obj.explanation.trim()
      : undefined;

  const newFolder =
    typeof obj.newFolder === "string" && obj.newFolder.trim()
      ? obj.newFolder.trim()
      : typeof obj.createFolder === "string" && obj.createFolder.trim()
        ? obj.createFolder.trim()
        : undefined;

  if (newFolder && !actions.applyLabel) {
    actions.applyLabel = newFolder;
  }

  const hasCriteria = Object.keys(criteria).length > 0;
  const hasActions = Object.keys(actions).length > 0 || Boolean(newFolder);
  if (!hasCriteria && !hasActions) {
    return null;
  }

  return { name, criteria, actions, explanation, newFolder };
}

export function extractFilterFromContent(content: string): SuggestedFilter | null {
  const jsonMatch = content.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
  const candidates: string[] = [];
  if (jsonMatch && jsonMatch[1]) candidates.push(jsonMatch[1]);
  const trimmed = content.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) candidates.push(trimmed);
  const firstBrace = content.indexOf("{");
  const lastBrace = content.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    candidates.push(content.substring(firstBrace, lastBrace + 1));
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed.parameters || parsed.args) {
        const fromParams = parseFilterFromPayload(parsed.parameters || parsed.args);
        if (fromParams) return fromParams;
      }
      const direct = parseFilterFromPayload(parsed);
      if (direct) return direct;
    } catch {
      // try next candidate
    }
  }
  return null;
}

/**
 * Suggest a new filter rule given a user's natural language request using the Pi agent.
 */
export async function suggestFilterWithPiAgent(
  options: SuggestFilterOptions,
): Promise<SuggestFilterResult> {
  const { prompt, accountId, maxSteps = 5 } = options;

  const serverUrl =
    options.serverUrl ??
    (await getSetting("pi_server_url")) ??
    "http://localhost:3000";

  const model =
    options.model ??
    (await getSetting("pi_model")) ??
    "gemma-4-e4b";

  const client = new OpenAI({
    baseURL: `${serverUrl.replace(/\/+$/, "")}/v1`,
    apiKey: "pi-harness",
    dangerouslyAllowBrowser: true,
    fetch: safeFetch,
  });

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: PI_FILTER_AGENT_SYSTEM_PROMPT },
    {
      role: "user",
      content: `Please configure an email filter based on this user instruction:\n"${prompt}"`,
    },
  ];

  const toolCallsExecuted: PiAgentToolExecutionRecord[] = [];

  for (let step = 0; step < maxSteps; step++) {
    const response = await client.chat.completions.create({
      model,
      messages,
      tools: PI_EMAIL_TOOLS,
      tool_choice: "auto",
    });

    const choice = response.choices[0];
    if (!choice?.message) {
      break;
    }

    const message = choice.message;

    // Check for standard OpenAI tool calls
    if (message.tool_calls && message.tool_calls.length > 0) {
      messages.push(message);

      for (const tc of message.tool_calls) {
        if (tc.type !== "function") continue;
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(tc.function.arguments || "{}");
        } catch {
          args = {};
        }

        toolCallsExecuted.push({
          tool: tc.function.name,
          args,
          output: tc.function.name === "suggest_filter" ? "Filter captured" : "Executed",
        });

        if (tc.function.name === "suggest_filter") {
          const suggested = parseFilterFromPayload(args);
          if (suggested) {
            return { filter: suggested, toolCallsExecuted };
          }
        }

        const toolResult = await executePiEmailTool(tc.function.name, args, accountId);
        messages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: toolResult.text,
        });
      }
      continue;
    }

    // Check for text-based JSON tool call fallback
    const content = message.content ?? "";
    const textToolCall = extractTextToolCall(content);
    if (textToolCall) {
      toolCallsExecuted.push({
        tool: textToolCall.toolName,
        args: textToolCall.args,
        output: textToolCall.toolName === "suggest_filter" ? "Filter captured" : "Executed",
      });

      if (textToolCall.toolName === "suggest_filter") {
        const suggested = parseFilterFromPayload(textToolCall.args);
        if (suggested) {
          return { filter: suggested, toolCallsExecuted };
        }
      }

      const toolResult = await executePiEmailTool(
        textToolCall.toolName,
        textToolCall.args,
        accountId,
      );
      messages.push({ role: "assistant", content });
      messages.push({
        role: "user",
        content: `Tool '${textToolCall.toolName}' result:\n${toolResult.text}\n\nPlease proceed to output the filter rule with 'suggest_filter'.`,
      });
      continue;
    }

    // Check if assistant provided direct JSON in content
    const directFilter = extractFilterFromContent(content);
    if (directFilter) {
      return { filter: directFilter, toolCallsExecuted };
    }

    messages.push({ role: "assistant", content });
    messages.push({
      role: "user",
      content:
        "Please finalize the filter specification and invoke 'suggest_filter' with { name, criteria, actions, explanation }.",
    });
  }

  // Fallback step
  messages.push({
    role: "user",
    content:
      "Output the final filter specification now as JSON with format: {\"name\": \"...\", \"criteria\": {...}, \"actions\": {...}, \"explanation\": \"...\"}",
  });

  const finalResponse = await client.chat.completions.create({
    model,
    messages,
  });

  const finalContent = finalResponse.choices[0]?.message?.content ?? "";
  const finalFilter = extractFilterFromContent(finalContent) ?? {
    name: "New Filter",
    criteria: {},
    actions: {},
    explanation: "Filter created from prompt.",
  };

  return {
    filter: finalFilter,
    toolCallsExecuted,
  };
}
