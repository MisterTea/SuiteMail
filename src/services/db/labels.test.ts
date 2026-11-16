import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/services/db/connection", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/db/connection")>();
  return {
    ...actual,
    getDb: vi.fn(),
  };
});

import { getDb } from "@/services/db/connection";
import { updateLabelSortOrder, ensureLabelOrFolder } from "./labels";
import { createMockDb } from "@/test/mocks";

const mockDb = createMockDb();

describe("labels service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getDb).mockResolvedValue(mockDb as unknown as Awaited<ReturnType<typeof getDb>>);
  });

  describe("updateLabelSortOrder", () => {
    it("executes all updates in parallel", async () => {
      const orders = [
        { id: "label-1", sortOrder: 0 },
        { id: "label-2", sortOrder: 1 },
        { id: "label-3", sortOrder: 2 },
      ];

      await updateLabelSortOrder("acc-1", orders);

      expect(mockDb.execute).toHaveBeenCalledTimes(3);
      expect(mockDb.execute).toHaveBeenCalledWith(
        expect.stringContaining("UPDATE labels SET sort_order"),
        [0, "acc-1", "label-1"],
      );
      expect(mockDb.execute).toHaveBeenCalledWith(
        expect.stringContaining("UPDATE labels SET sort_order"),
        [2, "acc-1", "label-3"],
      );
    });

    it("handles empty array", async () => {
      await updateLabelSortOrder("acc-1", []);
      expect(mockDb.execute).not.toHaveBeenCalled();
    });
  });

  describe("ensureLabelOrFolder", () => {
    it("returns existing label ID if label already exists", async () => {
      mockDb.select.mockResolvedValueOnce([
        { id: "lbl-invoices", name: "Invoices", type: "user" },
      ]);

      const id = await ensureLabelOrFolder("acc-1", "invoices");
      expect(id).toBe("lbl-invoices");
      expect(mockDb.execute).not.toHaveBeenCalled();
    });

    it("creates a new label in database if it does not exist", async () => {
      mockDb.select.mockResolvedValueOnce([]);
      mockDb.execute.mockResolvedValueOnce({ rowsAffected: 1 });

      const id = await ensureLabelOrFolder("acc-1", "Receipts");
      expect(id).toBeDefined();
      expect(mockDb.execute).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO labels"),
        expect.arrayContaining(["acc-1", "Receipts", "user"]),
      );
    });

    it("throws if folder name is empty", async () => {
      await expect(ensureLabelOrFolder("acc-1", "   ")).rejects.toThrow(
        "Folder name cannot be empty",
      );
    });
  });
});
