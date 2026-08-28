import { useState, useCallback, useEffect } from "react";
import { useAppStore } from "@/store/useAppStore";
import { executeQuery } from "@/lib/tauri-commands";
import { Key, Hash, Type, Table2, BarChart2, Loader2, X, Link, Zap, List } from "lucide-react";
import type { ColumnInfo } from "@/lib/tauri-commands";

function typeShort(pgType: string): { label: string; cls: string } {
  const t = pgType.toLowerCase();
  if (t === "integer" || t === "int4") return { label: "int4", cls: "text-blue-400" };
  if (t === "bigint" || t === "int8") return { label: "int8", cls: "text-blue-400" };
  if (t === "smallint" || t === "int2") return { label: "int2", cls: "text-blue-300" };
  if (t === "serial" || t === "bigserial") return { label: t, cls: "text-blue-400" };
  if (t === "text") return { label: "text", cls: "text-green-400" };
  if (t === "character varying" || t.startsWith("character varying")) return { label: "varchar", cls: "text-green-400" };
  if (t.startsWith("character")) return { label: "char", cls: "text-green-300" };
  if (t === "boolean") return { label: "bool", cls: "text-purple-400" };
  if (t === "uuid") return { label: "uuid", cls: "text-cyan-400" };
  if (t === "jsonb") return { label: "jsonb", cls: "text-pink-400" };
  if (t === "json") return { label: "json", cls: "text-pink-300" };
  if (t === "date") return { label: "date", cls: "text-yellow-300" };
  if (t === "time without time zone") return { label: "time", cls: "text-yellow-400" };
  if (t === "time with time zone") return { label: "timetz", cls: "text-yellow-400" };
  if (t === "timestamp without time zone") return { label: "timestamp", cls: "text-yellow-400" };
  if (t === "timestamp with time zone") return { label: "timestamptz", cls: "text-yellow-400" };
  if (t === "numeric" || t.startsWith("numeric")) return { label: "numeric", cls: "text-orange-400" };
  if (t === "real" || t === "float4") return { label: "float4", cls: "text-orange-300" };
  if (t === "double precision" || t === "float8") return { label: "float8", cls: "text-orange-400" };
  if (t === "bytea") return { label: "bytea", cls: "text-red-400" };
  if (t === "array") return { label: "array", cls: "text-violet-400" };
  if (t === "user-defined") return { label: "custom", cls: "text-muted-foreground" };
  return { label: t.length > 12 ? t.slice(0, 12) + "…" : t, cls: "text-muted-foreground" };
}

// ── Profile panel ─────────────────────────────────────────────────────────

interface ProfileResult {
  total: number;
  non_null: number;
  null_count: number;
  null_pct: number;
  distinct_count: number;
  distinct_pct: number;
  min_val: string | null;
  max_val: string | null;
  avg_val: string | null;
  top_values: Array<{ value: string; count: number }>;
}

function NullBar({ pct }: { pct: number }) {
  return (
    <div className="flex items-center gap-1.5">
      <div className="flex-1 h-1.5 bg-muted/60 rounded-full overflow-hidden">
        <div className="h-full bg-red-500/50 rounded-full" style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>
      <span className="text-[10px] text-muted-foreground w-8 text-right">{pct}%</span>
    </div>
  );
}

