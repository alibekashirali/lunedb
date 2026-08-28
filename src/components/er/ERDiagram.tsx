import { useState, useEffect, useCallback, useRef } from "react";
import { useAppStore } from "@/store/useAppStore";
import { executeQuery } from "@/lib/tauri-commands";
import { RefreshCw, ZoomIn, ZoomOut, Maximize2, Key, Hash } from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface FKEdge {
  sourceTable: string; // "schema.name"
  sourceCol: string;
  targetTable: string;
  targetCol: string;
}

interface TableNode {
  id: string; // "schema.name"
  name: string;
  schema: string;
  columns: Array<{ name: string; isPk: boolean; type: string }>;
  x: number;
  y: number;
  width: number;
  height: number;
}

// ── Layout ────────────────────────────────────────────────────────────────────

const COL_HEIGHT = 20;
const HEADER_HEIGHT = 32;
const BOX_WIDTH = 200;
const H_GAP = 100;
const V_GAP = 32;

function layoutNodes(rawNodes: Omit<TableNode, "x" | "y">[], fkEdges: FKEdge[]): TableNode[] {
  const nodeIds = new Set(rawNodes.map((n) => n.id));

  // outEdges[src] = unique targets this node FKs to
  // reverseEdges[tgt] = sources that FK to this target (for propagation)
  const outEdges = new Map<string, Set<string>>();
  const reverseEdges = new Map<string, Set<string>>();
  for (const n of rawNodes) {
    outEdges.set(n.id, new Set());
    reverseEdges.set(n.id, new Set());
  }
  for (const e of fkEdges) {
    if (e.sourceTable === e.targetTable) continue;
    if (!nodeIds.has(e.sourceTable) || !nodeIds.has(e.targetTable)) continue;
    outEdges.get(e.sourceTable)!.add(e.targetTable);
    reverseEdges.get(e.targetTable)!.add(e.sourceTable);
  }

  // column[n] = max(column[target] + 1) for all FK targets, 0 if none
  // Process in BFS order: nodes with no outgoing FK first (column 0),
  // then propagate column values up to their sources via reverseEdges.
  const col = new Map<string, number>(rawNodes.map((n) => [n.id, 0]));
  const outDegree = new Map<string, number>(rawNodes.map((n) => [n.id, outEdges.get(n.id)!.size]));

  const queue: string[] = [];
  for (const n of rawNodes) if (outDegree.get(n.id) === 0) queue.push(n.id);

  let qi = 0;
  while (qi < queue.length) {
    const id = queue[qi++];
    const myCol = col.get(id)!;
    for (const src of reverseEdges.get(id)!) {
      if (myCol + 1 > col.get(src)!) col.set(src, myCol + 1);
      const rem = outDegree.get(src)! - 1;
      outDegree.set(src, rem);
      if (rem === 0) queue.push(src);
    }
  }

  // Group by column, sort each column by table name for determinism
  const byCol = new Map<number, Omit<TableNode, "x" | "y">[]>();
  for (const n of rawNodes) {
    const c = col.get(n.id)!;
    if (!byCol.has(c)) byCol.set(c, []);
    byCol.get(c)!.push(n);
  }

  const result: TableNode[] = [];
  for (const [c, nodes] of [...byCol.entries()].sort(([a], [b]) => a - b)) {
    nodes.sort((a, b) => a.name.localeCompare(b.name));
    let y = 40;
    for (const n of nodes) {
      const h = HEADER_HEIGHT + n.columns.length * COL_HEIGHT + 8;
      result.push({ ...n, x: 40 + c * (BOX_WIDTH + H_GAP), y, width: BOX_WIDTH, height: h });
      y += h + V_GAP;
    }
  }
  return result;
}

// ── SVG arrow (cubic bezier between boxes) ────────────────────────────────────

function Arrow({
  sx, sy, tx, ty, label,
}: {
  sx: number; sy: number; tx: number; ty: number; label: string;
}) {
  const dx = tx - sx;
  const cx1 = sx + dx * 0.5;
  const cx2 = tx - dx * 0.5;
  const d = `M ${sx} ${sy} C ${cx1} ${sy}, ${cx2} ${ty}, ${tx} ${ty}`;
  const mx = (sx + tx) / 2;
  const my = (sy + ty) / 2;

  return (
    <g className="pointer-events-none">
      <path d={d} fill="none" stroke="oklch(0.60 0.22 265)" strokeWidth={1.5} strokeOpacity={0.6} markerEnd="url(#arrowhead)" />
      <text x={mx} y={my - 4} textAnchor="middle" className="text-[9px] fill-primary/60 font-mono select-none" fontSize={9}>
        {label}
      </text>
    </g>
  );
}

// ── Table box ─────────────────────────────────────────────────────────────────

