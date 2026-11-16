import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/services/db/connection", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/db/connection")>();
  return {
    ...actual,
    getDb: vi.fn(),
  };
});

import { getDb } from "@/services/db/connection";
import { insertFilter } from "./filters";
import { createMockDb } from "@/test/mocks";

const mockDb = createMockDb();

describe("filters database service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getDb).mockResolvedValue(mockDb as unknown as Awaited<ReturnType<typeof getDb>>);
  });

  it("inserts filter with standard priority (sort_order = 0)", async () => {
    mockDb.execute.mockResolvedValueOnce({ rowsAffected: 1 });
    const id = await insertFilter({
      accountId: "acc-1",
      name: "Normal Filter",
      criteria: { from: "test@example.com" },
      actions: { star: true },
    });

    expect(id).toBeDefined();
    expect(mockDb.execute).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO filter_rules"),
      [
        id,
        "acc-1",
        "Normal Filter",
        1,
        JSON.stringify({ from: "test@example.com" }),
        JSON.stringify({ star: true }),
        0,
      ],
    );
  });

  it("inserts filter with highest priority (sort_order = min_order - 1)", async () => {
    mockDb.select.mockResolvedValueOnce([{ min_order: 3 }]);
    mockDb.execute.mockResolvedValueOnce({ rowsAffected: 1 });

    const id = await insertFilter({
      accountId: "acc-1",
      name: "Urgent Filter",
      criteria: { subject: "URGENT" },
      actions: { star: true, applyLabel: "VIP" },
      highestPriority: true,
    });

    expect(id).toBeDefined();
    expect(mockDb.select).toHaveBeenCalledWith(
      expect.stringContaining("SELECT MIN(sort_order)"),
      ["acc-1"],
    );
    expect(mockDb.execute).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO filter_rules"),
      [
        id,
        "acc-1",
        "Urgent Filter",
        1,
        JSON.stringify({ subject: "URGENT" }),
        JSON.stringify({ star: true, applyLabel: "VIP" }),
        2,
      ],
    );
  });
});
