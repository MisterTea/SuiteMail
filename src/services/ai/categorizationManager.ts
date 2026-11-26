import { isAiAvailable } from "./providerManager";
import { categorizeThreads } from "./aiService";
import { getMailboxAiBoolean } from "./mailboxAiSettings";
import {
  getRecentRuleCategorizedThreadIds,
  setThreadCategoriesBatch,
} from "@/services/db/threadCategories";

export async function categorizeNewThreads(accountId: string): Promise<void> {
  try {
    // Check if AI and auto-categorize are enabled for this mailbox
    const aiAvail = await isAiAvailable(accountId);
    if (!aiAvail) return;

    const autoCat = await getMailboxAiBoolean("ai_auto_categorize", accountId);
    if (!autoCat) return;

    // Get recently rule-categorized inbox threads (AI refines, not replaces)
    const threads = await getRecentRuleCategorizedThreadIds(accountId, 20);
    if (threads.length === 0) return;

    // Categorize via AI (refines rule-based results)
    const categories = await categorizeThreads(
      threads.map((t) => ({
        id: t.id,
        subject: t.subject ?? "",
        snippet: t.snippet ?? "",
        fromAddress: t.fromAddress ?? "",
      })),
    );

    if (categories.size === 0) return;

    // Store results (setThreadCategoriesBatch respects manual overrides)
    await setThreadCategoriesBatch(accountId, categories);
  } catch (err) {
    // Non-blocking — log and continue
    console.error("Auto-categorization failed:", err);
  }
}
