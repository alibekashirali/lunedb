import { useRef, useState, useCallback } from "react";
import { SqlEditor } from "@/components/editor/SqlEditor";
import { ResultsGrid } from "@/components/editor/ResultsGrid";
import { StructurePanel } from "@/components/editor/StructurePanel";
import { ExplainPanel } from "@/components/editor/ExplainPanel";
import { useAppStore } from "@/store/useAppStore";
import { Table2, Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";

const STRUCTURE_ID = "structure";

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

function VerticalResizeHandle({ onDrag }: { onDrag: (dy: number) => void }) {
  // Keep a ref to always call the latest onDrag — avoids stale closure during drag
  const onDragRef = useRef(onDrag);
  onDragRef.current = onDrag;

  const start = (e: React.MouseEvent) => {
    e.preventDefault();
    let last = e.clientY;
    const move = (e: MouseEvent) => { onDragRef.current(e.clientY - last); last = e.clientY; };
    const up = () => {
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", up);
      document.body.style.cursor = "";
    };
    document.body.style.cursor = "row-resize";
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
  };

  return (
    <div onMouseDown={start} className="h-[5px] shrink-0 cursor-row-resize group relative z-10">
      <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-px bg-border group-hover:bg-primary/50 group-active:bg-primary transition-colors" />
    </div>
  );
}

export function CenterPanel({
  rightOpen,
  onToggleRight,
}: {
  rightOpen: boolean;
  onToggleRight: () => void;
}) {
  const { tabs, activeTabId, createTab, closeTab, setActiveTab, selectedTable, explainPlan } =
    useAppStore();

  const isStructure = activeTabId === STRUCTURE_ID;
  const containerRef = useRef<HTMLDivElement>(null);
  const [editorPx, setEditorPx] = useState<number | null>(null); // null = use default %

  const handleVerticalDrag = useCallback((dy: number) => {
    const container = containerRef.current;
    if (!container) return;
    const totalH = container.clientHeight;
    // Functional form ensures we always get the latest prev value, even from stale closures
    setEditorPx((prev) => clamp((prev ?? totalH * 0.42) + dy, 120, totalH - 120));
  }, []);

  return (
    <div className="flex-1 flex flex-col overflow-hidden min-h-0">
      {/* ── Tab bar ─────────────────────────────────────────── */}
      <div
        className="flex items-end h-9 border-b border-border shrink-0 overflow-hidden"
        data-tauri-drag-region
      >
        <div className="flex items-end flex-1 overflow-x-auto scrollbar-none min-w-0 h-full">
          {tabs.map((tab) => (
            <QueryTabBtn
              key={tab.id}
              name={tab.name}
              active={activeTabId === tab.id}
              onActivate={() => setActiveTab(tab.id)}
              onClose={tabs.length > 1 ? () => closeTab(tab.id) : undefined}
            />
          ))}
          <button
            onClick={() => createTab()}
            className="h-full px-2.5 flex items-center text-muted-foreground hover:text-foreground hover:bg-accent/40 transition-colors shrink-0"
            title="New tab"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="shrink-0 flex items-end h-full border-l border-border">
          <button
            onClick={() => setActiveTab(STRUCTURE_ID)}
            disabled={!selectedTable}
            className={cn(
              "flex items-center gap-1.5 px-4 h-full text-xs font-medium transition-colors border-b-2",
              isStructure
                ? "border-primary text-primary bg-primary/5"
                : !selectedTable
                ? "border-transparent text-muted-foreground/30 cursor-not-allowed"
                : "border-transparent text-muted-foreground hover:text-foreground hover:bg-accent/50"
            )}
          >
            <Table2 className="h-3 w-3" />
            Structure
          </button>
        </div>
      </div>

      {/* ── Content ─────────────────────────────────────────── */}
      {isStructure ? (
        <div className="flex-1 overflow-hidden flex flex-col min-h-0">
          <StructurePanel />
        </div>
      ) : (
        <div ref={containerRef} className="flex-1 flex flex-col overflow-hidden min-h-0">
          <div
            className="shrink-0 flex flex-col overflow-hidden border-b border-border"
            style={{ height: editorPx ?? "42%" }}
          >
            <SqlEditor rightOpen={rightOpen} onToggleRight={onToggleRight} />
          </div>
          <VerticalResizeHandle onDrag={handleVerticalDrag} />
          <div className="flex-1 flex flex-col overflow-hidden min-h-0">
            {explainPlan ? <ExplainPanel plan={explainPlan} /> : <ResultsGrid />}
          </div>
        </div>
      )}
    </div>
  );
}

function QueryTabBtn({
  name,
  active,
  onActivate,
  onClose,
}: {
  name: string;
  active: boolean;
  onActivate: () => void;
  onClose?: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const { nameActiveTab } = useAppStore();

  const startEdit = (e: React.MouseEvent) => {
    if (!active) return;
    e.stopPropagation();
    setDraft(name);
    setEditing(true);
    setTimeout(() => inputRef.current?.select(), 0);
  };

  const commitEdit = () => {
    if (draft.trim()) nameActiveTab(draft.trim());
    setEditing(false);
  };

  return (
    <div
      onDoubleClick={startEdit}
      onClick={onActivate}
      className={cn(
        "group relative flex items-center gap-1.5 px-3 h-full text-xs cursor-pointer select-none border-b-2 shrink-0 max-w-[160px] transition-colors",
        active
          ? "border-primary text-foreground bg-primary/5"
          : "border-transparent text-muted-foreground hover:text-foreground hover:bg-accent/40"
      )}
    >
      {editing ? (
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitEdit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitEdit();
            if (e.key === "Escape") setEditing(false);
          }}
          onClick={(e) => e.stopPropagation()}
          className="w-24 bg-transparent border-b border-primary outline-none text-xs font-medium text-foreground"
          autoFocus
        />
      ) : (
        <span className="truncate font-medium">{name}</span>
      )}

      {onClose && (
        <button
          onClick={(e) => { e.stopPropagation(); onClose(); }}
          className={cn(
            "p-0.5 rounded transition-colors shrink-0",
            active
              ? "text-muted-foreground hover:text-foreground hover:bg-accent"
              : "opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground"
          )}
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}
