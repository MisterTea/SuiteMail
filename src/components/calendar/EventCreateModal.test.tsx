import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { EventCreateModal } from "./EventCreateModal";
import type { EventTarget } from "@/services/calendar/eventCreation";
vi.mock("@/components/ui/Modal", () => ({ Modal: ({ children }: { children: ReactNode }) => <div role="dialog">{children}</div> }));
const target = { id: "cal", account_id: "other", accountEmail: "organizer@example.com", display_name: "Work", is_primary: 1, canCreate: true, canInvite: true } as EventTarget;
const initial = { summary: "Design review", startTime: "2030-01-02T15:00:00-06:00", endTime: "2030-01-02T16:00:00-06:00", attendees: [{ email: "bob@example.com" }], calendarId: "cal" };

describe("calendar event review", () => {
  beforeEach(() => vi.clearAllMocks());
  it("does not create until confirmation, preserves edits and allows cancel", async () => {
    const create = vi.fn().mockResolvedValue(undefined), close = vi.fn();
    render(<EventCreateModal calendars={[target]} targets={[target]} initialValues={initial} onCreate={create} onClose={close} />);
    expect(screen.getByLabelText("Title")).toHaveValue("Design review");
    expect(screen.getByLabelText("Invitees")).toHaveValue("bob@example.com");
    expect(create).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Updated review" } });
    fireEvent.click(screen.getByRole("button", { name: "Create & send invitations" }));
    await waitFor(() => expect(create).toHaveBeenCalledWith(expect.objectContaining({ summary: "Updated review", startTime: "2030-01-02T21:00:00.000Z", attendees: [{ email: "bob@example.com" }] })));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(close).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("requires missing schedules and valid addresses", () => {
    render(<EventCreateModal initialValues={{ ...initial, startTime: "", endTime: "" }} onCreate={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByLabelText("Start")).toHaveValue("");
    expect(screen.getByRole("button", { name: "Create & send invitations" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Invitees"), { target: { value: "invalid address" } });
    expect(screen.getByText("Enter valid email addresses, separated by commas.")).toBeInTheDocument();
  });

  it("requires an invitation-capable calendar and supports switching accounts", async () => {
    const personal = { ...target, id: "personal", accountEmail: "personal@example.com", canInvite: false };
    render(<EventCreateModal calendars={[personal, target]} targets={[personal, target]} initialValues={{ ...initial, calendarId: "personal" }} onCreate={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Create & send invitations" })).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent("cannot send invitations");
    fireEvent.change(screen.getByLabelText("Calendar"), { target: { value: "cal" } });
    expect(screen.getByRole("button", { name: "Create & send invitations" })).toBeEnabled();
  });

  it("blocks repeated submissions while creating and displays provider errors", async () => {
    let reject!: (error: Error) => void;
    const create = vi.fn(() => new Promise<void>((_, fail) => { reject = fail; }));
    render(<EventCreateModal initialValues={initial} onCreate={create} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Create & send invitations" }));
    expect(screen.getByRole("button", { name: "Creating…" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Creating…" }));
    expect(create).toHaveBeenCalledTimes(1);
    await act(async () => reject(new Error("Calendar access denied")));
    expect(screen.getByRole("alert")).toHaveTextContent("Calendar access denied");
    expect(screen.getByRole("button", { name: "Create & send invitations" })).toBeEnabled();
  });

  it("preserves ordinary creation and all-day dates", async () => {
    const create = vi.fn().mockResolvedValue(undefined);
    render(<EventCreateModal initialValues={{ summary: "Offsite", isAllDay: true, startTime: "2030-01-02", endTime: "2030-01-03" }} onCreate={create} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Create event" }));
    await waitFor(() => expect(create).toHaveBeenCalledWith(expect.objectContaining({ isAllDay: true, startTime: "2030-01-02", endTime: "2030-01-03", attendees: [] })));
  });
});
