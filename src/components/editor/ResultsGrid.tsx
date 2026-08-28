import { useAppStore } from "@/store/useAppStore";
import { executeQuery } from "@/lib/tauri-commands";
import {
  AlertCircle, Table2, Copy, Check, ChevronUp, ChevronDown,
  ChevronsUpDown, Download, X, Pencil, CheckCheck,
} from "lucide-react";
import { useState, useEffect, useCallback, useMemo, useRef } from "react";

// ── Helpers ───────────────────────────────────────────────────────────────

type CellValue = string | number | boolean | null;

function tryFormatJson(value: string): { formatted: string; isJson: boolean } {
  if (!value.startsWith("{") && !value.startsWith("[")) return { formatted: value, isJson: false };
  try {
    return { formatted: JSON.stringify(JSON.parse(value), null, 2), isJson: true };
  } catch {
    return { formatted: value, isJson: false };
  }
}

function sqlLiteral(val: unknown): string {
  if (val === null) return "NULL";
  if (typeof val === "boolean") return val ? "TRUE" : "FALSE";
  if (typeof val === "number") return String(val);
  const s = String(val);
  // Use E'' escape syntax when the value contains backslashes so PostgreSQL
  // interprets them literally rather than as escape sequences.
  if (s.includes("\\")) {
    return `E'${s.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
  }
  return `'${s.replace(/'/g, "''")}'`;
}

// ── Expanded row detail ───────────────────────────────────────────────────