function ProfilePanel({ colName, data, onClose }: { colName: string; data: ProfileResult; onClose: () => void }) {
  return (
    <div className="border-t border-border/60 bg-muted/10 px-4 py-3 space-y-2.5">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold text-foreground/80">
          Profile · <span className="font-mono text-primary">{colName}</span>
        </span>
        <button onClick={onClose} className="p-0.5 rounded hover:bg-accent text-muted-foreground">
          <X className="h-3 w-3" />
        </button>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {[
          { label: "Total", value: data.total.toLocaleString() },
          { label: "Non-null", value: data.non_null.toLocaleString() },
          { label: "Distinct", value: data.distinct_count.toLocaleString() },
        ].map(({ label, value }) => (
          <div key={label} className="bg-muted/40 rounded-lg px-2.5 py-1.5">
            <p className="text-[10px] text-muted-foreground/60">{label}</p>
            <p className="text-xs font-mono font-semibold text-foreground">{value}</p>
          </div>
        ))}
      </div>
      <div>
        <p className="text-[10px] text-muted-foreground/60 mb-1">Null ({data.null_count.toLocaleString()})</p>
        <NullBar pct={data.null_pct} />
      </div>
      <div>
        <p className="text-[10px] text-muted-foreground/60 mb-1">Distinct ({data.distinct_pct}%)</p>
        <div className="flex items-center gap-1.5">
          <div className="flex-1 h-1.5 bg-muted/60 rounded-full overflow-hidden">
            <div className="h-full bg-primary/40 rounded-full" style={{ width: `${Math.min(data.distinct_pct, 100)}%` }} />
          </div>
        </div>
      </div>
      {(data.min_val || data.max_val || data.avg_val) && (
        <div className="grid grid-cols-3 gap-2">
          {[
            { label: "Min", value: data.min_val },
            { label: "Max", value: data.max_val },
            { label: "Avg", value: data.avg_val },
          ].filter(x => x.value).map(({ label, value }) => (
            <div key={label} className="bg-muted/40 rounded-lg px-2.5 py-1.5">
              <p className="text-[10px] text-muted-foreground/60">{label}</p>
              <p className="text-[11px] font-mono text-foreground truncate" title={value ?? ""}>{value}</p>
            </div>
          ))}
        </div>
      )}
      {data.top_values.length > 0 && (
        <div>
          <p className="text-[10px] text-muted-foreground/60 mb-1.5">Most frequent</p>
          <div className="space-y-1">
            {data.top_values.map(({ value, count }) => {
              const pct = data.non_null > 0 ? Math.round((count / data.non_null) * 100) : 0;
              return (
                <div key={value} className="flex items-center gap-2">
                  <span className="text-[11px] font-mono text-foreground/80 truncate flex-1 max-w-[120px]" title={value}>
                    {value || <em className="text-muted-foreground/50">empty</em>}
                  </span>
                  <div className="flex-1 h-1 bg-muted/50 rounded-full overflow-hidden">
                    <div className="h-full bg-primary/30 rounded-full" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="text-[10px] text-muted-foreground/50 w-8 text-right shrink-0">{count}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── ColRow ────────────────────────────────────────────────────────────────

function ColRow({ col, idx, schema, table }: { col: ColumnInfo; idx: number; schema: string; table: string }) {
  const { label, cls } = typeShort(col.data_type);
  const [profiling, setProfiling] = useState(false);
  const [profileData, setProfileData] = useState<ProfileResult | null>(null);

  const handleProfile = useCallback(async () => {
    if (profileData) { setProfileData(null); return; }
    setProfiling(true);
    try {
      const q = `
        SELECT
          COUNT(*)::bigint AS total,
          COUNT("${col.name}")::bigint AS non_null,
          (COUNT(*) - COUNT("${col.name}"))::bigint AS null_count,
          ROUND(100.0 * (COUNT(*) - COUNT("${col.name}")) / NULLIF(COUNT(*),0), 1) AS null_pct,
          COUNT(DISTINCT "${col.name}")::bigint AS distinct_count,
          ROUND(100.0 * COUNT(DISTINCT "${col.name}") / NULLIF(COUNT(*),0), 1) AS distinct_pct,
          MIN("${col.name}"::text) AS min_val,
          MAX("${col.name}"::text) AS max_val,
          AVG(CASE WHEN pg_typeof("${col.name}") IN ('integer','bigint','smallint','numeric','real','double precision')
                   THEN "${col.name}"::numeric ELSE NULL END)::numeric(18,2)::text AS avg_val
        FROM "${schema}"."${table}"
      `;
      const topQ = `
        SELECT "${col.name}"::text AS value, COUNT(*)::bigint AS cnt
        FROM "${schema}"."${table}"
        WHERE "${col.name}" IS NOT NULL
        GROUP BY "${col.name}"
        ORDER BY cnt DESC
        LIMIT 5
      `;
      const [statsRes, topRes] = await Promise.all([executeQuery(q), executeQuery(topQ)]);
      const r = statsRes.rows[0] as string[];
      const top = topRes.rows.map(row => ({
        value: String((row as string[])[0] ?? ""),
        count: Number((row as string[])[1]),
      }));
      setProfileData({
        total: Number(r[0]), non_null: Number(r[1]), null_count: Number(r[2]),
        null_pct: Number(r[3]), distinct_count: Number(r[4]), distinct_pct: Number(r[5]),
        min_val: r[6] ?? null, max_val: r[7] ?? null, avg_val: r[8] ?? null, top_values: top,
      });
    } catch { /* silently ignore */ }
    finally { setProfiling(false); }
  }, [col.name, schema, table, profileData]);

  return (
    <>
      <tr className="border-b border-border/40 hover:bg-accent/20 group">
        <td className="px-3 py-2 text-[11px] text-muted-foreground/50 font-mono text-right w-8 select-none">{idx + 1}</td>
        <td className="px-3 py-2 text-xs font-mono text-foreground">
          <div className="flex items-center gap-1.5">
            {col.is_primary_key && <Key className="h-3 w-3 text-yellow-400 shrink-0" />}
            <span className={col.is_primary_key ? "text-yellow-300/90" : ""}>{col.name}</span>
          </div>
        </td>
        <td className="px-3 py-2 text-[11px]"><span className={`font-mono ${cls}`}>{label}</span></td>
        <td className="px-3 py-2 text-xs text-center">
          {col.is_nullable
            ? <span className="text-muted-foreground/50">✓</span>
            : <span className="text-red-400/70 font-bold">✕</span>}
        </td>
        <td className="px-3 py-2 text-[11px] font-mono text-muted-foreground/60 max-w-[140px] truncate">
          {col.column_default ?? <span className="italic text-muted-foreground/30">—</span>}
        </td>
        <td className="px-3 py-2 w-8">
          <button
            onClick={handleProfile}
            className={`opacity-0 group-hover:opacity-100 p-1 rounded transition-colors ${
              profileData ? "text-primary bg-primary/10 opacity-100" : "text-muted-foreground hover:text-foreground hover:bg-accent"
            }`}
            title="Profile column"
          >
            {profiling ? <Loader2 className="h-3 w-3 animate-spin" /> : <BarChart2 className="h-3 w-3" />}
          </button>
        </td>
      </tr>
      {profileData && (
        <tr>
          <td colSpan={6} className="p-0">
            <ProfilePanel colName={col.name} data={profileData} onClose={() => setProfileData(null)} />
          </td>
        </tr>
      )}
    </>
  );
}

// ── Indexes tab ───────────────────────────────────────────────────────────

interface IndexRow { name: string; definition: string; unique: boolean; primary: boolean }

function IndexesTab({ schema, table }: { schema: string; table: string }) {
  const [rows, setRows] = useState<IndexRow[] | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setRows(null);
    setLoading(true);
    executeQuery(`
      SELECT i.relname AS name, pg_get_indexdef(ix.indexrelid) AS definition,
             ix.indisunique AS is_unique, ix.indisprimary AS is_primary
      FROM pg_index ix
      JOIN pg_class i ON i.oid = ix.indexrelid
      JOIN pg_class t ON t.oid = ix.indrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE n.nspname = '${schema}' AND t.relname = '${table}'
      ORDER BY i.relname
    `).then((res) => {
      if (res.error || !res.rows.length) { setRows([]); return; }
      setRows(res.rows.map((r) => ({
        name: String((r as string[])[0]),
        definition: String((r as string[])[1]),
        unique: (r as string[])[2] === "true",
        primary: (r as string[])[3] === "true",
      })));
    }).catch(() => setRows([])).finally(() => setLoading(false));
  }, [schema, table]);

  if (loading) return <LoadingState />;
  if (!rows || rows.length === 0) return <EmptyState label="No indexes found" />;

  return (
    <div className="flex-1 overflow-auto">
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr className="sticky top-0 bg-card z-10 border-b border-border">
            <th className="px-3 py-2 text-left text-muted-foreground font-medium">Name</th>
            <th className="px-3 py-2 text-left text-muted-foreground font-medium w-16">Type</th>
            <th className="px-3 py-2 text-left text-muted-foreground font-medium">Definition</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((idx) => (
            <tr key={idx.name} className="border-b border-border/40 hover:bg-accent/20">
              <td className="px-3 py-2 font-mono text-foreground/90">{idx.name}</td>
              <td className="px-3 py-2">
                {idx.primary
                  ? <span className="text-[10px] font-medium text-yellow-400 bg-yellow-400/10 px-1.5 py-0.5 rounded">PK</span>
                  : idx.unique
                  ? <span className="text-[10px] font-medium text-sky-400 bg-sky-400/10 px-1.5 py-0.5 rounded">UQ</span>
                  : <span className="text-[10px] text-muted-foreground/60">IDX</span>}
              </td>
              <td className="px-3 py-2 font-mono text-muted-foreground/70 text-[11px] max-w-[300px] truncate" title={idx.definition}>
                {idx.definition}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Foreign Keys tab ──────────────────────────────────────────────────────

interface FkRow { column: string; foreignSchema: string; foreignTable: string; foreignColumn: string; onDelete: string }

function ForeignKeysTab({ schema, table }: { schema: string; table: string }) {
  const [rows, setRows] = useState<FkRow[] | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setRows(null);
    setLoading(true);
    executeQuery(`
      SELECT kcu.column_name, ccu.table_schema, ccu.table_name, ccu.column_name AS fk_col,
             rc.delete_rule
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
      JOIN information_schema.constraint_column_usage ccu
        ON ccu.constraint_name = tc.constraint_name
      JOIN information_schema.referential_constraints rc
        ON tc.constraint_name = rc.constraint_name
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_schema = '${schema}'
        AND tc.table_name = '${table}'
      ORDER BY kcu.column_name
    `).then((res) => {
      if (res.error || !res.rows.length) { setRows([]); return; }
      setRows(res.rows.map((r) => ({
        column: String((r as string[])[0]),
        foreignSchema: String((r as string[])[1]),
        foreignTable: String((r as string[])[2]),
        foreignColumn: String((r as string[])[3]),
        onDelete: String((r as string[])[4]),
      })));
    }).catch(() => setRows([])).finally(() => setLoading(false));
  }, [schema, table]);

  if (loading) return <LoadingState />;
  if (!rows || rows.length === 0) return <EmptyState label="No foreign keys found" />;

  return (
    <div className="flex-1 overflow-auto">
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr className="sticky top-0 bg-card z-10 border-b border-border">
            <th className="px-3 py-2 text-left text-muted-foreground font-medium">Column</th>
            <th className="px-3 py-2 text-left text-muted-foreground font-medium">References</th>
            <th className="px-3 py-2 text-left text-muted-foreground font-medium w-20">On Delete</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((fk, i) => (
            <tr key={i} className="border-b border-border/40 hover:bg-accent/20">
              <td className="px-3 py-2 font-mono text-foreground/90">{fk.column}</td>
              <td className="px-3 py-2 font-mono text-sky-400/80">
                {fk.foreignSchema}.{fk.foreignTable}
                <span className="text-muted-foreground/50">.</span>
                {fk.foreignColumn}
              </td>
              <td className="px-3 py-2 text-[11px] text-muted-foreground/60">{fk.onDelete}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Triggers tab ──────────────────────────────────────────────────────────

interface TriggerRow { name: string; event: string; timing: string; statement: string }

function TriggersTab({ schema, table }: { schema: string; table: string }) {
  const [rows, setRows] = useState<TriggerRow[] | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setRows(null);
    setLoading(true);
    executeQuery(`
      SELECT trigger_name, string_agg(event_manipulation, ' OR ' ORDER BY event_manipulation),
             action_timing, action_statement
      FROM information_schema.triggers
      WHERE event_object_schema = '${schema}'
        AND event_object_table = '${table}'
      GROUP BY trigger_name, action_timing, action_statement
      ORDER BY trigger_name
    `).then((res) => {
      if (res.error || !res.rows.length) { setRows([]); return; }
      setRows(res.rows.map((r) => ({
        name: String((r as string[])[0]),
        event: String((r as string[])[1]),
        timing: String((r as string[])[2]),
        statement: String((r as string[])[3]),
      })));
    }).catch(() => setRows([])).finally(() => setLoading(false));
  }, [schema, table]);

  if (loading) return <LoadingState />;
  if (!rows || rows.length === 0) return <EmptyState label="No triggers found" />;

  return (
    <div className="flex-1 overflow-auto">
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr className="sticky top-0 bg-card z-10 border-b border-border">
            <th className="px-3 py-2 text-left text-muted-foreground font-medium">Name</th>
            <th className="px-3 py-2 text-left text-muted-foreground font-medium">Event</th>
            <th className="px-3 py-2 text-left text-muted-foreground font-medium">Statement</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((tr) => (
            <tr key={tr.name} className="border-b border-border/40 hover:bg-accent/20">
              <td className="px-3 py-2 font-mono text-foreground/90">{tr.name}</td>
              <td className="px-3 py-2 text-[11px]">
                <span className="text-violet-400/80">{tr.timing}</span>{" "}
                <span className="text-muted-foreground/60">{tr.event}</span>
              </td>
              <td className="px-3 py-2 font-mono text-muted-foreground/60 text-[11px] max-w-[240px] truncate" title={tr.statement}>
                {tr.statement}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Shared states ─────────────────────────────────────────────────────────

function LoadingState() {
  return (
    <div className="flex-1 flex items-center justify-center gap-2 text-xs text-muted-foreground">
      <Loader2 className="h-3.5 w-3.5 animate-spin" />
      Loading…
    </div>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="flex-1 flex items-center justify-center text-xs text-muted-foreground/50">
      {label}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────

type Tab = "columns" | "indexes" | "fk" | "triggers";

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: "columns",  label: "Columns",  icon: <List className="h-3 w-3" /> },
  { id: "indexes",  label: "Indexes",  icon: <Hash className="h-3 w-3" /> },
  { id: "fk",       label: "FK",       icon: <Link className="h-3 w-3" /> },
  { id: "triggers", label: "Triggers", icon: <Zap className="h-3 w-3" /> },
];

export function StructurePanel() {
  const { selectedTable } = useAppStore();
  const [activeTab, setActiveTab] = useState<Tab>("columns");

  if (!selectedTable) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center px-6">
        <Table2 className="h-7 w-7 text-muted-foreground/25" />
        <p className="text-xs text-muted-foreground">Select a table to view its structure</p>
      </div>
    );
  }

  const pkCols = selectedTable.columns.filter((c) => c.is_primary_key);
  const rowEst = selectedTable.row_count_estimate;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Table meta header */}
      <div className="flex items-center gap-3 px-4 h-9 border-b border-border shrink-0 bg-muted/20">
        <div className="flex items-center gap-2 min-w-0">
          <Table2 className="h-3.5 w-3.5 text-primary shrink-0" />
          <span className="text-xs font-semibold text-foreground truncate">
            {selectedTable.schema}.{selectedTable.name}
          </span>
        </div>
        <div className="ml-auto flex items-center gap-3 text-[11px] text-muted-foreground shrink-0">
          {pkCols.length > 0 && (
            <span className="flex items-center gap-1">
              <Key className="h-2.5 w-2.5 text-yellow-400" />
              {pkCols.map((c) => c.name).join(", ")}
            </span>
          )}
          {rowEst !== null && rowEst > 0 && (
            <span className="flex items-center gap-1">
              <Hash className="h-2.5 w-2.5" />
              ~{rowEst.toLocaleString()} rows
            </span>
          )}
          <span className="flex items-center gap-1">
            <Type className="h-2.5 w-2.5" />
            {selectedTable.columns.length} cols
          </span>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex border-b border-border shrink-0 bg-muted/10">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium border-b-2 transition-colors ${
              activeTab === tab.id
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {activeTab === "columns" && (
          <div className="flex-1 overflow-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="sticky top-0 bg-card z-10 border-b border-border">
                  <th className="px-3 py-2 text-right text-muted-foreground/50 font-medium w-8">#</th>
                  <th className="px-3 py-2 text-left text-muted-foreground font-medium">Column</th>
                  <th className="px-3 py-2 text-left text-muted-foreground font-medium">Type</th>
                  <th className="px-3 py-2 text-center text-muted-foreground font-medium w-14">Null</th>
                  <th className="px-3 py-2 text-left text-muted-foreground font-medium">Default</th>
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody>
                {selectedTable.columns.map((col, i) => (
                  <ColRow
                    key={col.name}
                    col={col}
                    idx={i}
                    schema={selectedTable.schema}
                    table={selectedTable.name}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
        {activeTab === "indexes" && (
          <IndexesTab schema={selectedTable.schema} table={selectedTable.name} />
        )}
        {activeTab === "fk" && (
          <ForeignKeysTab schema={selectedTable.schema} table={selectedTable.name} />
        )}
        {activeTab === "triggers" && (
          <TriggersTab schema={selectedTable.schema} table={selectedTable.name} />
        )}
      </div>
    </div>
  );
}
