import { useCallback, useEffect, useRef, useState } from "react";
import { getSetting } from "@/services/db/settings";
import { normalizeEmail } from "@/utils/emailUtils";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";

export const SEND_CHECKS = [
  { key: "send_check_attachment", label: "Missing attachment", description: "When your message refers to a file but has no attachment", defaultOn: true },
  { key: "send_check_external", label: "External recipients", description: "When recipients use a different email domain from your From address", defaultOn: false },
  { key: "send_check_reply_all", label: "Large Reply All", description: "When a Reply All goes to 10 or more people", defaultOn: true },
] as const;

interface SendDetails {
  from: string;
  to: string[];
  cc: string[];
  bcc?: string[];
  mode: string;
  text: string;
  hasAttachment?: boolean;
  scheduled?: boolean;
}

function mailbox(address: string): string {
  return normalizeEmail(address.match(/<([^<>]+)>\s*$/)?.[1] ?? address);
}

export function getSendWarnings(details: SendDetails, enabled: boolean[]): string[] {
  const recipients = [...new Set([...details.to, ...details.cc, ...(details.bcc ?? [])].map(mailbox))];
  const fromDomain = mailbox(details.from).split("@").pop();
  const external = recipients.filter((address) => address.includes("@") && address.split("@").pop() !== fromDomain);
  const warnings: string[] = [];
  if (enabled[0] && !details.hasAttachment && /\b(attach(?:ed|ment|ments|ing)|enclos(?:ed|ure))\b/i.test(details.text)) {
    warnings.push("Your message mentions an attachment. No file is attached.");
  }
  if (enabled[1] && external.length) warnings.push(`Outside your email domain: ${external.join(", ")}.`);
  if (enabled[2] && details.mode === "replyAll" && recipients.length >= 10) warnings.push(`This Reply All goes to ${recipients.length} people.`);
  return warnings;
}

interface PendingReview {
  details: SendDetails;
  warnings: string[];
  resolve: (accepted: boolean) => void;
}

export function useSendChecks(active = true) {
  const [review, setReview] = useState<PendingReview | null>(null);
  const pending = useRef<PendingReview | null>(null);
  const checking = useRef(false);
  const generation = useRef(0);

  const finish = useCallback((accepted: boolean) => {
    generation.current++;
    pending.current?.resolve(accepted);
    pending.current = null;
    setReview(null);
  }, []);

  useEffect(() => () => {
    generation.current++;
    pending.current?.resolve(false);
    pending.current = null;
  }, []);

  useEffect(() => {
    if (!active) finish(false);
  }, [active, finish]);

  const approveSend = useCallback(async (details: SendDetails): Promise<boolean> => {
    if (checking.current || pending.current) return false;
    checking.current = true;
    const request = generation.current;
    let enabled: boolean[];
    try {
      enabled = await Promise.all(SEND_CHECKS.map(async (check) => {
        const setting = await getSetting(check.key).catch(() => null);
        return setting == null ? check.defaultOn : setting === "true";
      }));
    } finally {
      checking.current = false;
    }
    if (generation.current !== request) return false;

    const warnings = getSendWarnings(details, enabled);
    if (!warnings.length) return true;

    return new Promise((resolve) => {
      const next = { details, warnings, resolve };
      pending.current = next;
      setReview(next);
    });
  }, []);

  return {
    approveSend,
    sendReviewDialog: (
      <Modal isOpen={review !== null} onClose={() => finish(false)} title="Review this message" zIndex="z-[90]" width="sm:w-96">
        {review && (
          <div className="p-4 space-y-4">
            <ul className="list-disc pl-5 text-sm text-text-primary break-words">
              {review.warnings.map((warning) => <li key={warning}>{warning}</li>)}
            </ul>
            <dl className="text-xs text-text-secondary break-words">
              <dt className="font-semibold">From</dt><dd>{mailbox(review.details.from)}</dd>
              <dt className="font-semibold mt-2">To</dt><dd>{review.details.to.map(mailbox).join(", ")}</dd>
              {!!review.details.cc.length && <><dt className="font-semibold mt-2">Cc</dt><dd>{review.details.cc.map(mailbox).join(", ")}</dd></>}
              {!!review.details.bcc?.length && <><dt className="font-semibold mt-2">Bcc</dt><dd>{review.details.bcc.map(mailbox).join(", ")}</dd></>}
            </dl>
            <div className="flex flex-wrap justify-end gap-2">
              <Button autoFocus variant="secondary" onClick={() => finish(false)}>Keep editing</Button>
              <Button variant="primary" onClick={() => finish(true)}>{review.details.scheduled ? "Schedule anyway" : "Send anyway"}</Button>
            </div>
          </div>
        )}
      </Modal>
    ),
  };
}
