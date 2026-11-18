import { useState, useRef, useCallback, useEffect } from "react";
import { searchContacts, type DbContact } from "@/services/db/contacts";
import { X } from "lucide-react";

interface AddressInputProps {
  label: string;
  addresses: string[];
  onChange: (addresses: string[]) => void;
  placeholder?: string;
  rightAction?: React.ReactNode;
  autoFocus?: boolean;
  isForwardMode?: boolean;
}

const AVATAR_COLORS = [
  "bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/25",
  "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/25",
  "bg-purple-500/15 text-purple-600 dark:text-purple-400 border-purple-500/25",
  "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/25",
  "bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/25",
  "bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 border-indigo-500/25",
  "bg-teal-500/15 text-teal-600 dark:text-teal-400 border-teal-500/25",
];

function getAvatarColor(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length] ?? "bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/25";
}

function parseEmail(raw: string): { displayName: string | null; email: string; initial: string } {
  const match = raw.match(/^(?:"?([^"]*)"?\s)?(?:<?(.+@[^>]+)>?)$/);
  if (match) {
    const name = match[1]?.trim();
    const email = match[2]?.trim() || raw.trim();
    const initialSource = name || email;
    const initial = initialSource.replace(/^[^a-zA-Z0-9]+/, "").charAt(0).toUpperCase() || "@";
    return { displayName: name || null, email, initial };
  }
  const clean = raw.trim();
  const initial = clean.replace(/^[^a-zA-Z0-9]+/, "").charAt(0).toUpperCase() || "@";
  return { displayName: null, email: clean, initial };
}

