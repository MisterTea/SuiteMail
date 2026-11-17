import { describe, it, expect } from "vitest";
import { parseCsv, detectEmailColumn, interpolateMergeText } from "./csvMailMerge";

describe("csvMailMerge", () => {
  it("parses CSV with headers and values", () => {
    const csv = `Email,Name,Company
alice@example.com,Alice Smith,Acme Corp
bob@example.com,"Bob, Jr.",Wayne Enterprises`;

    const res = parseCsv(csv);
    expect(res.headers).toEqual(["Email", "Name", "Company"]);
    expect(res.rows).toHaveLength(2);
    expect(res.rows[0]?.Email).toBe("alice@example.com");
    expect(res.rows[0]?.Name).toBe("Alice Smith");
    expect(res.rows[1]?.Name).toBe("Bob, Jr.");
    expect(res.emailColumn).toBe("Email");
  });

  it("handles empty and malformed CSVs gracefully", () => {
    const res = parseCsv("");
    expect(res.headers).toEqual([]);
    expect(res.rows).toEqual([]);
    expect(res.emailColumn).toBeNull();
  });

  it("detects email column from row content when header name is generic", () => {
    const headers = ["ID", "ContactPoint", "Department"];
    const rows = [
      { ID: "1", ContactPoint: "support@domain.com", Department: "Ops" },
    ];
    const col = detectEmailColumn(headers, rows);
    expect(col).toBe("ContactPoint");
  });

  it("interpolates merge tags accurately", () => {
    const template = "Hello {{Name}}, welcome to {{Company}}!";
    const row = { Name: "Carol", Company: "Stark Labs" };
    const merged = interpolateMergeText(template, row);
    expect(merged).toBe("Hello Carol, welcome to Stark Labs!");
  });

  it("escapes HTML values by default for safety", () => {
    const template = "<p>Welcome {{Name}}</p>";
    const row = { Name: "<script>alert(1)</script>" };
    const merged = interpolateMergeText(template, row, true);
    expect(merged).toContain("&lt;script&gt;");
  });
});
