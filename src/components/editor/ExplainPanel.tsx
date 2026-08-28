import { useState } from "react";
import { useAppStore, type ExplainNode, type ExplainResult } from "@/store/useAppStore";
import { ChevronRight, ChevronDown, Zap, X } from "lucide-react";

// ── Node type styling ─────────────────────────────────────────────────────────

interface NodeStyle { badge: string; dot: string }

const NODE_STYLES: Record<string, NodeStyle> = {
  "Seq Scan":          { badge: "bg-orange-500/15 text-orange-400 border-orange-500/20",  dot: "bg-orange-500" },
  "Index Scan":        { badge: "bg-green-500/15 text-green-400 border-green-500/20",     dot: "bg-green-500" },
  "Index Only Scan":   { badge: "bg-emerald-500/15 text-emerald-400 border-emerald-500/20", dot: "bg-emerald-500" },
  "Bitmap Heap Scan":  { badge: "bg-blue-500/15 text-blue-400 border-blue-500/20",        dot: "bg-blue-500" },
  "Bitmap Index Scan": { badge: "bg-sky-500/15 text-sky-400 border-sky-500/20",           dot: "bg-sky-500" },
  "Nested Loop":       { badge: "bg-cyan-500/15 text-cyan-400 border-cyan-500/20",        dot: "bg-cyan-500" },
  "Hash Join":         { badge: "bg-violet-500/15 text-violet-400 border-violet-500/20",  dot: "bg-violet-500" },
  "Merge Join":        { badge: "bg-purple-500/15 text-purple-400 border-purple-500/20",  dot: "bg-purple-500" },
  "Hash":              { badge: "bg-indigo-500/15 text-indigo-400 border-indigo-500/20",  dot: "bg-indigo-500" },
  "Sort":              { badge: "bg-yellow-500/15 text-yellow-400 border-yellow-500/20",  dot: "bg-yellow-500" },
  "Aggregate":         { badge: "bg-pink-500/15 text-pink-400 border-pink-500/20",        dot: "bg-pink-500" },
  "Group Aggregate":   { badge: "bg-pink-500/15 text-pink-400 border-pink-500/20",        dot: "bg-pink-500" },
  "Hash Aggregate":    { badge: "bg-fuchsia-500/15 text-fuchsia-400 border-fuchsia-500/20", dot: "bg-fuchsia-500" },
  "Limit":             { badge: "bg-muted/30 text-muted-foreground border-border",        dot: "bg-muted-foreground/50" },
  "Append":            { badge: "bg-teal-500/15 text-teal-400 border-teal-500/20",        dot: "bg-teal-500" },
  "CTE Scan":          { badge: "bg-teal-500/15 text-teal-400 border-teal-500/20",        dot: "bg-teal-500" },
  "Subquery Scan":     { badge: "bg-slate-500/15 text-slate-400 border-slate-500/20",     dot: "bg-slate-500" },
  "Materialize":       { badge: "bg-slate-500/15 text-slate-400 border-slate-500/20",     dot: "bg-slate-500" },
  "Unique":            { badge: "bg-amber-500/15 text-amber-400 border-amber-500/20",     dot: "bg-amber-500" },
  "Gather":            { badge: "bg-rose-500/15 text-rose-400 border-rose-500/20",        dot: "bg-rose-500" },
  "Gather Merge":      { badge: "bg-rose-500/15 text-rose-400 border-rose-500/20",        dot: "bg-rose-500" },
};

