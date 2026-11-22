import type { SendAsAlias } from "@/services/db/sendAsAliases";

interface FromSelectorProps {
  aliases: SendAsAlias[];
  selectedEmail: string;
  onChange: (alias: SendAsAlias) => void;
}

/**
 * Dropdown for selecting a send-as alias in the composer.
 * Shows the effective sender when there is no choice of aliases.
 */
export function FromSelector({ aliases, selectedEmail, onChange }: FromSelectorProps) {
  if (!selectedEmail && aliases.length === 0) return null;

  return (
    <div className="flex items-center gap-2 group min-w-0">
      <span className="text-xs font-medium text-text-tertiary w-12 shrink-0 select-none transition-colors group-focus-within:text-accent">
        From
      </span>
      {aliases.length > 1 ? <select
        aria-label="From"
        title={selectedEmail}
        value={selectedEmail}
        onChange={(e) => {
          const alias = aliases.find((a) => a.email === e.target.value);
          if (alias) onChange(alias);
        }}
        className="flex-1 min-w-0 max-w-full truncate bg-transparent text-base sm:text-sm text-text-primary outline-none cursor-pointer hover:bg-bg-hover rounded-md px-1.5 py-1.5 sm:py-1 -ml-1 border border-transparent hover:border-border-primary/50 transition-colors"
      >
        {!aliases.some((alias) => alias.email === selectedEmail) && <option value={selectedEmail}>{selectedEmail}</option>}
        {aliases.map((alias) => (
          <option key={alias.id} value={alias.email}>
            {alias.displayName
              ? `${alias.displayName} <${alias.email}>`
              : alias.email}
          </option>
        ))}
      </select> : <span className="text-sm truncate" title={selectedEmail}>{selectedEmail}</span>}
    </div>
  );
}