function TableBox({
  node,
  selected,
  onSelect,
  onDragEnd,
}: {
  node: TableNode;
  selected: boolean;
  onSelect: () => void;
  onDragEnd: (id: string, x: number, y: number) => void;
}) {
  const dragStart = useRef<{ mx: number; my: number; ox: number; oy: number } | null>(null);

  const handleMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation();
    onSelect();
    dragStart.current = { mx: e.clientX, my: e.clientY, ox: node.x, oy: node.y };

    const move = (e: MouseEvent) => {
      if (!dragStart.current) return;
      const dx = e.clientX - dragStart.current.mx;
      const dy = e.clientY - dragStart.current.my;
      onDragEnd(node.id, dragStart.current.ox + dx, dragStart.current.oy + dy);
    };
    const up = () => {
      dragStart.current = null;
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", up);
    };
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
  };

  return (
    <g transform={`translate(${node.x},${node.y})`} onMouseDown={handleMouseDown} style={{ cursor: "grab" }}>
      {/* Shadow */}
      <rect
        x={3} y={3}
        width={node.width} height={node.height}
        rx={6} ry={6}
        fill="black" fillOpacity={0.25}
      />
      {/* Box */}
      <rect
        width={node.width} height={node.height}
        rx={6} ry={6}
        fill="var(--card)"
        stroke={selected ? "oklch(0.60 0.22 265)" : "var(--border)"}
        strokeWidth={selected ? 2 : 1}
      />
      {/* Header */}
      <rect width={node.width} height={HEADER_HEIGHT} rx={6} ry={6} fill="oklch(0.60 0.22 265)" fillOpacity={0.15} />
      <rect y={HEADER_HEIGHT - 6} width={node.width} height={6} fill="oklch(0.60 0.22 265)" fillOpacity={0.15} />
      {/* Table name */}
      <text x={10} y={HEADER_HEIGHT / 2 + 5} fontSize={11} fontWeight={600} fill="var(--foreground)" className="select-none">
        {node.name}
      </text>
      <text x={10} y={HEADER_HEIGHT / 2 - 5} fontSize={8} fill="var(--muted-foreground)" fillOpacity={0.6} className="select-none">
        {node.schema}
      </text>
      {/* Columns */}
      {node.columns.map((col, i) => (
        <g key={col.name} transform={`translate(0,${HEADER_HEIGHT + 4 + i * COL_HEIGHT})`}>
          <text x={26} y={13} fontSize={10} fill={col.isPk ? "oklch(0.78 0.18 95)" : "var(--foreground)"} fillOpacity={0.85} className="select-none font-mono">
            {col.name}
          </text>
          <text x={node.width - 6} y={13} fontSize={9} fill="var(--muted-foreground)" fillOpacity={0.45} textAnchor="end" className="select-none font-mono">
            {col.type.replace("character varying", "varchar").replace("timestamp without time zone", "timestamp").slice(0, 12)}
          </text>
          {col.isPk
            ? <text x={12} y={13} fontSize={9} fill="oklch(0.78 0.18 95)" textAnchor="middle" className="select-none">🔑</text>
            : <text x={12} y={13} fontSize={9} fill="var(--muted-foreground)" fillOpacity={0.35} textAnchor="middle" className="select-none">#</text>}
        </g>
      ))}
    </g>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

export function ERDiagram() {
  const { schema: tables, connectionStatus } = useAppStore();
  const [edges, setEdges] = useState<FKEdge[]>([]);
  const [nodes, setNodes] = useState<TableNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const svgRef = useRef<SVGSVGElement>(null);
  const panStart = useRef<{ mx: number; my: number; ox: number; oy: number } | null>(null);

  const load = useCallback(async () => {
    if (!tables.length) return;
    setLoading(true);
    try {
      const result = await executeQuery(`
        SELECT
          tc.table_schema || '.' || tc.table_name   AS source_table,
          kcu.column_name                            AS source_col,
          ccu.table_schema || '.' || ccu.table_name  AS target_table,
          ccu.column_name                            AS target_col
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
        JOIN information_schema.constraint_column_usage ccu
          ON ccu.constraint_name = tc.constraint_name
        WHERE tc.constraint_type = 'FOREIGN KEY'
          AND tc.table_schema NOT IN ('information_schema','pg_catalog')
        ORDER BY source_table, source_col
      `);

      const fks: FKEdge[] = (result.rows ?? []).map((r) => ({
        sourceTable: String((r as string[])[0]),
        sourceCol: String((r as string[])[1]),
        targetTable: String((r as string[])[2]),
        targetCol: String((r as string[])[3]),
      }));
      setEdges(fks);

      const rawNodes = tables.map((t) => ({
        id: `${t.schema}.${t.name}`,
        name: t.name,
        schema: t.schema,
        width: BOX_WIDTH,
        height: HEADER_HEIGHT + t.columns.length * COL_HEIGHT + 8,
        columns: t.columns.map((c) => ({ name: c.name, isPk: c.is_primary_key, type: c.data_type })),
      }));

      setNodes(layoutNodes(rawNodes, fks));
    } finally {
      setLoading(false);
    }
  }, [tables]);

  useEffect(() => { load(); }, [load]);

  const updateNodePos = useCallback((id: string, x: number, y: number) => {
    setNodes((prev) => prev.map((n) => n.id === id ? { ...n, x: Math.max(0, x), y: Math.max(0, y) } : n));
  }, []);

  // Pan on SVG background drag
  const handleSvgMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    panStart.current = { mx: e.clientX, my: e.clientY, ox: pan.x, oy: pan.y };
    const move = (e: MouseEvent) => {
      if (!panStart.current) return;
      setPan({ x: panStart.current.ox + e.clientX - panStart.current.mx, y: panStart.current.oy + e.clientY - panStart.current.my });
    };
    const up = () => { panStart.current = null; document.removeEventListener("mousemove", move); document.removeEventListener("mouseup", up); };
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    setZoom((z) => Math.max(0.3, Math.min(2.5, z - e.deltaY * 0.001)));
  };

  const resetView = () => { setZoom(1); setPan({ x: 0, y: 0 }); };

  // Compute arrow endpoints: right edge of source box, left edge of target box
  function edgePoints(edge: FKEdge) {
    const src = nodes.find((n) => n.id === edge.sourceTable);
    const tgt = nodes.find((n) => n.id === edge.targetTable);
    if (!src || !tgt || src.id === tgt.id) return null;
    const srcColIdx = src.columns.findIndex((c) => c.name === edge.sourceCol);
    const tgtColIdx = tgt.columns.findIndex((c) => c.name === edge.targetCol);
    const sy = src.y + HEADER_HEIGHT + 4 + srcColIdx * COL_HEIGHT + 10;
    const ty = tgt.y + HEADER_HEIGHT + 4 + tgtColIdx * COL_HEIGHT + 10;
    // Pick left or right based on relative positions
    const srcRight = src.x + src.width < tgt.x;
    const tgtRight = tgt.x + tgt.width < src.x;
    const sx = srcRight ? src.x + src.width : (tgtRight ? src.x : src.x + src.width);
    const tx = srcRight ? tgt.x : (tgtRight ? tgt.x + tgt.width : tgt.x);
    return { sx, sy, tx, ty };
  }

  if (connectionStatus !== "connected") {
    return <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">Connect to a database first</div>;
  }

  if (!tables.length) {
    return <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">No tables found in schema</div>;
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-muted/10">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 h-9 border-b border-border shrink-0 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{tables.length} tables</span>
        <span className="text-muted-foreground/40">·</span>
        <span>{edges.length} FK relations</span>
        <span className="text-muted-foreground/40">·</span>
        <span className="flex items-center gap-1">
          <Key className="h-2.5 w-2.5 text-yellow-400" /> PK
          <Hash className="h-2.5 w-2.5 ml-1 text-muted-foreground/40" /> col
        </span>
        <div className="ml-auto flex items-center gap-1">
          <button onClick={() => setZoom((z) => Math.min(2.5, z + 0.15))} className="p-1.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground" title="Zoom in">
            <ZoomIn className="h-3.5 w-3.5" />
          </button>
          <span className="text-[11px] w-10 text-center">{Math.round(zoom * 100)}%</span>
          <button onClick={() => setZoom((z) => Math.max(0.3, z - 0.15))} className="p-1.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground" title="Zoom out">
            <ZoomOut className="h-3.5 w-3.5" />
          </button>
          <button onClick={resetView} className="p-1.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground" title="Reset view">
            <Maximize2 className="h-3.5 w-3.5" />
          </button>
          <button onClick={load} disabled={loading} className="p-1.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground disabled:opacity-40" title="Refresh">
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {/* Canvas */}
      <div className="flex-1 overflow-hidden" onWheel={handleWheel}>
        <svg
          ref={svgRef}
          width="100%" height="100%"
          onMouseDown={handleSvgMouseDown}
          style={{ cursor: "grab", userSelect: "none" }}
        >
          <defs>
            <marker id="arrowhead" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
              <polygon points="0 0, 8 3, 0 6" fill="oklch(0.60 0.22 265)" fillOpacity={0.7} />
            </marker>
          </defs>

          <g transform={`translate(${pan.x},${pan.y}) scale(${zoom})`}>
            {/* Edges */}
            {edges.map((edge, i) => {
              const pts = edgePoints(edge);
              if (!pts) return null;
              return (
                <Arrow
                  key={i}
                  sx={pts.sx} sy={pts.sy}
                  tx={pts.tx} ty={pts.ty}
                  label={`${edge.sourceCol} → ${edge.targetCol}`}
                />
              );
            })}

            {/* Nodes */}
            {nodes.map((node) => (
              <TableBox
                key={node.id}
                node={node}
                selected={selectedId === node.id}
                onSelect={() => setSelectedId(node.id)}
                onDragEnd={updateNodePos}
              />
            ))}
          </g>
        </svg>
      </div>

      {/* Hint */}
      <div className="px-3 py-1 border-t border-border shrink-0 text-[10px] text-muted-foreground/40">
        Drag tables to reposition · Scroll to zoom · Drag background to pan
      </div>
    </div>
  );
}
