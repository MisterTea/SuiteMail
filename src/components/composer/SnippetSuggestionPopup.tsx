import { useEffect, useRef } from "react";
import type { DbTemplate } from "@/services/db/templates";
import { Zap } from "lucide-react";

export interface SnippetSuggestionPopupProps {
  suggestions: DbTemplate[];
  selectedIndex: number;
  onSelect: (template: DbTemplate) => void;
  onClose: () => void;
}

export function SnippetSuggestionPopup({
  suggestions,
  selectedIndex,
  onSelect,
  onClose,
}: SnippetSuggestionPopupProps) {
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (suggestions.length === 0) {
      onClose();
    }
  }, [suggestions, onClose]);

  if (suggestions.length === 0) return null;

  return (
    <div
      ref={listRef}
      className="absolute bottom-full mb-2 left-4 z-50 w-72 max-h-56 overflow-y-auto bg-bg-secondary border border-border-primary rounded-lg shadow-xl py-1 text-xs"
    >
      <div className="px-3 py-1 text-[0.65rem] font-semibold text-text-tertiary uppercase tracking-wider flex items-center gap-1 border-b border-border-primary/50">
        <Zap size={10} className="text-accent" />
        Snippets (Tab / Enter to insert)
      </div>
      <div className="divide-y divide-border-primary/20">
        {suggestions.map((tmpl, idx) => {
          const isSelected = idx === selectedIndex;
          const shortcutDisplay = tmpl.shortcut?.startsWith(";") || tmpl.shortcut?.startsWith("/")
            ? tmpl.shortcut
            : `;${tmpl.shortcut}`;

          return (
            <button
              key={tmpl.id}
              type="button"
              onClick={() => onSelect(tmpl)}
              className={`w-full text-left px-3 py-2 flex items-center justify-between transition-colors ${
                isSelected
                  ? "bg-accent/15 text-accent font-medium"
                  : "text-text-primary hover:bg-bg-hover"
              }`}
            >
              <div className="flex-1 min-w-0 pr-2">
                <div className="truncate text-text-primary font-medium">{tmpl.name}</div>
                {tmpl.subject && (
                  <div className="truncate text-[0.7rem] text-text-tertiary">{tmpl.subject}</div>
                )}
              </div>
              <span className="shrink-0 px-1.5 py-0.5 rounded bg-bg-tertiary font-mono text-[0.65rem] text-text-secondary border border-border-primary">
                {shortcutDisplay}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
