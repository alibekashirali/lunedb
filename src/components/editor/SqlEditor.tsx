import { useCallback, useState, useEffect, useRef, useMemo } from "react";
import type { EditorView } from "@codemirror/view";
import { createPortal } from "react-dom";
import dynamic from "next/dynamic";
import { format as formatSql } from "sql-formatter";
import { useAppStore } from "@/store/useAppStore";
import { executeQuery, type QueryResult } from "@/lib/tauri-commands";
import { splitStatements, getStatementAtCursor } from "@/lib/sql-statements";
import {
  addHistoryEntry, getQueryHistory, clearQueryHistory, type HistoryEntry,
  saveQuery, getSavedQueries, deleteSavedQuery, type SavedQuery,
} from "@/lib/wiki-db";
import { sql, PostgreSQL } from "@codemirror/lang-sql";
import { autocompletion } from "@codemirror/autocomplete";
import {
  Play, Loader2, PanelRightClose, PanelRightOpen,
  History, Trash2, X, CheckCircle2, XCircle, Zap,
  WandSparkles, Bookmark, Star,
} from "lucide-react";

const CodeMirror = dynamic(() => import("@uiw/react-codemirror"), { ssr: false });

interface Props {
  rightOpen: boolean;
  onToggleRight: () => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatRelative(unixSec: number): string {
  const diff = Math.floor(Date.now() / 1000) - unixSec;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

// ── History dropdown ──────────────────────────────────────────────────────────

function HistoryDropdown({
  anchorEl, entries, onSelect, onClear, onClose,
}: {
  anchorEl: HTMLElement;
  entries: HistoryEntry[];
  onSelect: (sql: string) => void;
  onClear: () => void;
  onClose: () => void;
}) {
  const rect = anchorEl.getBoundingClientRect();
  const width = 420;
  const right = window.innerWidth - rect.right;

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest("[data-history-panel]")) onClose();
    };
    const t = setTimeout(() => document.addEventListener("mousedown", handler), 0);
    return () => { clearTimeout(t); document.removeEventListener("mousedown", handler); };
  }, [onClose]);

  return createPortal(
    <div
      data-history-panel
      style={{ position: "fixed", top: rect.bottom + 2, right, width, zIndex: 9999 }}
      className="bg-card border border-border rounded-xl shadow-2xl shadow-black/50 overflow-hidden flex flex-col max-h-72"
    >
      <div className="flex items-center justify-between px-3 h-8 border-b border-border shrink-0">
        <span className="text-[11px] text-muted-foreground font-medium">Query History</span>
        <div className="flex items-center gap-1">
          <button onClick={onClear} className="flex items-center gap-1 px-2 py-0.5 rounded text-[11px] text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors">
            <Trash2 className="h-3 w-3" />Clear
          </button>
          <button onClick={onClose} className="p-0.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground">
            <X className="h-3 w-3" />
          </button>
        </div>
      </div>
      <div className="overflow-y-auto flex-1">
        {entries.length === 0 ? (
          <p className="text-xs text-muted-foreground/50 px-3 py-4 text-center">No history yet</p>
        ) : entries.map((e) => (
          <button key={e.id} onClick={() => { onSelect(e.sql); onClose(); }}
            className="w-full flex items-start gap-2.5 px-3 py-2 hover:bg-accent/50 text-left border-b border-border/30 last:border-0"
          >
            <div className="mt-0.5 shrink-0">
              {e.error ? <XCircle className="h-3 w-3 text-destructive/60" /> : <CheckCircle2 className="h-3 w-3 text-green-500/60" />}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[11px] font-mono text-foreground/80 truncate leading-snug">{e.sql.replace(/\s+/g, " ")}</p>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-[10px] text-muted-foreground/50">{formatRelative(e.ran_at)}</span>
                {e.exec_ms !== null && <span className="text-[10px] text-muted-foreground/40">{e.exec_ms}ms</span>}
                {e.row_count !== null && !e.error && <span className="text-[10px] text-muted-foreground/40">{e.row_count} rows</span>}
                {e.error && <span className="text-[10px] text-destructive/60 truncate max-w-[180px]">{e.error}</span>}
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>,
    document.body
  );
}

// ── Saved queries dropdown ────────────────────────────────────────────────────

function SavedDropdown({
  anchorEl, entries, onSelect, onDelete, onClose,
}: {
  anchorEl: HTMLElement;
  entries: SavedQuery[];
  onSelect: (sql: string) => void;
  onDelete: (id: number) => void;
  onClose: () => void;
}) {
  const rect = anchorEl.getBoundingClientRect();
  const width = 380;
  const right = window.innerWidth - rect.right;

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest("[data-saved-panel]")) onClose();
    };
    const t = setTimeout(() => document.addEventListener("mousedown", handler), 0);
    return () => { clearTimeout(t); document.removeEventListener("mousedown", handler); };
  }, [onClose]);

  return createPortal(
    <div
      data-saved-panel
      style={{ position: "fixed", top: rect.bottom + 2, right, width, zIndex: 9999 }}
      className="bg-card border border-border rounded-xl shadow-2xl shadow-black/50 overflow-hidden flex flex-col max-h-64"
    >
      <div className="flex items-center justify-between px-3 h-8 border-b border-border shrink-0">
        <span className="text-[11px] text-muted-foreground font-medium">Saved Queries</span>
        <button onClick={onClose} className="p-0.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground">
          <X className="h-3 w-3" />
        </button>
      </div>
      <div className="overflow-y-auto flex-1">
        {entries.length === 0 ? (
          <p className="text-xs text-muted-foreground/50 px-3 py-4 text-center">No saved queries yet · click ★ to save</p>
        ) : entries.map((q) => (
          <div key={q.id} className="flex items-center gap-2 px-3 py-2 hover:bg-accent/50 group border-b border-border/30 last:border-0">
            <button onClick={() => { onSelect(q.sql); onClose(); }} className="flex-1 min-w-0 text-left">
              <p className="text-[11px] font-medium text-foreground truncate">{q.name}</p>
              <p className="text-[10px] font-mono text-muted-foreground/50 truncate">{q.sql.replace(/\s+/g, " ")}</p>
            </button>
            <button
              onClick={() => onDelete(q.id)}
              className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-destructive/20 text-muted-foreground hover:text-destructive transition-opacity shrink-0"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
        ))}
      </div>
    </div>,
    document.body
  );
}