function ExpandedRowPanel({
  columns, row, onClose,
}: {
  columns: string[];
  row: unknown[];
  onClose: () => void;
}) {
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);

  const copyCell = (idx: number, val: unknown) => {
    if (val === null) return;
    navigator.clipboard.writeText(String(val));
    setCopiedIdx(idx);
    setTimeout(() => setCopiedIdx(null), 1200);
  };

  return (
    <div className="bg-muted/15 border-b border-border px-4 py-3">
      <div className="flex items-center justify-between mb-2.5">
        <span className="text-[11px] font-medium text-muted-foreground/60">Row detail</span>
        <button onClick={onClose} className="p-0.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground">
          <X className="h-3 w-3" />
        </button>
      </div>
      <div className="space-y-1.5">
        {columns.map((col, j) => {
          const raw = row[j] === null ? null : String(row[j]);
          const { formatted, isJson } = raw !== null ? tryFormatJson(raw) : { formatted: "", isJson: false };
          return (
            <div key={col} className="flex gap-3 group/cell">
              <span className="text-[11px] font-mono text-muted-foreground/60 w-36 shrink-0 pt-0.5 truncate" title={col}>
                {col}
              </span>
              <div className="flex-1 min-w-0">
                {raw === null ? (
                  <span className="text-[11px] italic text-muted-foreground/30">NULL</span>
                ) : (
                  <pre className={`text-xs font-mono whitespace-pre-wrap break-all leading-relaxed ${isJson ? "text-foreground/80" : "text-foreground"}`}>
                    {formatted}
                  </pre>
                )}
              </div>
              {raw !== null && (
                <button
                  onClick={() => copyCell(j, row[j])}
                  className="shrink-0 opacity-0 group-hover/cell:opacity-100 p-0.5 rounded transition-opacity text-muted-foreground hover:text-foreground"
                >
                  {copiedIdx === j ? <Check className="h-3 w-3 text-green-400" /> : <Copy className="h-3 w-3" />}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Editable cell ─────────────────────────────────────────────────────────

function EditableCell({
  value,
  colName,
  onSave,
  onCancel,
}: {
  value: CellValue;
  colName: string;
  onSave: (newVal: string | null) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(value === null ? "" : String(value));
  const [isNull, setIsNull] = useState(value === null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); inputRef.current?.select(); }, []);

  const commit = () => onSave(isNull ? null : draft);

  return (
    <td className="px-1 py-0.5 min-w-[120px] bg-primary/5 border border-primary/40 text-xs">
      <div className="flex items-center gap-1">
        <input
          ref={inputRef}
          value={isNull ? "NULL" : draft}
          disabled={isNull}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); commit(); }
            if (e.key === "Escape") { e.preventDefault(); onCancel(); }
          }}
          className="flex-1 bg-transparent font-mono text-foreground outline-none disabled:text-muted-foreground/50 disabled:italic min-w-0"
          title={colName}
        />
        <button
          onClick={() => setIsNull((v) => !v)}
          className="text-[9px] px-1 py-0.5 rounded border border-border text-muted-foreground hover:text-foreground shrink-0"
          title="Toggle NULL"
        >
          {isNull ? "val" : "null"}
        </button>
        <button onClick={commit} className="text-green-400 hover:text-green-300 shrink-0">
          <Check className="h-3 w-3" />
        </button>
        <button onClick={onCancel} className="text-muted-foreground hover:text-foreground shrink-0">
          <X className="h-3 w-3" />
        </button>
      </div>
    </td>
  );
}

// ── Cell ──────────────────────────────────────────────────────────────────

function Cell({
  value, isExpanded, editMode, colName,
  onToggleExpand, onEdit,
}: {
  value: CellValue;
  isExpanded: boolean;
  editMode: boolean;
  colName: string;
  onToggleExpand: () => void;
  onEdit: () => void;
}) {
  const raw = value === null ? null : String(value);

  return (
    <td
      onClick={onToggleExpand}
      onDoubleClick={(e) => { if (editMode) { e.stopPropagation(); onEdit(); } }}
      className={`px-3 py-1.5 font-mono whitespace-nowrap max-w-[220px] overflow-hidden text-ellipsis text-xs cursor-pointer transition-colors
        hover:bg-primary/10 ${isExpanded ? "bg-primary/5" : ""}
        ${editMode ? "hover:ring-1 hover:ring-primary/30" : ""}`}
      title={editMode ? `Double-click to edit ${colName}` : undefined}
    >
      {value === null ? (
        <span className="text-muted-foreground/30 italic text-[11px]">NULL</span>
      ) : typeof value === "boolean" ? (
        <span className={value ? "text-green-400" : "text-red-400"}>{value.toString()}</span>
      ) : (
        <span className="text-foreground">{raw}</span>
      )}
    </td>
  );
}

// ── Row number cell ───────────────────────────────────────────────────────

function RowNumCell({ rowIndex, row, columns }: { rowIndex: number; row: unknown[]; columns: string[] }) {
  const [copied, setCopied] = useState(false);

  const copyRow = (e: React.MouseEvent) => {
    e.stopPropagation();
    const obj: Record<string, unknown> = {};
    columns.forEach((col, j) => { obj[col] = row[j]; });
    navigator.clipboard.writeText(JSON.stringify(obj, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  return (
    <td className="px-2 py-1.5 text-[11px] font-mono text-right select-none w-10 relative">
      <span className="text-muted-foreground/30 group-hover/row:invisible">{rowIndex + 1}</span>
      <button
        onClick={copyRow}
        className="absolute inset-0 flex items-center justify-center opacity-0 group-hover/row:opacity-100 transition-opacity"
        title="Copy row as JSON"
      >
        {copied ? <Check className="h-3 w-3 text-green-400" /> : <Copy className="h-3 w-3 text-muted-foreground" />}
      </button>
    </td>
  );
}

// ── Data row ──────────────────────────────────────────────────────────────

function DataRow({
  row, rowIndex, columns,
  editMode, pkColumns,
  onUpdateSuccess,
}: {
  row: unknown[];
  rowIndex: number;
  columns: string[];
  editMode: boolean;
  pkColumns: string[];
  onUpdateSuccess: (rowIdx: number, colIdx: number, newVal: unknown) => void;
}) {
  const { selectedTable } = useAppStore();
  const [expanded, setExpanded] = useState(false);
  const [editingCol, setEditingCol] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const handleSave = useCallback(async (colIdx: number, newVal: string | null) => {
    if (!selectedTable) return;
    setEditingCol(null);
    setSaving(true);

    const schema = selectedTable.schema;
    const table = selectedTable.name;
    const col = columns[colIdx];

    // Build WHERE from PK columns
    const pkWhere = pkColumns
      .map((pk) => {
        const pkIdx = columns.indexOf(pk);
        return `"${pk}" = ${sqlLiteral(pkIdx >= 0 ? row[pkIdx] : null)}`;
      })
      .join(" AND ");

    const newLiteral = newVal === null ? "NULL" : `'${newVal.replace(/'/g, "''")}'`;
    const sql = `UPDATE "${schema}"."${table}" SET "${col}" = ${newLiteral} WHERE ${pkWhere}`;

    try {
      const result = await executeQuery(sql);
      if (result.error) {
        setSaveMsg({ ok: false, text: result.error });
      } else {
        onUpdateSuccess(rowIndex, colIdx, newVal);
        setSaveMsg({ ok: true, text: "Saved" });
      }
    } catch (err) {
      setSaveMsg({ ok: false, text: String(err) });
    } finally {
      setSaving(false);
      setTimeout(() => setSaveMsg(null), 2500);
    }
  }, [selectedTable, columns, pkColumns, row, rowIndex, onUpdateSuccess]);

  return (
    <>
      <tr className={`border-b border-border/50 hover:bg-accent/20 transition-colors group/row ${expanded ? "bg-accent/10" : ""}`}>
        <RowNumCell rowIndex={rowIndex} row={row} columns={columns} />
        {row.map((cell, j) => {
          if (editingCol === j) {
            return (
              <EditableCell
                key={j}
                value={cell as CellValue}
                colName={columns[j]}
                onSave={(v) => handleSave(j, v)}
                onCancel={() => setEditingCol(null)}
              />
            );
          }
          return (
            <Cell
              key={j}
              value={cell as CellValue}
              isExpanded={expanded}
              editMode={editMode && pkColumns.length > 0}
              colName={columns[j]}
              onToggleExpand={() => setExpanded((v) => !v)}
              onEdit={() => setEditingCol(j)}
            />
          );
        })}
        {(saving || saveMsg) && (
          <td className="px-2 text-[11px]">
            {saving
              ? <span className="text-muted-foreground/50">saving…</span>
              : saveMsg?.ok
              ? <span className="text-green-400 flex items-center gap-1"><CheckCheck className="h-3 w-3" />{saveMsg.text}</span>
              : <span className="text-destructive truncate max-w-[200px]" title={saveMsg?.text}>{saveMsg?.text}</span>}
          </td>
        )}
      </tr>
      {expanded && editingCol === null && (
        <tr>
          <td colSpan={columns.length + 1} className="p-0">
            <ExpandedRowPanel columns={columns} row={row} onClose={() => setExpanded(false)} />
          </td>
        </tr>
      )}
    </>
  );
}

// ── Sort helpers ──────────────────────────────────────────────────────────

type SortDir = "asc" | "desc";

function compareValues(a: unknown, b: unknown): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), undefined, { numeric: true });
}

function SortIcon({ col, sortCol, sortDir }: { col: number; sortCol: number | null; sortDir: SortDir }) {
  if (sortCol !== col) return <ChevronsUpDown className="h-3 w-3 opacity-0 group-hover:opacity-40 transition-opacity" />;
  return sortDir === "asc" ? <ChevronUp className="h-3 w-3 text-primary" /> : <ChevronDown className="h-3 w-3 text-primary" />;
}

// ── Export ────────────────────────────────────────────────────────────────

function exportCsv(columns: string[], rows: unknown[][]) {
  const escape = (v: unknown) => {
    if (v === null) return "";
    const s = String(v);
    return s.includes(",") || s.includes('"') || s.includes("\n")
      ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const blob = new Blob([[columns.join(","), ...rows.map((r) => r.map(escape).join(","))].join("\n")], { type: "text/csv" });
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: "results.csv" });
  a.click(); URL.revokeObjectURL(a.href);
}

function exportJson(columns: string[], rows: unknown[][]) {
  const data = rows.map((r) => Object.fromEntries(columns.map((c, j) => [c, r[j]])));
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: "results.json" });
  a.click(); URL.revokeObjectURL(a.href);
}

