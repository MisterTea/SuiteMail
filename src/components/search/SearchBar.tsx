import { useAndroidMobile } from "@/hooks/useAndroidMobile";
import { useState, useRef, useCallback, useEffect } from "react";
import { searchMessages } from "@/services/db/search";
import { useAccountStore } from "@/stores/accountStore";
import { useThreadStore } from "@/stores/threadStore";
import { useSmartFolderStore } from "@/stores/smartFolderStore";
import { InputDialog } from "@/components/ui/InputDialog";
import { Search, X, FolderPlus } from "lucide-react";

export function SearchBar() {
  const androidMobile = useAndroidMobile();
  const searchRequestRef = useRef(0);
  const [searchStatus, setSearchStatus] = useState("");
  const searchQuery = useThreadStore((s) => s.searchQuery);
  const activeAccountId = useAccountStore((s) => s.activeAccountId);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isFocused, setIsFocused] = useState(false);

  const [showSaveModal, setShowSaveModal] = useState(false);

  const handleSaveAsSmartFolder = useCallback(() => {
    if (useThreadStore.getState().searchQuery.trim().length < 2) return;
    setShowSaveModal(true);
  }, []);

  const executeSearch = useCallback(
    async (value: string) => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
      const request = ++searchRequestRef.current;
      const trimmed = value.trim();
      const { setSearch } = useThreadStore.getState();

      if (trimmed.length < 2) {
        setSearch(value, null);
        return;
      }

      try {
        setSearchStatus("Searching…");
        const hits = await searchMessages(trimmed, activeAccountId ?? undefined, 100);
        if (request !== searchRequestRef.current) return;
        setSearchStatus("");
        const threadIds = new Set(hits.map((h) => h.thread_id));
        useThreadStore.getState().setSearch(value, threadIds);
      } catch {
        if (request !== searchRequestRef.current) return;
        setSearchStatus("Couldn’t search. Please try again.");
        useThreadStore.getState().setSearch(value, new Set());
      }
    },
    [activeAccountId],
  );

  const handleChange = useCallback(
    (value: string) => {
      searchRequestRef.current++;
      setSearchStatus("");
      const { setSearch } = useThreadStore.getState();
      setSearch(value, useThreadStore.getState().searchThreadIds);

      if (debounceRef.current) clearTimeout(debounceRef.current);

      if (value.trim().length < 2) {
        setSearch(value, null);
        return;
      }

      debounceRef.current = setTimeout(() => {
        executeSearch(value);
      }, 200);
    },
    [executeSearch],
  );

  const handleClear = useCallback(() => {
    searchRequestRef.current++;
    setSearchStatus("");
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    useThreadStore.getState().clearSearch();
    inputRef.current?.focus();
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      executeSearch(inputRef.current?.value ?? searchQuery);
      if (androidMobile) inputRef.current?.blur();
    } else if (e.key === "Escape") {
      useThreadStore.getState().clearSearch();
      inputRef.current?.blur();
    }
  };

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  return (
    <div className="relative group">
      <div
        className={`relative flex items-center w-full min-h-[48px] sm:min-h-[38px] rounded-xl sm:rounded-lg transition-all duration-200 border ${
          isFocused
            ? "border-accent ring-2 ring-accent/25 bg-bg-primary shadow-sm"
            : "border-border-primary/80 hover:border-border-primary bg-bg-tertiary/70 hover:bg-bg-tertiary"
        }`}
      >
        <Search
          size={18}
          className={`absolute left-3.5 sm:left-3 transition-all duration-200 pointer-events-none sm:w-4 sm:h-4 ${
            isFocused ? "text-accent scale-105" : "text-text-tertiary group-hover:text-text-secondary"
          }`}
        />
        <input
          ref={inputRef}
          type="search"
          aria-label="Search mail"
          enterKeyHint="search"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          value={searchQuery}
          onChange={(e) => handleChange(e.target.value)}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          onKeyDown={handleKeyDown}
          placeholder={androidMobile ? "Search mail" : "Search... (from: to: has:attachment)"}
          className="w-full bg-transparent text-text-primary text-base sm:text-sm pl-11 sm:pl-9 pr-24 sm:pr-16 py-3 sm:py-1.5 focus:outline-none placeholder:text-text-tertiary leading-normal"
        />
        {searchQuery && (
          <div className="absolute right-1 sm:right-1.5 flex items-center gap-0.5 sm:gap-1">
            {searchQuery.trim().length >= 2 && (
              <button
                type="button"
                onClick={handleSaveAsSmartFolder}
                className="min-w-[44px] min-h-[44px] sm:min-w-[28px] sm:min-h-[28px] flex items-center justify-center text-text-tertiary hover:text-accent hover:bg-accent/10 active:scale-90 active:bg-accent/20 rounded-full sm:rounded transition-all touch-manipulation cursor-pointer"
                title="Save as Smart Folder"
                aria-label="Save as Smart Folder"
              >
                <FolderPlus size={18} className="sm:w-3.5 sm:h-3.5" />
              </button>
            )}
            <button
              type="button"
              onClick={handleClear}
              className="min-w-[44px] min-h-[44px] sm:min-w-[28px] sm:min-h-[28px] flex items-center justify-center text-text-tertiary hover:text-text-primary active:text-text-primary hover:bg-bg-hover active:bg-bg-hover/80 active:scale-90 rounded-full sm:rounded transition-all touch-manipulation cursor-pointer"
              title="Clear search (Esc)"
              aria-label="Clear search"
            >
              <X size={18} className="sm:w-3.5 sm:h-3.5" />
            </button>
          </div>
        )}
      </div>
      {androidMobile && searchStatus && <p role="status" className="px-2 py-1 text-sm text-text-secondary">{searchStatus}</p>}
      <InputDialog
        isOpen={showSaveModal}
        onClose={() => setShowSaveModal(false)}
        onSubmit={(values) => {
          useSmartFolderStore
            .getState()
            .createFolder(
              values.name!.trim(),
              useThreadStore.getState().searchQuery.trim(),
              activeAccountId ?? undefined,
            );
        }}
        title="Save as Smart Folder"
        fields={[
          { key: "name", label: "Name", defaultValue: searchQuery.trim() },
        ]}
        submitLabel="Save"
      />
    </div>
  );
}
