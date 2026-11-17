import { escapeHtml } from "./sanitize";

export interface ParsedCsv {
  headers: string[];
  rows: Record<string, string>[];
  emailColumn: string | null;
}

/**
 * Parses raw CSV string into rows of objects keyed by header names.
 * Supports RFC 4180 quotes, commas inside quotes, and line breaks.
 */
export function parseCsv(text: string): ParsedCsv {
  const trimmed = text.trim();
  if (!trimmed) {
    return { headers: [], rows: [], emailColumn: null };
  }

  const lines: string[][] = [];
  let currentField = "";
  let insideQuotes = false;
  let currentLine: string[] = [];

  for (let i = 0; i < trimmed.length; i++) {
    const char = trimmed[i];
    const nextChar = trimmed[i + 1];

    if (char === '"') {
      if (insideQuotes && nextChar === '"') {
        currentField += '"';
        i++; // skip escaped quote
      } else {
        insideQuotes = !insideQuotes;
      }
    } else if (char === "," && !insideQuotes) {
      currentLine.push(currentField.trim());
      currentField = "";
    } else if ((char === "\r" || char === "\n") && !insideQuotes) {
      if (char === "\r" && nextChar === "\n") i++;
      currentLine.push(currentField.trim());
      if (currentLine.some((f) => f.length > 0)) {
        lines.push(currentLine);
      }
      currentLine = [];
      currentField = "";
    } else {
      currentField += char;
    }
  }

  // Push final field/line
  if (currentField.length > 0 || currentLine.length > 0) {
    currentLine.push(currentField.trim());
    if (currentLine.some((f) => f.length > 0)) {
      lines.push(currentLine);
    }
  }

  if (lines.length < 2) {
    return { headers: lines[0] ?? [], rows: [], emailColumn: null };
  }

  const headers = (lines[0] ?? []).map((h) => h.trim());
  const rows: Record<string, string>[] = [];

  for (let r = 1; r < lines.length; r++) {
    const rowValues = lines[r] ?? [];
    const rowObj: Record<string, string> = {};
    for (let c = 0; c < headers.length; c++) {
      const headerName = headers[c];
      if (headerName) {
        rowObj[headerName] = rowValues[c] ?? "";
      }
    }
    rows.push(rowObj);
  }

  const emailColumn = detectEmailColumn(headers, rows);

  return { headers, rows, emailColumn };
}

/**
 * Auto-detect which column contains email addresses.
 */
export function detectEmailColumn(
  headers: string[],
  rows: Record<string, string>[],
): string | null {
  // Check header names first
  const commonNames = ["email", "e-mail", "recipient", "mail", "to", "email_address"];
  for (const h of headers) {
    if (commonNames.includes(h.toLowerCase())) {
      return h;
    }
  }

  // Check row values for @ symbol
  for (const h of headers) {
    const hasAt = rows.some((r) => (r[h] ?? "").includes("@"));
    if (hasAt) {
      return h;
    }
  }

  return headers[0] ?? null;
}

/**
 * Replaces {{field}} placeholders with row values.
 */
export function interpolateMergeText(
  template: string,
  row: Record<string, string>,
  escapeValues = true,
): string {
  let result = template;

  for (const [key, val] of Object.entries(row)) {
    const valueToUse = escapeValues ? escapeHtml(val) : val;
    // Replace {{key}}, {{key_name}}, {{Key}}
    const pattern = new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, "gi");
    result = result.replace(pattern, valueToUse);
  }

  return result;
}
