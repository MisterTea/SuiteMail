import { searchMessages, type SearchResult } from "@/services/db/search";
import { askInbox as callAskInbox } from "./aiService";
import { getActiveProviderName } from "./providerManager";
import { runPiEmailAgent } from "./piEmailAgent";
import type { ConsentRequest } from "./consent/types";

/**
 * Extract key search terms from a natural language question.
 * Uses simple heuristic: remove common stop words and question words.
 */
function extractSearchTerms(question: string): string {
  const stopWords = new Set([
    "a", "an", "the", "is", "are", "was", "were", "be", "been", "being",
    "have", "has", "had", "do", "does", "did", "will", "would", "could",
    "should", "may", "might", "shall", "can", "need", "dare", "ought",
    "used", "to", "of", "in", "for", "on", "with", "at", "by", "from",
    "as", "into", "through", "during", "before", "after", "above", "below",
    "between", "out", "off", "over", "under", "again", "further", "then",
    "once", "here", "there", "when", "where", "why", "how", "what", "which",
    "who", "whom", "this", "that", "these", "those", "am", "about", "up",
    "my", "me", "i", "we", "our", "you", "your", "he", "she", "it", "they",
    "them", "his", "her", "its", "and", "but", "or", "nor", "not", "so",
    "very", "just", "also", "any", "each", "every", "all", "both", "few",
    "more", "most", "some", "such", "no", "only", "own", "same", "than",
    "too", "if", "tell", "know", "find", "get", "got",
  ]);

  return question
    .replace(/[?!.,;:'"]/g, "")
    .split(/\s+/)
    .filter((word) => !stopWords.has(word.toLowerCase()) && word.length > 1)
    .join(" ");
}

export interface AskInboxOptions {
  onConsentRequest?: (request: ConsentRequest) => Promise<boolean>;
}

export interface AskInboxResult {
  answer: string;
  sourceMessages: SearchResult[];
}

/**
 * Answer a natural language question by searching the user's inbox
 * and using AI to synthesize an answer from the results.
 * When the active provider is 'pi', delegates to the Pi agent harness
 * with SQLite tool execution.
 */
export async function askMyInbox(
  question: string,
  accountId: string,
  options?: AskInboxOptions,
): Promise<AskInboxResult> {
  const activeProvider = await getActiveProviderName();

  if (activeProvider === "pi") {
    try {
      const agentResult = await runPiEmailAgent({
        question,
        accountId,
        onConsentRequest: options?.onConsentRequest,
      });
      if (agentResult.answer) {
        return {
          answer: agentResult.answer,
          sourceMessages: agentResult.sourceMessages,
        };
      }
    } catch (err) {
      console.warn("Pi email agent failed, falling back to standard search:", err);
    }
  }

  // Fallback: Extract search terms
  const terms = extractSearchTerms(question);
  if (!terms.trim()) {
    return {
      answer: "I couldn't understand the question. Please try rephrasing it.",
      sourceMessages: [],
    };
  }

  // Search messages using existing FTS
  let results = await searchMessages(terms, accountId, 15);

  // Hybrid search: augment with vector embeddings if few results or conceptual query
  try {
    const { searchSimilarMessages } = await import("./embeddingService");
    const semanticResults = await searchSimilarMessages(accountId, question, 8);
    const existingIds = new Set(results.map((r) => r.message_id));
    for (const sem of semanticResults) {
      if (!existingIds.has(sem.messageId)) {
        existingIds.add(sem.messageId);
        results.push({
          message_id: sem.messageId,
          account_id: accountId,
          thread_id: sem.threadId,
          subject: sem.subject,
          snippet: sem.snippet,
          from_name: sem.fromName,
          from_address: sem.fromAddress,
          date: sem.date,
          rank: -sem.similarityScore,
        });
      }
    }
  } catch {
    // Non-critical: continue with FTS results
  }

  if (results.length === 0) {
    return {
      answer: "I couldn't find any relevant emails for your question. Try a different question or check your search terms.",
      sourceMessages: [],
    };
  }

  // Format context for AI
  const context = results
    .map((r) => {
      const date = new Date(r.date > 1e11 ? r.date : r.date * 1000).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
      const from = r.from_name
        ? `${r.from_name} <${r.from_address}>`
        : (r.from_address ?? "Unknown");
      return `[Message ID: ${r.message_id}]\nFrom: ${from}\nDate: ${date}\nSubject: ${r.subject ?? "(no subject)"}\nPreview: ${r.snippet ?? ""}`;
    })
    .join("\n---\n");

  // Call AI
  const answer = await callAskInbox(question, accountId, context);

  return { answer, sourceMessages: results };
}
