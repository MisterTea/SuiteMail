import OpenAI from "openai";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { getSetting } from "@/services/db/settings";
import { PI_EMAIL_TOOLS, executePiEmailTool } from "./piEmailTools";
import type { SearchResult } from "@/services/db/search";

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
}

const PI_AGENT_SYSTEM_PROMPT = `You are SuperMail's intelligent local AI email assistant powered by Gemma 4.
You have direct access to the user's local SQLite email database via tools.

Guidelines:
1. Always search or query before answering questions about the user's emails.
2. Use 'search_emails' for finding emails by sender, keywords, dates, or read/unread state.
3. If an email thread snippet is insufficient, use 'get_thread' with the thread_id to inspect the full conversation history.
4. Use 'get_email_stats' when the user asks for counts, volume, top contacts, or statistics.
5. Use 'run_readonly_sql' only if standard tools cannot satisfy the specific aggregation or query requested.
6. Provide concise, clear, and direct answers. Cite dates, senders, and subjects where helpful.
7. If no relevant emails are found after searching, honestly inform the user. Never invent email content.`;

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
    const validTools = ["search_emails", "get_thread", "get_email_stats", "run_readonly_sql"];
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

        const toolResult = await executePiEmailTool(tc.function.name, args, accountId);

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
      const toolResult = await executePiEmailTool(textToolCall.toolName, textToolCall.args, accountId);

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