// ── Main component ────────────────────────────────────────────────────────

const PAGE_SIZE = 500;

export function ResultsGrid() {
  const {
    queryResult, isQueryRunning, connectionStatus, selectedTable,
    lastRunSql, queryPage, setQueryResult, setQueryPage,
  } = useAppStore();
  const [sortCol, setSortCol] = useState<number | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [editMode, setEditMode] = useState(false);
  const [rows, setRows] = useState<unknown[][]>([]);
  const [pageLoading, setPageLoading] = useState(false);

  useEffect(() => {
    setSortCol(null);
    setSortDir("asc");
    setEditMode(false);
    setRows(queryResult?.rows ?? []);
  }, [queryResult]);

  const navigatePage = useCallback(async (newPage: number) => {
    if (!lastRunSql || pageLoading) return;
    setPageLoading(true);
    try {
      const sql = `${lastRunSql} LIMIT ${PAGE_SIZE} OFFSET ${newPage * PAGE_SIZE}`;
      const result = await executeQuery(sql);
      setQueryResult(result);
      setQueryPage(newPage);
    } catch (err) {
      setQueryResult({ columns: [], rows: [], row_count: 0, execution_time_ms: 0, truncated: false, error: String(err) });
    } finally {
      setPageLoading(false);
    }
  }, [lastRunSql, pageLoading, setQueryResult, setQueryPage]);

  const sortedRows = useMemo(() => {
    if (sortCol === null) return rows;
    return [...rows].sort((a, b) => {
      const cmp = compareValues(a[sortCol], b[sortCol]);
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [rows, sortCol, sortDir]);

  const handleSort = useCallback((colIdx: number) => {
    if (sortCol === colIdx) setSortDir((d) => d === "asc" ? "desc" : "asc");
    else { setSortCol(colIdx); setSortDir("asc"); }
  }, [sortCol]);

  const handleUpdateSuccess = useCallback((rowIdx: number, colIdx: number, newVal: unknown) => {
    setRows((prev) => prev.map((r, i) => {
      if (i !== rowIdx) return r;
      const next = [...r];
      next[colIdx] = newVal;
      return next;
    }));
  }, []);

  // Which PK columns are present in the current result set
  const pkColumns = useMemo(() => {
    if (!selectedTable || !queryResult) return [];
    return selectedTable.columns
      .filter((c) => c.is_primary_key && queryResult.columns.includes(c.name))
      .map((c) => c.name);
  }, [selectedTable, queryResult]);

  const canEdit = !!selectedTable && pkColumns.length > 0;

  if (connectionStatus !== "connected") {
    return <div className="flex-1 flex items-center justify-center text-muted-foreground text-xs">Connect to a database to run queries</div>;
  }
  if (isQueryRunning) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground text-xs gap-2">
        <div className="h-3.5 w-3.5 border-2 border-primary/40 border-t-primary rounded-full animate-spin" />
        Running query…
      </div>
    );
  }
  if (!queryResult) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground text-xs gap-2">
        <Table2 className="h-4 w-4 opacity-40" />Run a query to see results
      </div>
    );
  }
  if (queryResult.error) {
    return (
      <div className="flex-1 p-4">
        <div className="flex items-start gap-2 text-destructive bg-destructive/10 rounded-md px-3 py-2.5">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          <pre className="text-xs whitespace-pre-wrap break-words font-mono">{queryResult.error}</pre>
        </div>
      </div>
    );
  }
  if (queryResult.columns.length === 0) {
    return (
      <div className="flex items-center gap-2 px-4 py-3 text-xs text-muted-foreground border-t border-border">
        <span className="text-green-500">✓</span>
        Query executed successfully. No rows returned.
        <span className="ml-auto text-muted-foreground/60">{queryResult.execution_time_ms}ms</span>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Truncation warning */}
      {queryResult.truncated && (
        <div className="flex items-center gap-2 px-3 py-1.5 bg-yellow-500/10 border-b border-yellow-500/20 shrink-0">
          <span className="text-[11px] text-yellow-500/90">
            Result limited to {(10_000).toLocaleString()} rows. Add a LIMIT clause to see more.
          </span>
        </div>
      )}
      {/* Status bar */}
      <div className="flex items-center gap-3 px-3 h-7 border-b border-border shrink-0 text-[11px] text-muted-foreground">
        <span>
          <span className="text-foreground font-medium">{queryResult.row_count}</span>{" "}
          {queryResult.row_count === 1 ? "row" : "rows"}
        </span>
        <span className="text-muted-foreground/40">·</span>
        <span>{queryResult.execution_time_ms}ms</span>
        {sortCol !== null && (
          <>
            <span className="text-muted-foreground/40">·</span>
            <span>sorted by <span className="text-foreground">{queryResult.columns[sortCol]}</span> {sortDir}</span>
            <button onClick={() => setSortCol(null)} className="text-muted-foreground/50 hover:text-foreground">clear</button>
          </>
        )}

        {/* Pagination */}
        {lastRunSql && (queryPage > 0 || queryResult.row_count >= PAGE_SIZE) && (
          <>
            <span className="text-muted-foreground/40">·</span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => navigatePage(queryPage - 1)}
                disabled={queryPage === 0 || pageLoading}
                className="px-1.5 py-0.5 rounded hover:bg-accent disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                title="Previous page"
              >
                ←
              </button>
              <span className="text-muted-foreground/60 min-w-[60px] text-center">
                {pageLoading ? "…" : `rows ${queryPage * PAGE_SIZE + 1}–${queryPage * PAGE_SIZE + queryResult.row_count}`}
              </span>
              <button
                onClick={() => navigatePage(queryPage + 1)}
                disabled={queryResult.row_count < PAGE_SIZE || pageLoading}
                className="px-1.5 py-0.5 rounded hover:bg-accent disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                title="Next page"
              >
                →
              </button>
            </div>
          </>
        )}

        <div className="ml-auto flex items-center gap-2">
          {/* Edit mode toggle */}
          {canEdit && (
            <button
              onClick={() => setEditMode((v) => !v)}
              className={`flex items-center gap-1 px-2 py-0.5 rounded text-[11px] transition-colors border ${
                editMode
                  ? "border-primary/50 text-primary bg-primary/10"
                  : "border-border text-muted-foreground hover:text-foreground hover:border-muted-foreground"
              }`}
              title="Toggle edit mode (double-click cells to edit)"
            >
              <Pencil className="h-2.5 w-2.5" />
              {editMode ? "Editing" : "Edit"}
            </button>
          )}
          <span className="text-muted-foreground/30">|</span>
          <button onClick={() => exportJson(queryResult.columns, sortedRows)} className="flex items-center gap-1 hover:text-foreground transition-colors" title="Export JSON">
            <Download className="h-3 w-3" />JSON
          </button>
          <span className="text-muted-foreground/30">|</span>
          <button onClick={() => exportCsv(queryResult.columns, sortedRows)} className="flex items-center gap-1 hover:text-foreground transition-colors" title="Export CSV">
            <Download className="h-3 w-3" />CSV
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="sticky top-0 bg-card z-10">
              <th className="px-2 py-2 text-right text-muted-foreground/40 font-medium border-b border-border w-10 select-none">#</th>
              {queryResult.columns.map((col, j) => (
                <th
                  key={col}
                  onClick={() => handleSort(j)}
                  className="px-3 py-2 text-left text-muted-foreground font-medium border-b border-border whitespace-nowrap cursor-pointer hover:text-foreground hover:bg-accent/40 transition-colors select-none group"
                >
                  <div className="flex items-center gap-1.5">
                    {col}
                    <SortIcon col={j} sortCol={sortCol} sortDir={sortDir} />
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((row, i) => (
              <DataRow
                key={i}
                row={row}
                rowIndex={i}
                columns={queryResult.columns}
                editMode={editMode}
                pkColumns={pkColumns}
                onUpdateSuccess={handleUpdateSuccess}
              />
            ))}
          </tbody>
        </table>
      </div>

      {editMode && (
        <div className="px-3 py-1.5 border-t border-border bg-primary/5 text-[11px] text-primary/70 shrink-0">
          Edit mode — double-click any cell to edit · Enter to save · Escape to cancel
          {pkColumns.length > 0 && <span className="ml-2 text-muted-foreground/40">WHERE {pkColumns.join(", ")}</span>}
        </div>
      )}
    </div>
  );
}
