import { useState } from "react";
import {
  TableInfo, ViewInfo, MatViewInfo, FunctionInfo, SequenceInfo,
} from "@/lib/tauri-commands";
import {
  Table, Eye, Layers, FunctionSquare, Hash, Key,
  ChevronRight, ChevronDown, RefreshCw, Database,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  tables: TableInfo[];
  views: ViewInfo[];
  matViews: MatViewInfo[];
  sequences: SequenceInfo[];
  functions: FunctionInfo[];
  selectedTable: TableInfo | null;
  onSelectTable: (table: TableInfo) => void;
  onSelectView?: (view: ViewInfo) => void;
  onSelectObject?: (schema: string, name: string, kind: string) => void;
  search?: string;
}

export function SchemaTree({
  tables, views, matViews, sequences, functions,
  selectedTable, onSelectTable, onSelectView, onSelectObject,
  search = "",
}: Props) {
  const q = search.toLowerCase();

  const allSchemas = Array.from(new Set([
    ...tables.map((t) => t.schema),
    ...views.map((v) => v.schema),
    ...matViews.map((m) => m.schema),
    ...sequences.map((s) => s.schema),
    ...functions.map((f) => f.schema),
  ])).sort();

  const [expandedSchemas, setExpandedSchemas] = useState<Set<string>>(new Set(allSchemas));
  const [expandedSections, setExpandedSections] = useState<Set<string>>(
    new Set(allSchemas.flatMap((s) => [
      `${s}:tables`, `${s}:views`, `${s}:matviews`, `${s}:sequences`, `${s}:functions`,
    ]))
  );
  const [expandedTables, setExpandedTables] = useState<Set<string>>(new Set());

  const toggleSchema = (s: string) => setExpandedSchemas((prev) => {
    const n = new Set(prev);
    if (n.has(s)) n.delete(s); else n.add(s);
    return n;
  });
  const toggleSection = (key: string) => setExpandedSections((prev) => {
    const n = new Set(prev);
    if (n.has(key)) n.delete(key); else n.add(key);
    return n;
  });
  const toggleTable = (key: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setExpandedTables((prev) => {
      const n = new Set(prev);
    if (n.has(key)) n.delete(key); else n.add(key);
    return n;
    });
  };

  // Kind label for functions
  const kindBadge: Record<string, string> = {
    function: "fn",
    procedure: "proc",
    aggregate: "agg",
    window: "win",
  };

  return (
    <div className="text-xs">
      {allSchemas.map((schema) => {
        const sTables    = tables.filter((t) => t.schema === schema && (!q || t.name.toLowerCase().includes(q)));
        const sViews     = views.filter((v) => v.schema === schema && (!q || v.name.toLowerCase().includes(q)));
        const sMatViews  = matViews.filter((m) => m.schema === schema && (!q || m.name.toLowerCase().includes(q)));
        const sSequences = sequences.filter((s) => s.schema === schema && (!q || s.name.toLowerCase().includes(q)));
        const sFunctions = functions.filter((f) => f.schema === schema && (!q || f.name.toLowerCase().includes(q)));

        if (!sTables.length && !sViews.length && !sMatViews.length && !sSequences.length && !sFunctions.length) return null;

        const isSchemaExpanded = expandedSchemas.has(schema);

        return (
          <div key={schema}>
            {/* Schema header */}
            <button
              onClick={() => toggleSchema(schema)}
              className="w-full flex items-center gap-1.5 px-3 py-1 text-muted-foreground hover:text-foreground hover:bg-accent/50"
            >
              {isSchemaExpanded
                ? <ChevronDown className="h-3 w-3 shrink-0" />
                : <ChevronRight className="h-3 w-3 shrink-0" />}
              <span className="font-semibold uppercase tracking-wider text-[10px]">{schema}</span>
            </button>

            {isSchemaExpanded && (
              <>
                {/* TABLES */}
                {sTables.length > 0 && (
                  <SectionBlock
                    label="Tables" icon={<Table className="h-2.5 w-2.5" />}
                    count={sTables.length}
                    expanded={expandedSections.has(`${schema}:tables`)}
                    onToggle={() => toggleSection(`${schema}:tables`)}
                  >
                    {sTables.map((table) => {
                      const key = `${table.schema}.${table.name}`;
                      const isSelected = selectedTable?.schema === table.schema && selectedTable?.name === table.name;
                      const isTableExpanded = expandedTables.has(key);
                      return (
                        <div key={key}>
                          <button
                            onClick={() => onSelectTable(table)}
                            className={cn(
                              "w-full flex items-center gap-1.5 px-3 py-1 pl-8 hover:bg-accent/50",
                              isSelected && "bg-primary/15 text-primary hover:bg-primary/20"
                            )}
                          >
                            <button onClick={(e) => toggleTable(key, e)} className="shrink-0 text-muted-foreground hover:text-foreground">
                              {isTableExpanded
                                ? <ChevronDown className="h-3 w-3" />
                                : <ChevronRight className="h-3 w-3" />}
                            </button>
                            <Table className="h-3 w-3 shrink-0 text-primary/70" />
                            <span className={cn("truncate", isSelected ? "text-primary font-medium" : "text-foreground")}>
                              {table.name}
                            </span>
                            {table.row_count_estimate != null && table.row_count_estimate > 0 && (
                              <span className="ml-auto text-[10px] text-muted-foreground/50 shrink-0">
                                {table.row_count_estimate >= 1000
                                  ? `${Math.round(table.row_count_estimate / 1000)}k`
                                  : table.row_count_estimate}
                              </span>
                            )}
                          </button>
                          {isTableExpanded && table.columns.map((col) => (
                            <div key={col.name} className="flex items-center gap-1.5 px-3 py-0.5 pl-14 text-muted-foreground">
                              {col.is_primary_key
                                ? <Key className="h-2.5 w-2.5 shrink-0 text-yellow-500/70" />
                                : <Hash className="h-2.5 w-2.5 shrink-0 text-muted-foreground/40" />}
                              <span className="truncate text-[11px]">{col.name}</span>
                              <span className="ml-auto text-[10px] text-muted-foreground/40 shrink-0">{col.data_type}</span>
                            </div>
                          ))}
                        </div>
                      );
                    })}
                  </SectionBlock>
                )}

                {/* VIEWS */}
                {sViews.length > 0 && (
                  <SectionBlock
                    label="Views" icon={<Eye className="h-2.5 w-2.5" />}
                    count={sViews.length}
                    expanded={expandedSections.has(`${schema}:views`)}
                    onToggle={() => toggleSection(`${schema}:views`)}
                  >
                    {sViews.map((view) => (
                      <button
                        key={`${view.schema}.${view.name}`}
                        onClick={() => onSelectView?.(view)}
                        className="w-full flex items-center gap-1.5 px-3 py-1 pl-8 hover:bg-accent/50"
                      >
                        <Eye className="h-3 w-3 shrink-0 text-sky-400/70" />
                        <span className="truncate text-foreground">{view.name}</span>
                      </button>
                    ))}
                  </SectionBlock>
                )}

                {/* MATERIALIZED VIEWS */}
                {sMatViews.length > 0 && (
                  <SectionBlock
                    label="Materialized Views" icon={<Layers className="h-2.5 w-2.5" />}
                    count={sMatViews.length}
                    expanded={expandedSections.has(`${schema}:matviews`)}
                    onToggle={() => toggleSection(`${schema}:matviews`)}
                  >
                    {sMatViews.map((mv) => (
                      <button
                        key={`${mv.schema}.${mv.name}`}
                        onClick={() => onSelectObject?.(mv.schema, mv.name, "matview")}
                        className="w-full flex items-center gap-1.5 px-3 py-1 pl-8 hover:bg-accent/50"
                      >
                        <Layers className="h-3 w-3 shrink-0 text-teal-400/70" />
                        <span className="truncate text-foreground">{mv.name}</span>
                        {!mv.is_populated && (
                          <span className="ml-auto" title="Not populated">
                            <RefreshCw className="h-2.5 w-2.5 shrink-0 text-muted-foreground/40" />
                          </span>
                        )}
                      </button>
                    ))}
                  </SectionBlock>
                )}

                {/* SEQUENCES */}
                {sSequences.length > 0 && (
                  <SectionBlock
                    label="Sequences" icon={<Database className="h-2.5 w-2.5" />}
                    count={sSequences.length}
                    expanded={expandedSections.has(`${schema}:sequences`)}
                    onToggle={() => toggleSection(`${schema}:sequences`)}
                  >
                    {sSequences.map((seq) => (
                      <button
                        key={`${seq.schema}.${seq.name}`}
                        onClick={() => onSelectObject?.(seq.schema, seq.name, "sequence")}
                        className="w-full flex items-center gap-1.5 px-3 py-1 pl-8 hover:bg-accent/50"
                      >
                        <Database className="h-3 w-3 shrink-0 text-amber-400/70" />
                        <span className="truncate text-foreground">{seq.name}</span>
                        <span className="ml-auto text-[10px] text-muted-foreground/40 shrink-0 font-mono">
                          {seq.increment !== "1" ? `+${seq.increment}` : seq.data_type.replace("integer", "int")}
                        </span>
                      </button>
                    ))}
                  </SectionBlock>
                )}

                {/* FUNCTIONS / PROCEDURES */}
                {sFunctions.length > 0 && (
                  <SectionBlock
                    label="Functions" icon={<FunctionSquare className="h-2.5 w-2.5" />}
                    count={sFunctions.length}
                    expanded={expandedSections.has(`${schema}:functions`)}
                    onToggle={() => toggleSection(`${schema}:functions`)}
                  >
                    {sFunctions.map((fn) => (
                      <button
                        key={`${fn.schema}.${fn.name}.${fn.kind}`}
                        onClick={() => onSelectObject?.(fn.schema, fn.name, fn.kind)}
                        className="w-full flex items-center gap-1.5 px-3 py-1 pl-8 hover:bg-accent/50"
                      >
                        <FunctionSquare className="h-3 w-3 shrink-0 text-violet-400/70" />
                        <span className="truncate text-foreground/80">{fn.name}</span>
                        <span className="ml-auto text-[10px] font-mono text-muted-foreground/40 shrink-0">
                          {kindBadge[fn.kind] ?? fn.kind}
                        </span>
                      </button>
                    ))}
                  </SectionBlock>
                )}
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

function SectionBlock({ label, icon, count, expanded, onToggle, children }: {
  label: string; icon: React.ReactNode; count: number;
  expanded: boolean; onToggle: () => void; children: React.ReactNode;
}) {
  return (
    <div>
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-1.5 px-3 py-0.5 pl-6 text-muted-foreground/70 hover:text-muted-foreground hover:bg-accent/30"
      >
        {expanded ? <ChevronDown className="h-2.5 w-2.5 shrink-0" /> : <ChevronRight className="h-2.5 w-2.5 shrink-0" />}
        <span className="text-muted-foreground/50">{icon}</span>
        <span className="text-[10px] uppercase tracking-wider font-medium">{label}</span>
        <span className="ml-auto text-[10px] text-muted-foreground/40">{count}</span>
      </button>
      {expanded && children}
    </div>
  );
}
