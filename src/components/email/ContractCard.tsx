import { useEffect, useRef, useState } from "react";
import { FileSignature, ShieldAlert } from "lucide-react";
import type { DbMessage } from "@/services/db/messages";
import { verifyContract } from "@/services/contracts/contractCrypto";
import {
  acknowledgeContractKeyShown,
  observeContractKey,
  type ContractKeyObservation,
} from "@/services/contracts/contractKeys";
import {
  contractTextForEditor,
  parseContractFromMessage,
} from "@/services/contracts/contractMessage";
import { useComposerStore } from "@/stores/composerStore";

interface ContractCardProps {
  message: DbMessage;
}

function formatFingerprint(fingerprint: string): string {
  return fingerprint.toUpperCase().replace(/(.{4})/g, "$1 ").trim();
}

/**
 * Recovered contract under a message, plus a one-time alert for a new key.
 */
export function ContractCard({ message }: ContractCardProps) {
  const openComposer = useComposerStore((s) => s.openComposer);
  const [verified, setVerified] = useState<boolean | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [alert, setAlert] = useState<ContractKeyObservation | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const alertedRef = useRef<ContractKeyObservation | null>(null);

  useEffect(() => {
    const parsed = parseContractFromMessage(message.body_html, message.body_text);
    if (!parsed) return;

    let cancelled = false;
    (async () => {
      const result = await verifyContract(parsed);
      if (cancelled) return;
      setVerified(result.verified);
      setText(result.text);

      if (!result.verified || !message.from_address) return;
      const observation = await observeContractKey(message.from_address, parsed.publicKey);
      if (cancelled) return;
      if (observation.isNew) {
        alertedRef.current = observation;
        setAlert(observation);
        await acknowledgeContractKeyShown(
          message.from_address,
          observation.fingerprint,
          parsed.publicKey,
        );
      } else if (
        alertedRef.current
        && alertedRef.current.fingerprint === observation.fingerprint
      ) {
        setAlert(alertedRef.current);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [message.body_html, message.body_text, message.from_address]);

  if (verified == null && text == null) return null;

  const replyText = text ? contractTextForEditor(text) : "";

  const handleRevise = () => {
    const replyTo = message.reply_to ?? message.from_address;
    openComposer({
      accountId: message.account_id,
      mode: "reply",
      to: replyTo ? [replyTo] : [],
      subject: `Re: ${message.subject ?? ""}`,
      bodyHtml: "",
      threadId: message.thread_id,
      inReplyToMessageId: message.id,
      contractActive: true,
      contractText: replyText,
    });
  };

  return (
    <section
      className="mt-3 rounded-xl border border-border-primary bg-bg-secondary/40"
      aria-label="Contract"
    >
      {alert && !dismissed && message.from_address && (
        <div
          role="alert"
          className="m-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-sm text-text-primary"
        >
          <div className="flex items-start gap-2">
            <ShieldAlert size={16} className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-300" />
            <div className="min-w-0">
              <p>
                New public key for {message.from_address}. Verify the authority of this key before you rely on this contract.
              </p>
              {alert.keyChanged && (
                <p className="mt-1">This address previously used a different key.</p>
              )}
              <p className="mt-1 font-mono text-xs text-text-secondary break-all">
                Fingerprint: {formatFingerprint(alert.fingerprint)}
              </p>
              <button
                type="button"
                onClick={() => setDismissed(true)}
                className="mt-2 text-xs font-medium text-text-secondary hover:text-text-primary cursor-pointer"
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="px-3 py-2.5">
        <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-text-secondary">
          <FileSignature size={14} />
          <span>Contract</span>
          <span className={verified ? "text-emerald-600 dark:text-emerald-400" : "text-danger"}>
            {verified ? "Signature verified" : "Signature could not be verified"}
          </span>
        </div>
        {text != null && (
          <pre className="whitespace-pre-wrap font-sans text-sm text-text-primary">{text}</pre>
        )}
        <button
          type="button"
          onClick={handleRevise}
          className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-white hover:bg-accent-hover cursor-pointer"
        >
          Revise and reply
        </button>
      </div>
    </section>
  );
}
