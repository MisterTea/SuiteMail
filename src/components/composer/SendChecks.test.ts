import { describe, expect, it } from "vitest";
import { getSendWarnings } from "./SendChecks";

const message = { from: "Owner <owner@example.test>", to: ["Reader <reader@example.test>"], cc: [], mode: "new", text: "" };

describe("pre-send checks", () => {
  it("uses the actual domain and respects a disabled check", () => {
    expect(getSendWarnings(message, [true, true, true])).toEqual([]);
    const external = { ...message, bcc: ["Private <reader@other.test>"] };
    expect(getSendWarnings(external, [true, true, true])).toEqual(["Outside your email domain: reader@other.test."]);
    expect(getSendWarnings(external, [true, false, true])).toEqual([]);
  });

  it("warns about a missing attachment unless an attachment is present", () => {
    const withReference = { ...message, text: "I attached the monthly statement." };
    expect(getSendWarnings(withReference, [true, false, true])).toHaveLength(1);
    expect(getSendWarnings({ ...withReference, hasAttachment: true }, [true, false, true])).toEqual([]);
  });

  it("counts unique recipients across To and Cc for large Reply All", () => {
    const recipients = Array.from({ length: 10 }, (_, index) => `reader-${index}@example.test`);
    const reply = { ...message, mode: "replyAll", to: recipients.slice(0, 8), cc: recipients.slice(8) };
    expect(getSendWarnings(reply, [true, false, true])).toEqual(["This Reply All goes to 10 people."]);
    expect(getSendWarnings({ ...reply, cc: [recipients[8]!, `Duplicate <${recipients[0]}>`] }, [true, false, true])).toEqual([]);
  });
});