export function AddressInput({
  label,
  addresses,
  onChange,
  placeholder = "Add recipients...",
  rightAction,
  autoFocus = false,
  isForwardMode = false,
}: AddressInputProps) {
  const [inputValue, setInputValue] = useState("");
  const [suggestions, setSuggestions] = useState<DbContact[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const blurTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (autoFocus && addresses.length === 0) {
      inputRef.current?.focus();
      const raf = requestAnimationFrame(() => {
        inputRef.current?.focus();
      });
      const timer = setTimeout(() => {
        inputRef.current?.focus();
      }, 80);
      const lateTimer = setTimeout(() => {
        inputRef.current?.focus();
      }, 220);
      return () => {
        cancelAnimationFrame(raf);
        clearTimeout(timer);
        clearTimeout(lateTimer);
      };
    }
  }, [autoFocus, addresses.length]);

  useEffect(() => {
    return () => {
      if (blurTimerRef.current) clearTimeout(blurTimerRef.current);
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    };
  }, []);

  const handleInputChange = useCallback(
    (value: string) => {
      setInputValue(value);
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
      if (value.length >= 2) {
        searchTimerRef.current = setTimeout(async () => {
          const results = await searchContacts(value, 5);
          setSuggestions(results);
          setShowSuggestions(results.length > 0);
          setSelectedIdx(-1);
        }, 200);
      } else {
        setSuggestions([]);
        setShowSuggestions(false);
      }
    },
    [],
  );

  const addAddress = useCallback(
    (address: string) => {
      const trimmed = address.trim();
      if (trimmed && !addresses.includes(trimmed)) {
        onChange([...addresses, trimmed]);
      }
      setInputValue("");
      setSuggestions([]);
      setShowSuggestions(false);
      inputRef.current?.focus();
    },
    [addresses, onChange],
  );

  const removeAddress = useCallback(
    (index: number) => {
      onChange(addresses.filter((_, i) => i !== index));
    },
    [addresses, onChange],
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === "Tab" || e.key === ",") {
      e.preventDefault();
      if (showSuggestions && selectedIdx >= 0) {
        addAddress(suggestions[selectedIdx]!.email);
      } else if (inputValue.trim()) {
        addAddress(inputValue);
      }
    } else if (e.key === "Backspace" && !inputValue && addresses.length > 0) {
      removeAddress(addresses.length - 1);
    } else if (e.key === "ArrowDown" && showSuggestions) {
      e.preventDefault();
      setSelectedIdx((prev) => Math.min(prev + 1, suggestions.length - 1));
    } else if (e.key === "ArrowUp" && showSuggestions) {
      e.preventDefault();
      setSelectedIdx((prev) => Math.max(prev - 1, 0));
    } else if (e.key === "Escape") {
      setShowSuggestions(false);
    }
  };

  return (
    <div
      onClick={() => inputRef.current?.focus()}
      className={`flex items-start gap-2 group rounded-lg p-1.5 -m-1 transition-all duration-150 cursor-text ${
        isForwardMode && addresses.length === 0
          ? "bg-accent/5 ring-1 ring-accent/30 focus-within:ring-2 focus-within:ring-accent focus-within:bg-accent/10"
          : "focus-within:bg-bg-hover/40"
      }`}
    >
      <div className="flex items-center gap-1 pt-1.5 w-12 shrink-0 select-none">
        <span
          className={`text-xs font-medium transition-colors ${
            isForwardMode && addresses.length === 0
              ? "text-accent group-focus-within:text-accent font-semibold"
              : "text-text-tertiary group-focus-within:text-accent"
          }`}
        >
          {label}
        </span>
        {addresses.length > 1 && (
          <span
            className="text-[10px] font-mono px-1 py-0.2 rounded-full bg-bg-tertiary text-text-tertiary font-medium border border-border-secondary/60"
            title={`${addresses.length} recipients`}
          >
            {addresses.length}
          </span>
        )}
      </div>
      <div className="flex-1 flex flex-wrap items-center gap-1.5 min-h-[36px] sm:min-h-[32px] relative">
        {isForwardMode && addresses.length === 0 && !inputValue && (
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-accent bg-accent/15 border border-accent/25 px-2 py-0.5 rounded-full select-none shrink-0 animate-in fade-in duration-150">
            Forward to
          </span>
        )}
        {addresses.map((addr) => {
          const parsed = parseEmail(addr);
          const colorClass = getAvatarColor(addr);
          return (
            <span
              key={addr}
              className="inline-flex items-center gap-1.5 bg-bg-secondary hover:bg-bg-tertiary text-text-primary text-xs pl-1.5 pr-1 py-1 sm:py-0.5 min-h-[32px] sm:min-h-[26px] rounded-full border border-border-primary/80 hover:border-accent/40 shadow-2xs transition-all duration-150 group/chip max-w-[280px] select-none active:scale-[0.98]"
            >
              <span
                className={`w-5 h-5 sm:w-4 sm:h-4 rounded-full ${colorClass} text-[10px] sm:text-[9px] font-semibold flex items-center justify-center shrink-0 uppercase border`}
                aria-hidden="true"
              >
                {parsed.initial}
              </span>
              <span className="truncate max-w-[170px] sm:max-w-[220px] font-medium" title={addr}>
                {addr}
              </span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onChange(addresses.filter((a) => a !== addr));
                }}
                className="min-w-[28px] min-h-[28px] sm:min-w-[20px] sm:min-h-[20px] rounded-full flex items-center justify-center text-text-tertiary hover:text-danger hover:bg-danger/15 active:bg-danger/25 active:scale-90 transition-all shrink-0 cursor-pointer touch-manipulation"
                title={`Remove ${addr}`}
                aria-label={`Remove ${addr}`}
              >
                <X size={12} strokeWidth={2.5} />
              </button>
            </span>
          );
        })}
        <input
          ref={inputRef}
          type="email"
          inputMode="email"
          autoCapitalize="none"
          autoCorrect="off"
          enterKeyHint="done"
          spellCheck={false}
          value={inputValue}
          onChange={(e) => handleInputChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={() => {
            // Delay to allow click on suggestion
            if (blurTimerRef.current) clearTimeout(blurTimerRef.current);
            blurTimerRef.current = setTimeout(() => setShowSuggestions(false), 150);
            if (inputValue.trim()) addAddress(inputValue);
          }}
          placeholder={addresses.length === 0 ? placeholder : ""}
          aria-label={label}
          className="flex-1 min-w-[140px] bg-transparent text-base sm:text-sm min-h-[44px] sm:min-h-[28px] text-text-primary outline-none placeholder:text-text-tertiary/70 py-1"
        />

        {/* Autocomplete dropdown */}
        {showSuggestions && (
          <div className="absolute top-full left-0 right-0 mt-1 bg-bg-primary/95 backdrop-blur-md border border-border-primary rounded-xl shadow-xl z-50 py-1 overflow-hidden animate-in fade-in-50 zoom-in-95 duration-150 max-h-56 overflow-y-auto overscroll-contain">
            {suggestions.map((contact, i) => {
              const displayName = contact.display_name ?? contact.email;
              const initial = displayName.charAt(0).toUpperCase();
              const isSelected = i === selectedIdx;
              return (
                <button
                  key={contact.id}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => addAddress(contact.email)}
                  className={`w-full text-left px-3.5 py-3 sm:py-2 text-sm flex items-center gap-2.5 transition-colors cursor-pointer touch-manipulation active:bg-accent/15 min-h-[48px] ${
                    isSelected ? "bg-accent/10 text-accent font-medium" : "hover:bg-bg-hover text-text-primary"
                  }`}
                >
                  <div className="w-8 h-8 sm:w-7 sm:h-7 rounded-full bg-accent/15 text-accent font-semibold text-xs flex items-center justify-center shrink-0">
                    {initial}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-text-primary truncate">
                      {displayName}
                    </div>
                    {contact.display_name && (
                      <div className="text-xs text-text-tertiary truncate">
                        {contact.email}
                      </div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
      {rightAction && (
        <div className="pt-1 shrink-0">
          {rightAction}
        </div>
      )}
    </div>
  );
}