// ── Save dialog ───────────────────────────────────────────────────────────────

function SaveDialog({
  anchorEl, defaultName, onSave, onClose,
}: {
  anchorEl: HTMLElement;
  defaultName: string;
  onSave: (name: string) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(defaultName);
  const rect = anchorEl.getBoundingClientRect();
  const right = window.innerWidth - rect.right;
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.select(); }, []);
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest("[data-save-dialog]")) onClose();
    };
    const t = setTimeout(() => document.addEventListener("mousedown", handler), 0);
    return () => { clearTimeout(t); document.removeEventListener("mousedown", handler); };
  }, [onClose]);

  return createPortal(
    <div
      data-save-dialog
      style={{ position: "fixed", top: rect.bottom + 2, right, width: 260, zIndex: 9999 }}
      className="bg-card border border-border rounded-xl shadow-2xl shadow-black/50 p-3"
    >
      <p className="text-[11px] text-muted-foreground font-medium mb-2">Save query as</p>
      <input
        ref={inputRef}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && name.trim()) { onSave(name.trim()); onClose(); }
          if (e.key === "Escape") onClose();
        }}
        placeholder="Query name…"
        className="w-full bg-muted/40 border border-border rounded-lg px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/40 outline-none focus:border-primary/50 transition-colors mb-2"
      />
      <div className="flex gap-1.5 justify-end">
        <button onClick={onClose} className="px-2.5 py-1 text-xs rounded border border-border hover:bg-accent text-muted-foreground transition-colors">Cancel</button>
        <button
          onClick={() => { if (name.trim()) { onSave(name.trim()); onClose(); } }}
          disabled={!name.trim()}
          className="px-2.5 py-1 text-xs rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40 transition-colors"
        >
          Save
        </button>
      </div>
    </div>,
    document.body
  );
}