function nodeStyle(type: string): NodeStyle {
  return NODE_STYLES[type] ?? { badge: "bg-muted/20 text-muted-foreground border-border", dot: "bg-muted-foreground/40" };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function totalTime(node: ExplainNode): number {
  return (node["Actual Total Time"] ?? node["Total Cost"]) * (node["Actual Loops"] ?? 1);
}

function selfTime(node: ExplainNode): number {
  const t = totalTime(node);
  const childSum = (node.Plans ?? []).reduce((s, c) => s + totalTime(c), 0);
  return Math.max(0, t - childSum);
}

function timingBarColor(pct: number): string {
  if (pct > 60) return "bg-red-500/70";
  if (pct > 30) return "bg-orange-500/70";
  if (pct > 10) return "bg-yellow-500/70";
  return "bg-green-500/60";
}

function fmtMs(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`;
  if (ms >= 1) return `${ms.toFixed(2)}ms`;
  return `${ms.toFixed(3)}ms`;
}

function getCondition(node: ExplainNode): string | undefined {
  return (
    node["Index Cond"] ??
    node["Hash Cond"] ??
    node["Merge Cond"] ??
    node["Join Filter"] ??
    node["Filter"] ??
    node["Recheck Cond"]
  );
}

// ── Node row ──────────────────────────────────────────────────────────────────

function NodeRow({
  node,
  depth,
  rootTime,
}: {
  node: ExplainNode;
  depth: number;
  rootTime: number;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const hasChildren = (node.Plans ?? []).length > 0;

  const time = totalTime(node);
  const self = selfTime(node);
  const pct = rootTime > 0 ? (time / rootTime) * 100 : 0;
  const selfPct = rootTime > 0 ? (self / rootTime) * 100 : 0;
  const hasActual = node["Actual Total Time"] !== undefined;

  const style = nodeStyle(node["Node Type"]);
  const condition = getCondition(node);

  const relationLabel =
    node["Relation Name"]
      ? node["Alias"] && node["Alias"] !== node["Relation Name"]
        ? `${node["Relation Name"]} (${node["Alias"]})`
        : node["Relation Name"]
      : node["Index Name"]
      ? node["Index Name"]
      : undefined;

  const actualRows = node["Actual Rows"] ?? 0;
  const estRows = node["Plan Rows"];
  const rowRatio = estRows > 0 ? actualRows / estRows : 1;
  const rowBad = rowRatio > 10 || rowRatio < 0.1;

  return (
    <>
      <div
        className="group flex items-center gap-2 py-1.5 pr-3 text-xs hover:bg-accent/20 transition-colors"
        style={{ paddingLeft: `${8 + depth * 18}px` }}
      >
        {/* Chevron / spacer */}
        <button
          onClick={() => hasChildren && setCollapsed((v) => !v)}
          className={`shrink-0 w-4 flex items-center justify-center ${
            hasChildren ? "text-muted-foreground hover:text-foreground" : "cursor-default opacity-0"
          }`}
        >
          {hasChildren && (
            collapsed
              ? <ChevronRight className="h-3 w-3" />
              : <ChevronDown className="h-3 w-3" />
          )}
        </button>

        {/* Node type badge */}
        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border shrink-0 ${style.badge}`}>
          {node["Node Type"]}
        </span>

        {/* Relation / index */}
        {relationLabel && (
          <span className="font-mono text-[11px] text-foreground/80 shrink-0">{relationLabel}</span>
        )}

        {/* Join type */}
        {node["Join Type"] && node["Join Type"] !== "Inner" && (
          <span className="text-[10px] text-muted-foreground/50 shrink-0">{node["Join Type"]}</span>
        )}

        {/* Condition */}
        {condition && (
          <span
            className="text-[10px] font-mono text-muted-foreground/40 truncate min-w-0"
            title={condition}
          >
            {condition}
          </span>
        )}

        {/* Right side stats */}
        <div className="ml-auto flex items-center gap-3 shrink-0">
          {/* Timing bar */}
          {hasActual && (
            <div className="flex items-center gap-1.5">
              <div className="w-16 h-1.5 bg-muted/40 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${timingBarColor(pct)}`}
                  style={{ width: `${Math.min(pct, 100)}%` }}
                />
              </div>
              <span className="text-[11px] font-mono text-muted-foreground w-12 text-right">
                {fmtMs(time)}
              </span>
              {depth > 0 && selfPct > 1 && (
                <span className="text-[10px] text-muted-foreground/40 w-8 text-right">
                  {selfPct.toFixed(0)}%
                </span>
              )}
            </div>
          )}

          {/* Rows: actual / estimated */}
          {node["Actual Rows"] !== undefined && (
            <span className={`text-[11px] font-mono w-24 text-right ${rowBad ? "text-orange-400" : "text-muted-foreground/60"}`}>
              {actualRows.toLocaleString()}
              <span className="text-muted-foreground/30"> / {estRows.toLocaleString()}</span>
            </span>
          )}
        </div>
      </div>

      {/* Children */}
      {!collapsed && node.Plans?.map((child, i) => (
        <NodeRow
          key={i}
          node={child}
          depth={depth + 1}
          rootTime={rootTime}
        />
      ))}
    </>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

export function ExplainPanel({ plan }: { plan: ExplainResult }) {
  const { setExplainPlan } = useAppStore();
  const root = plan.Plan;
  const rootT = totalTime(root);
  const execTime = plan["Execution Time"];
  const planTime = plan["Planning Time"];

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-3 h-7 border-b border-border shrink-0 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1.5 text-foreground font-medium">
          <Zap className="h-3 w-3 text-primary" />
          EXPLAIN ANALYZE
        </span>
        {execTime !== undefined && (
          <>
            <span className="text-muted-foreground/30">·</span>
            <span>Exec: <span className="text-foreground font-mono">{fmtMs(execTime)}</span></span>
          </>
        )}
        {planTime !== undefined && (
          <>
            <span className="text-muted-foreground/30">·</span>
            <span>Plan: <span className="text-foreground font-mono">{fmtMs(planTime)}</span></span>
          </>
        )}
        <button
          onClick={() => setExplainPlan(null)}
          className="ml-auto flex items-center gap-1 hover:text-foreground transition-colors"
          title="Close explain view"
        >
          <X className="h-3 w-3" />
          Close
        </button>
      </div>

      {/* Column headers */}
      <div className="flex items-center px-3 py-1 border-b border-border/40 shrink-0 text-[10px] text-muted-foreground/40 select-none">
        <span style={{ paddingLeft: "22px" }}>Node · Relation · Condition</span>
        <div className="ml-auto flex items-center gap-3">
          <span className="w-36 text-right">timing (bar · ms · self%)</span>
          <span className="w-24 text-right">rows (actual / est)</span>
        </div>
      </div>

      {/* Tree */}
      <div className="flex-1 overflow-auto">
        <NodeRow node={root} depth={0} rootTime={rootT} />
      </div>

      {/* Footer legend */}
      <div className="flex items-center gap-4 px-3 h-6 border-t border-border/40 shrink-0 text-[10px] text-muted-foreground/40">
        <span className="flex items-center gap-1">
          <span className="w-3 h-1.5 rounded-full bg-green-500/60 inline-block" /> &lt;10%
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-1.5 rounded-full bg-yellow-500/70 inline-block" /> 10–30%
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-1.5 rounded-full bg-orange-500/70 inline-block" /> 30–60%
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-1.5 rounded-full bg-red-500/70 inline-block" /> &gt;60%
        </span>
        <span className="ml-auto">Orange rows = estimate off by 10×</span>
      </div>
    </div>
  );
}
