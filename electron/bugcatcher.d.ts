export const DEFAULT_BUGCATCHER_URL: string;
export function submitBugcatcherReport(
  url: string,
  report: { type: "bug" | "feature"; text: string; screenshot?: string; context: string },
  fetchImpl?: typeof fetch,
): Promise<{ success: boolean; number?: number; error?: string }>;
