import { describe, it, expect } from "vitest";
import { resolveLabelChange } from "./DndProvider";

describe("resolveLabelChange", () => {
  it("returns null when target equals source (sidebar IDs)", () => {
    expect(resolveLabelChange("inbox", "inbox")).toBeNull();
  });

  it("returns null when target equals source (Gmail IDs)", () => {
    expect(resolveLabelChange("Label_1", "Label_1")).toBeNull();
  });

  it("adds TRASH and removes source when dragging to trash", () => {
    const result = resolveLabelChange("trash", "inbox");
    expect(result).toEqual({
      addLabelIds: ["TRASH"],
      removeLabelIds: ["INBOX"],
    });
  });

  it("adds TRASH without removing when source is all mail", () => {
    const result = resolveLabelChange("trash", "all");
    expect(result).toEqual({
      addLabelIds: ["TRASH"],
      removeLabelIds: [],
    });
  });

  it("only adds target when source is all mail", () => {
    const result = resolveLabelChange("inbox", "all");
    expect(result).toEqual({
      addLabelIds: ["INBOX"],
      removeLabelIds: [],
    });
  });

  it("adds target and removes source for normal label move", () => {
    const result = resolveLabelChange("starred", "inbox");
    expect(result).toEqual({
      addLabelIds: ["STARRED"],
      removeLabelIds: ["INBOX"],
    });
  });

  it("works with user label IDs (not in LABEL_MAP)", () => {
    const result = resolveLabelChange("Label_1", "inbox");
    expect(result).toEqual({
      addLabelIds: ["Label_1"],
      removeLabelIds: ["INBOX"],
    });
  });

  it("moves between two user labels", () => {
    const result = resolveLabelChange("Label_2", "Label_1");
    expect(result).toEqual({
      addLabelIds: ["Label_2"],
      removeLabelIds: ["Label_1"],
    });
  });

  it("marks important without removing the source folder", () => {
    expect(resolveLabelChange("important", "inbox")).toEqual({
      addLabelIds: ["IMPORTANT"],
      removeLabelIds: [],
      stayInView: true,
    });
  });

  it("moves between Gmail categories by swapping the category label", () => {
    expect(resolveLabelChange("promotions", "social")).toEqual({
      addLabelIds: ["CATEGORY_PROMOTIONS"],
      removeLabelIds: ["CATEGORY_SOCIAL"],
      stayInView: false,
    });
  });

  it("adds a category without archiving when dropped from the inbox", () => {
    expect(resolveLabelChange("updates", "inbox")).toEqual({
      addLabelIds: ["CATEGORY_UPDATES"],
      removeLabelIds: [],
      stayInView: true,
    });
  });

  it("moves from user label to system label", () => {
    const result = resolveLabelChange("inbox", "Label_1");
    expect(result).toEqual({
      addLabelIds: ["INBOX"],
      removeLabelIds: ["Label_1"],
    });
  });

  it("handles dragging between focused and other", () => {
    expect(resolveLabelChange("focused", "other")).toEqual({
      addLabelIds: ["INBOX", "FOCUSED"],
      removeLabelIds: [],
    });
    expect(resolveLabelChange("other", "focused")).toEqual({
      addLabelIds: ["INBOX"],
      removeLabelIds: ["FOCUSED"],
    });
    expect(resolveLabelChange("focused", "focused")).toBeNull();
    expect(resolveLabelChange("other", "other")).toBeNull();
  });
});
