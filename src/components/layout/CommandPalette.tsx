import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { createPortal } from "react-dom";
import { useAppStore } from "@/store/useAppStore";
import {
  Search, Table2, Eye, Layers, FunctionSquare, Hash,
  Plus, Terminal, BookOpen, GitFork, Sun, Moon, Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { getDocsPage } from "@/lib/wiki-db";

// ── Types ─────────────────────────────────────────────────────────────────────

interface PaletteItem {
  id: string;
  label: string;
  sublabel?: string;
  icon: React.ReactNode;
  group: string;
  action: () => void;
}

// ── Fuzzy match ───────────────────────────────────────────────────────────────

function fuzzyMatch(query: string, text: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  let qi = 0;
  for (let i = 0; i < t.length && qi < q.length; i++) {
    if (t[i] === q[qi]) qi++;
  }
  return qi === q.length;
}

function highlight(query: string, text: string): React.ReactNode {
  if (!query) return text;
  const q = query.toLowerCase();
  const result: React.ReactNode[] = [];
  let qi = 0, start = 0;
  for (let i = 0; i < text.length; i++) {
    if (qi < q.length && text[i].toLowerCase() === q[qi]) {
      if (i > start) result.push(text.slice(start, i));
      result.push(<mark key={i} className="bg-primary/30 text-primary rounded-sm">{text[i]}</mark>);
      start = i + 1;
      qi++;
    }
  }
  if (start < text.length) result.push(text.slice(start));
  return result;
}

// ── Main component ────────────────────────────────────────────────────────────

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const {
    schema, views, matViews, functions, sequences,
    selectTable, setSqlText, nameActiveTab, setDocsContent,
    setAppMode, createTab, toggleTheme, theme,
  } = useAppStore();

  // ── Build item list ──────────────────────────────────────────────────────

  const items = useMemo<PaletteItem[]>(() => {
    const list: PaletteItem[] = [];

    // Actions
    list.push({
      id: "action:new-tab",
      label: "New Query Tab",
      icon: <Plus className="h-3.5 w-3.5" />,
      group: "Actions",
      action: () => createTab(),
    });
    list.push({
      id: "action:mode-query",
      label: "Switch to Query mode",
      icon: <Terminal className="h-3.5 w-3.5" />,
      group: "Actions",
      action: () => setAppMode("query"),
    });
    list.push({
      id: "action:mode-docs",
      label: "Switch to Docs mode",
      icon: <BookOpen className="h-3.5 w-3.5" />,
      group: "Actions",
      action: () => setAppMode("docs"),
    });
    list.push({
      id: "action:mode-er",
      label: "Switch to ER Diagram",
      icon: <GitFork className="h-3.5 w-3.5" />,
      group: "Actions",
      action: () => setAppMode("er"),
    });
    list.push({
      id: "action:theme",
      label: theme === "dark" ? "Switch to Light Theme" : "Switch to Dark Theme",
      icon: theme === "dark" ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />,
      group: "Actions",
      action: () => toggleTheme(),
    });
    list.push({
      id: "action:explain",
      label: "EXPLAIN ANALYZE current query",
      sublabel: "⌘⇧↵",
      icon: <Zap className="h-3.5 w-3.5" />,
      group: "Actions",
      action: () => {
        // Dispatch keyboard event to trigger explain
        const e = new KeyboardEvent("keydown", { key: "Enter", metaKey: true, shiftKey: true, bubbles: true });
        document.dispatchEvent(e);
      },
    });

    // Tables
    for (const t of schema) {
      list.push({
        id: `table:${t.schema}.${t.name}`,
        label: t.name,
        sublabel: t.schema,
        icon: <Table2 className="h-3.5 w-3.5 text-primary/70" />,
        group: "Tables",
        action: async () => {
          selectTable(t);
          setSqlText(`SELECT *\nFROM ${t.schema}.${t.name}\nLIMIT 100;`);
          nameActiveTab(t.name);
          const saved = await getDocsPage(`${t.schema}.${t.name}`);
          setDocsContent(saved ?? "");
        },
      });
    }

    // Views
    for (const v of views) {
      list.push({
        id: `view:${v.schema}.${v.name}`,
        label: v.name,
        sublabel: v.schema,
        icon: <Eye className="h-3.5 w-3.5 text-sky-400/70" />,
        group: "Views",
        action: () => setSqlText(`SELECT *\nFROM ${v.schema}.${v.name}\nLIMIT 100;`),
      });
    }

    // Materialized views
    for (const m of matViews) {
      list.push({
        id: `matview:${m.schema}.${m.name}`,
        label: m.name,
        sublabel: m.schema,
        icon: <Layers className="h-3.5 w-3.5 text-teal-400/70" />,
        group: "Mat. Views",
        action: () => setSqlText(`SELECT *\nFROM ${m.schema}.${m.name}\nLIMIT 100;`),
      });
    }

    // Sequences
    for (const s of sequences) {
      list.push({
        id: `seq:${s.schema}.${s.name}`,
        label: s.name,
        sublabel: s.schema,
        icon: <Hash className="h-3.5 w-3.5 text-amber-400/70" />,
        group: "Sequences",
        action: () => setSqlText(`SELECT last_value, increment_by FROM ${s.schema}.${s.name};`),
      });
    }

    // Functions
    for (const f of functions) {
      list.push({
        id: `fn:${f.schema}.${f.name}.${f.kind}`,
        label: f.name,
        sublabel: `${f.schema} · ${f.kind}`,
        icon: <FunctionSquare className="h-3.5 w-3.5 text-violet-400/70" />,
        group: "Functions",
        action: () => setSqlText(`SELECT ${f.schema}.${f.name}();`),
      });
    }

    return list;
  }, [schema, views, matViews, functions, sequences, theme,
      selectTable, setSqlText, nameActiveTab, setDocsContent,
      setAppMode, createTab, toggleTheme]);

  // ── Filtered + grouped ───────────────────────────────────────────────────

  const filtered = useMemo(() => {
    return items.filter((item) =>
      fuzzyMatch(query, item.label) ||
      (item.sublabel && fuzzyMatch(query, item.sublabel))
    );
  }, [items, query]);

  const groups = useMemo(() => {
    const map = new Map<string, PaletteItem[]>();
    for (const item of filtered) {
      if (!map.has(item.group)) map.set(item.group, []);
      map.get(item.group)!.push(item);
    }
    return map;
  }, [filtered]);

  // ── Keyboard navigation ──────────────────────────────────────────────────

  const close = useCallback(() => { setOpen(false); setQuery(""); setActiveIdx(0); }, []);

  const runItem = useCallback((item: PaletteItem) => {
    item.action();
    close();
  }, [close]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen((v) => !v);
        return;
      }
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [close]);

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 30);
      setActiveIdx(0);
    }
  }, [open]);

  useEffect(() => { setActiveIdx(0); }, [query]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (filtered[activeIdx]) runItem(filtered[activeIdx]);
    }
  };

  // Scroll active item into view
  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-palette-idx="${activeIdx}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [activeIdx]);

  if (!open) return null;

  let flatIdx = 0;

  return createPortal(
    <div
      className="fixed inset-0 z-[999] flex items-start justify-center pt-[15vh] bg-black/50 backdrop-blur-sm"
      onClick={close}
    >
      <div
        className="w-full max-w-[560px] mx-4 bg-card border border-border rounded-2xl shadow-2xl shadow-black/60 overflow-hidden flex flex-col max-h-[60vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search input */}
        <div className="flex items-center gap-2.5 px-4 py-3 border-b border-border shrink-0">
          <Search className="h-4 w-4 text-muted-foreground/50 shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search tables, views, actions…"
            className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground/40 outline-none"
          />
          <kbd className="text-[10px] text-muted-foreground/40 border border-border rounded px-1.5 py-0.5 shrink-0">
            ESC
          </kbd>
        </div>

        {/* Results */}
        <div ref={listRef} className="flex-1 overflow-y-auto py-1.5">
          {filtered.length === 0 ? (
            <p className="text-xs text-muted-foreground/40 text-center py-8">No results</p>
          ) : (
            Array.from(groups.entries()).map(([group, groupItems]) => (
              <div key={group}>
                <p className="px-4 py-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/40">
                  {group}
                </p>
                {groupItems.map((item) => {
                  const idx = flatIdx++;
                  const isActive = activeIdx === idx;
                  return (
                    <button
                      key={item.id}
                      data-palette-idx={idx}
                      onClick={() => runItem(item)}
                      onMouseEnter={() => setActiveIdx(idx)}
                      className={cn(
                        "w-full flex items-center gap-3 px-4 py-2 text-left transition-colors",
                        isActive ? "bg-primary/10 text-foreground" : "text-foreground/80 hover:bg-accent/50"
                      )}
                    >
                      <span className={cn("shrink-0", isActive ? "text-primary" : "text-muted-foreground")}>
                        {item.icon}
                      </span>
                      <span className="flex-1 min-w-0">
                        <span className="text-sm">{highlight(query, item.label)}</span>
                        {item.sublabel && (
                          <span className="ml-2 text-[11px] text-muted-foreground/50">{item.sublabel}</span>
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-3 px-4 py-2 border-t border-border shrink-0 text-[10px] text-muted-foreground/40">
          <span>↑↓ navigate</span>
          <span>↵ select</span>
          <span>esc close</span>
          <span className="ml-auto">⌘K</span>
        </div>
      </div>
    </div>,
    document.body
  );
}
