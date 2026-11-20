import { Agent, type AgentTool, type StreamFn } from "@earendil-works/pi-agent-core";
import type { AssistantMessage, Message, Model } from "@earendil-works/pi-ai";
import { AssistantMessageEventStream } from "@earendil-works/pi-ai/utils/event-stream";
import type OpenAI from "openai";

/** Adapt our desktop IPC / Android transport to Pi's agent runtime. */
export async function runPiFilterRuntime(options: {
  model: string;
  systemPrompt: string;
  prompt: string;
  tools: AgentTool[];
  maxSteps: number;
  complete: (messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[]) => Promise<OpenAI.Chat.Completions.ChatCompletionMessage>;
  normalize: (message: OpenAI.Chat.Completions.ChatCompletionMessage) => OpenAI.Chat.Completions.ChatCompletionMessage;
  isComplete: () => boolean;
  onStep?: (step: number) => void;
}): Promise<void> {
  let steps = 0;
  const model: Model<"openai-completions"> = {
    id: options.model, name: options.model, api: "openai-completions", provider: "local",
    baseUrl: "", reasoning: false, input: ["text"], contextWindow: 32768, maxTokens: 4096,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  };
  const streamFn: StreamFn = (_model, context) => {
    const stream = new AssistantMessageEventStream();
    const message: AssistantMessage = {
      role: "assistant", content: [], api: model.api, provider: model.provider, model: model.id,
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      stopReason: "stop", timestamp: Date.now(),
    };
    void (async () => {
      try {
        if (++steps > options.maxSteps) throw new Error("The agent reached its iteration limit without a verified filter. Refine the description and try again.");
        options.onStep?.(steps);
        const response = options.normalize(await options.complete(toOpenAiMessages(context.messages)));
        if (response.content) message.content.push({ type: "text", text: response.content });
        for (const call of response.tool_calls ?? []) {
          if (call.type !== "function") continue;
          message.content.push({ type: "toolCall", id: call.id, name: call.function.name,
            arguments: JSON.parse(call.function.arguments || "{}") });
        }
        message.stopReason = message.content.some((part) => part.type === "toolCall") ? "toolUse" : "stop";
        stream.push({ type: "start", partial: message });
        stream.push({ type: "done", reason: message.stopReason, message });
      } catch (err) {
        message.stopReason = "error";
        message.errorMessage = err instanceof Error ? err.message : String(err);
        stream.push({ type: "error", reason: "error", error: message });
      }
      stream.end();
    })();
    return stream;
  };
  const agent: Agent = new Agent({
    initialState: { model, systemPrompt: options.systemPrompt, tools: options.tools },
    streamFn,
    toolExecution: "sequential",
    finishTurn: ({ message }) => {
      if (options.isComplete()) return { action: "end" };
      if (message.stopReason === "error" || message.stopReason === "aborted") return;
      // Local chat templates cannot resume an assistant-only transcript. A real
      // follow-up persists in Pi's history and separates consecutive prose turns.
      if (!message.content.some((part) => part.type === "toolCall")) {
        agent.followUp({
          role: "user",
          content: "Continue using the available tools. Inspect real inbox emails, propose a rule with suggest_filter, and review its validation feedback. If the request cannot be satisfied safely, call cannot_create_filter with the reason.",
          timestamp: Date.now(),
        });
      }
      return { action: "continue" };
    },
  });
  await agent.prompt(options.prompt);
  if (agent.state.errorMessage) throw new Error(agent.state.errorMessage);
}

function toOpenAiMessages(messages: Message[]): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
  return messages.map((message): OpenAI.Chat.Completions.ChatCompletionMessageParam => {
    const text = typeof message.content === "string" ? message.content : message.content
      .filter((part) => part.type === "text").map((part) => part.text).join("\n");
    if (message.role === "toolResult") return { role: "tool", tool_call_id: message.toolCallId, content: text };
    if (message.role === "assistant") {
      const calls = message.content.filter((part) => part.type === "toolCall").map((part) => ({
        id: part.id, type: "function" as const,
        function: { name: part.name, arguments: JSON.stringify(part.arguments) },
      }));
      return { role: "assistant", content: text || null, ...(calls.length ? { tool_calls: calls } : {}) };
    }
    return { role: message.role, content: text };
  });
}