const PAGE_SIZE = 500;

// ── SqlEditor ─────────────────────────────────────────────────────────────────

export function SqlEditor({ rightOpen, onToggleRight }: Props) {
  const {
    sqlText, setSqlText,
    setQueryResult, setQueryRunning, isQueryRunning,
    connectionStatus, schema, activeTabId, tabs,
    setExplainPlan,
    setLastRunSql, setQueryPage,
  } = useAppStore();

  const sqlExtension = useMemo(() => {
    const schemaMap: Record<string, string[]> = {};
    for (const t of schema) {
      const cols = t.columns.map((c) => c.name);
      schemaMap[t.name] = cols;
      schemaMap[`${t.schema}.${t.name}`] = cols;
    }
    return sql({ dialect: PostgreSQL, schema: schemaMap, upperCaseKeywords: false });
  }, [schema]);

  // Tighten CodeMirror's fuzzy matching so completions are limited to ones
  // that actually contain what was typed, instead of any loosely-matching
  // SQL keyword/type/builtin from the whole PostgreSQL dialect.
  const completionExtension = useMemo(
    () => autocompletion({ filterStrict: true, maxRenderedOptions: 20 }),
    []
  );

  const [showHistory, setShowHistory] = useState(false);
  const [historyEntries, setHistoryEntries] = useState<HistoryEntry[]>([]);
  const [showSaved, setShowSaved] = useState(false);
  const [savedEntries, setSavedEntries] = useState<SavedQuery[]>([]);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [formatFlash, setFormatFlash] = useState(false);

  const historyBtnRef = useRef<HTMLButtonElement>(null);
  const savedBtnRef = useRef<HTMLButtonElement>(null);
  const saveBtnRef = useRef<HTMLButtonElement>(null);
  const editorRef = useRef<EditorView | null>(null);
  const isConnected = connectionStatus === "connected";

  // Current tab name as default save name
  const activeTabName = tabs.find((t) => t.id === activeTabId)?.name ?? "Query";

  const loadHistory = useCallback(async () => setHistoryEntries(await getQueryHistory()), []);
  const loadSaved = useCallback(async () => setSavedEntries(await getSavedQueries()), []);

  const handleToggleHistory = useCallback(async () => {
    setShowSaved(false);
    if (!showHistory) await loadHistory();
    setShowHistory((v) => !v);
  }, [showHistory, loadHistory]);

  const handleToggleSaved = useCallback(async () => {
    setShowHistory(false);
    if (!showSaved) await loadSaved();
    setShowSaved((v) => !v);
  }, [showSaved, loadSaved]);

  const handleFormat = useCallback(() => {
    if (!sqlText.trim()) return;
    try {
      setSqlText(formatSql(sqlText, { language: "postgresql", tabWidth: 2, keywordCase: "upper" }));
      setFormatFlash(true);
      setTimeout(() => setFormatFlash(false), 600);
    } catch { /* ignore parse errors */ }
  }, [sqlText, setSqlText]);

  const handleSaveQuery = useCallback(async (name: string) => {
    await saveQuery(name, sqlText.trim());
    setSavedEntries(await getSavedQueries());
  }, [sqlText]);

  const handleDeleteSaved = useCallback(async (id: number) => {
    await deleteSavedQuery(id);
    setSavedEntries(await getSavedQueries());
  }, []);

  const runQuery = useCallback(async (explainOnly = false) => {
    if (!sqlText.trim() || isQueryRunning || !isConnected) return;
    setQueryRunning(true);

    // Resolve effective SQL: selection → statement at cursor → full text
    const view = editorRef.current;
    let effectiveSql = sqlText;
    if (view) {
      const sel = view.state.selection.main;
      if (sel.from !== sel.to) {
        effectiveSql = view.state.sliceDoc(sel.from, sel.to).trim();
      } else {
        effectiveSql = getStatementAtCursor(sqlText, sel.from);
      }
    }
    if (!effectiveSql.trim()) { setQueryRunning(false); return; }

    // Determine if this SELECT-like query can be paginated
    const isSelect = /^\s*(SELECT|WITH|TABLE)\b/i.test(effectiveSql);
    const hasLimit = /\bLIMIT\b/i.test(effectiveSql);
    const canPaginate = isSelect && !hasLimit && splitStatements(effectiveSql).length === 1;

    if (!explainOnly) {
      setLastRunSql(canPaginate ? effectiveSql : null);
      setQueryPage(0);
    }

    if (explainOnly) {
      const querySql = `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)\n${effectiveSql.trim()}`;
      try {
        const result = await executeQuery(querySql);
        if (result.error) {
          setQueryResult(result);
          setExplainPlan(null);
          await addHistoryEntry(querySql, null, result.execution_time_ms, result.error);
        } else {
          const raw = result.rows[0]?.[0];
          // Tauri may deserialize the JSON column into a JS object already
          const parsed: Array<{ Plan: object; "Planning Time"?: number; "Execution Time"?: number }> =
            typeof raw === "string" ? JSON.parse(raw) : raw as typeof parsed;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          setExplainPlan(parsed[0] as any);
          setQueryResult(null);
          await addHistoryEntry(querySql, null, result.execution_time_ms, null);
        }
      } catch (err) {
        const msg = String(err);
        setQueryResult({ columns: [], rows: [], row_count: 0, execution_time_ms: 0, truncated: false, error: msg });
        setExplainPlan(null);
        await addHistoryEntry(querySql, null, null, msg);
      } finally {
        setQueryRunning(false);
      }
      return;
    }

    // Normal query — split on ; and run each statement
    setExplainPlan(null);
    const statements = splitStatements(effectiveSql);
    try {
      if (statements.length <= 1) {
        const sql = canPaginate ? `${effectiveSql} LIMIT ${PAGE_SIZE} OFFSET 0` : effectiveSql;
        const result = await executeQuery(sql);
        setQueryResult(result);
        await addHistoryEntry(effectiveSql, result.error ? null : result.row_count, result.execution_time_ms, result.error ?? null);
      } else {
        const results: QueryResult[] = [];
        for (const stmt of statements) {
          try {
            results.push(await executeQuery(stmt));
          } catch (err) {
            results.push({ columns: [], rows: [], row_count: 0, execution_time_ms: 0, truncated: false, error: String(err) });
          }
        }
        setQueryResult(results[results.length - 1]);
        for (const [i, result] of results.entries()) {
          await addHistoryEntry(statements[i], result.error ? null : result.row_count, result.execution_time_ms, result.error ?? null);
        }
      }
    } catch (err) {
      const msg = String(err);
      setQueryResult({ columns: [], rows: [], row_count: 0, execution_time_ms: 0, truncated: false, error: msg });
      await addHistoryEntry(effectiveSql, null, null, msg);
    } finally {
      setQueryRunning(false);
    }
  }, [sqlText, isQueryRunning, isConnected, setQueryRunning, setQueryResult, setExplainPlan, setLastRunSql, setQueryPage]);

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 h-9 border-b border-border shrink-0" data-tauri-drag-region>
        <span className="text-xs text-muted-foreground font-medium" data-tauri-drag-region>SQL Editor</span>

        <div className="flex items-center gap-1">
          {/* Format */}
          <button
            onClick={handleFormat}
            disabled={!sqlText.trim()}
            className={`p-1.5 rounded transition-colors disabled:opacity-30 ${formatFlash ? "text-green-400 bg-green-400/10" : "text-muted-foreground hover:text-foreground hover:bg-accent"}`}
            title="Format SQL (⌘⇧F)"
          >
            <WandSparkles className="h-3.5 w-3.5" />
          </button>

          {/* Saved queries */}
          <button
            ref={savedBtnRef}
            onClick={handleToggleSaved}
            className={`p-1.5 rounded transition-colors ${showSaved ? "text-primary bg-primary/10" : "text-muted-foreground hover:text-foreground hover:bg-accent"}`}
            title="Saved queries"
          >
            <Star className="h-3.5 w-3.5" />
          </button>

          {/* Save current */}
          <button
            ref={saveBtnRef}
            onClick={() => { setShowHistory(false); setShowSaved(false); setShowSaveDialog((v) => !v); }}
            disabled={!sqlText.trim()}
            className={`p-1.5 rounded transition-colors disabled:opacity-30 ${showSaveDialog ? "text-primary bg-primary/10" : "text-muted-foreground hover:text-foreground hover:bg-accent"}`}
            title="Save query (⌘S)"
          >
            <Bookmark className="h-3.5 w-3.5" />
          </button>

          {/* History */}
          <button
            ref={historyBtnRef}
            onClick={handleToggleHistory}
            className={`p-1.5 rounded transition-colors ${showHistory ? "text-primary bg-primary/10" : "text-muted-foreground hover:text-foreground hover:bg-accent"}`}
            title="Query history"
          >
            <History className="h-3.5 w-3.5" />
          </button>

          <div className="w-px h-4 bg-border mx-0.5" />

          {/* Explain */}
          <button
            onClick={() => runQuery(true)}
            disabled={isQueryRunning || !isConnected || !sqlText.trim()}
            className="flex items-center gap-1 px-2 py-1 text-xs font-medium rounded border border-border hover:bg-accent text-muted-foreground hover:text-foreground disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            title="EXPLAIN ANALYZE (⌘⇧↵)"
          >
            <Zap className="h-3 w-3" />
            Explain
          </button>

          {/* Run */}
          <button
            onClick={() => runQuery(false)}
            disabled={isQueryRunning || !isConnected || !sqlText.trim()}
            className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            title="Run query (⌘↵)"
          >
            {isQueryRunning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
            Run
            <kbd className="opacity-50 text-[10px] hidden sm:inline">⌘↵</kbd>
          </button>

          <button
            onClick={onToggleRight}
            className="p-1.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
            title={rightOpen ? "Close AI panel" : "Open AI panel"}
          >
            {rightOpen ? <PanelRightClose className="h-3.5 w-3.5" /> : <PanelRightOpen className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>

      {/* Editor */}
      <div className="flex-1 overflow-auto">
        <CodeMirror
          value={sqlText}
          onChange={setSqlText}
          onCreateEditor={(view) => { editorRef.current = view; }}
          height="100%"
          theme="dark"
          extensions={[sqlExtension, completionExtension]}
          basicSetup={{ lineNumbers: true, highlightActiveLine: true, foldGutter: false, autocompletion: false }}
          style={{ fontSize: "13px", height: "100%" }}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && !e.shiftKey) {
              e.preventDefault(); runQuery(false);
            }
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && e.shiftKey) {
              e.preventDefault(); runQuery(true);
            }
            if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === "f") {
              e.preventDefault(); handleFormat();
            }
            if ((e.metaKey || e.ctrlKey) && e.key === "s") {
              e.preventDefault();
              setShowSaveDialog((v) => !v);
            }
          }}
        />
      </div>

      {/* Portals */}
      {showHistory && historyBtnRef.current && (
        <HistoryDropdown
          anchorEl={historyBtnRef.current}
          entries={historyEntries}
          onSelect={setSqlText}
          onClear={async () => { await clearQueryHistory(); setHistoryEntries([]); }}
          onClose={() => setShowHistory(false)}
        />
      )}
      {showSaved && savedBtnRef.current && (
        <SavedDropdown
          anchorEl={savedBtnRef.current}
          entries={savedEntries}
          onSelect={setSqlText}
          onDelete={handleDeleteSaved}
          onClose={() => setShowSaved(false)}
        />
      )}
      {showSaveDialog && saveBtnRef.current && (
        <SaveDialog
          anchorEl={saveBtnRef.current}
          defaultName={activeTabName}
          onSave={handleSaveQuery}
          onClose={() => setShowSaveDialog(false)}
        />
      )}
    </div>
  );
}
