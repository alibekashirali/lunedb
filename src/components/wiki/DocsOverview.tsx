import { useState, useEffect, useCallback, useRef } from "react";
import { useAppStore } from "@/store/useAppStore";
import { getTableDdl } from "@/lib/tauri-commands";
import { getDocsPage, saveDocsPage, getAllDocsKeys } from "@/lib/wiki-db";
import { streamDocumentation } from "@/lib/ollama";
import { MarkdownRenderer } from "./MarkdownRenderer";
import { MarkdownToolbar } from "./MarkdownToolbar";
import {
  Table,
  ChevronRight,
  ChevronDown,
  Sparkles,
  Edit3,
  Save,
  X,
  RefreshCw,
  Loader2,
  CheckCircle2,
  Circle,
  Key,
  Hash,
  FileText,
} from "lucide-react";
import { cn } from "@/lib/utils";

export function DocsOverview() {
  const { schema, ollamaModel } = useAppStore();

  const [documentedKeys, setDocumentedKeys] = useState<Set<string>>(new Set());
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());
  const [docsMap, setDocsMap] = useState<Record<string, string>>({});
  const [generatingSet, setGeneratingSet] = useState<Set<string>>(new Set());
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editBuffer, setEditBuffer] = useState("");
  const [isGeneratingAll, setIsGeneratingAll] = useState(false);
  const cancelRef = useRef(false);
  const editTextareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    getAllDocsKeys().then((keys) => setDocumentedKeys(new Set(keys)));
  }, []);

  const toggleExpand = useCallback(
    async (key: string) => {
      if (expandedKeys.has(key)) {
        setExpandedKeys((prev) => {
          const n = new Set(prev);
          n.delete(key);
          return n;
        });
        return;
      }
      setExpandedKeys((prev) => new Set(prev).add(key));
      if (docsMap[key] === undefined) {
        const saved = await getDocsPage(key);
        setDocsMap((prev) => ({ ...prev, [key]: saved ?? "" }));
      }
    },
    [expandedKeys, docsMap]
  );

  const generateForTable = useCallback(
    async (key: string, tableSchema: string, tableName: string) => {
      setGeneratingSet((prev) => new Set(prev).add(key));
      setDocsMap((prev) => ({ ...prev, [key]: "" }));
      setExpandedKeys((prev) => new Set(prev).add(key));
      try {
        const ddl = await getTableDdl(tableSchema, tableName);
        let accumulated = "";
        for await (const chunk of streamDocumentation(tableName, ddl, ollamaModel)) {
          accumulated += chunk;
          setDocsMap((prev) => ({ ...prev, [key]: accumulated }));
        }
        await saveDocsPage(key, accumulated);
        setDocumentedKeys((prev) => new Set(prev).add(key));
      } catch (err) {
        setDocsMap((prev) => ({ ...prev, [key]: `*Error: ${String(err)}*` }));
      } finally {
        setGeneratingSet((prev) => {
          const n = new Set(prev);
          n.delete(key);
          return n;
        });
      }
    },
    [ollamaModel]
  );

  const handleGenerateAll = useCallback(async () => {
    setIsGeneratingAll(true);
    cancelRef.current = false;
    for (const table of schema) {
      if (cancelRef.current) break;
      const key = `${table.schema}.${table.name}`;
      if (!documentedKeys.has(key)) {
        await generateForTable(key, table.schema, table.name);
      }
    }
    setIsGeneratingAll(false);
  }, [schema, documentedKeys, generateForTable]);

  const handleStartEdit = (key: string) => {
    setEditingKey(key);
    setEditBuffer(docsMap[key] ?? "");
  };

  const handleSaveEdit = async (key: string) => {
    await saveDocsPage(key, editBuffer);
    setDocsMap((prev) => ({ ...prev, [key]: editBuffer }));
    if (editBuffer.trim()) {
      setDocumentedKeys((prev) => new Set(prev).add(key));
    } else {
      setDocumentedKeys((prev) => {
        const n = new Set(prev);
        n.delete(key);
        return n;
      });
    }
    setEditingKey(null);
  };

  const undocumentedCount = schema.filter(
    (t) => !documentedKeys.has(`${t.schema}.${t.name}`)
  ).length;

  // Group by schema
  const bySchema = schema.reduce<Record<string, typeof schema>>((acc, t) => {
    (acc[t.schema] ??= []).push(t);
    return acc;
  }, {});

  if (schema.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center px-6">
        <FileText className="h-8 w-8 text-muted-foreground/30" />
        <p className="text-xs text-muted-foreground">
          Connect to a database to view documentation
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-border shrink-0">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Documentation</h2>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            {schema.length} tables · {documentedKeys.size} documented
            {undocumentedCount > 0 && ` · ${undocumentedCount} without docs`}
          </p>
        </div>
        <button
          onClick={
            isGeneratingAll
              ? () => {
                  cancelRef.current = true;
                  setIsGeneratingAll(false);
                }
              : handleGenerateAll
          }
          disabled={!isGeneratingAll && undocumentedCount === 0}
          className={cn(
            "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors",
            isGeneratingAll
              ? "bg-destructive/10 text-destructive hover:bg-destructive/20"
              : "bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-40 disabled:cursor-not-allowed"
          )}
        >
          {isGeneratingAll ? (
            <>
              <Loader2 className="h-3 w-3 animate-spin" />
              Cancel
            </>
          ) : (
            <>
              <Sparkles className="h-3 w-3" />
              Generate All ({undocumentedCount})
            </>
          )}
        </button>
      </div>

      {/* Table list */}
      <div className="flex-1 overflow-y-auto">
        {Object.entries(bySchema).map(([schemaName, tables]) => (
          <div key={schemaName}>
            <div className="sticky top-0 z-10 px-5 py-1.5 bg-sidebar border-b border-border/50 backdrop-blur-sm">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">
                {schemaName}
              </span>
            </div>

            {tables.map((table) => {
              const key = `${table.schema}.${table.name}`;
              const isExpanded = expandedKeys.has(key);
              const isDocumented = documentedKeys.has(key);
              const isGenerating = generatingSet.has(key);
              const docs = docsMap[key];
              const isEditing = editingKey === key;

              return (
                <div key={key} className="border-b border-border/40 last:border-0">
                  {/* Row header */}
                  <button
                    onClick={() => toggleExpand(key)}
                    className="w-full flex items-center gap-2.5 px-5 py-2.5 hover:bg-accent/40 transition-colors text-left"
                  >
                    {isExpanded ? (
                      <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    ) : (
                      <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    )}
                    <Table className="h-3.5 w-3.5 text-primary/60 shrink-0" />
                    <span className="text-sm font-medium text-foreground truncate">
                      {table.name}
                    </span>
                    {table.row_count_estimate != null &&
                      table.row_count_estimate > 0 && (
                        <span className="text-[10px] text-muted-foreground/40 shrink-0">
                          ~
                          {table.row_count_estimate >= 1000
                            ? `${Math.round(table.row_count_estimate / 1000)}k`
                            : table.row_count_estimate}
                        </span>
                      )}
                    <span className="ml-auto shrink-0">
                      {isGenerating ? (
                        <span className="flex items-center gap-1 text-[10px] text-primary/70">
                          <Loader2 className="h-2.5 w-2.5 animate-spin" />
                          generating…
                        </span>
                      ) : isDocumented ? (
                        <span className="flex items-center gap-1 text-[10px] text-emerald-500/70">
                          <CheckCircle2 className="h-2.5 w-2.5" />
                          documented
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-[10px] text-muted-foreground/35">
                          <Circle className="h-2.5 w-2.5" />
                          no docs
                        </span>
                      )}
                    </span>
                  </button>

                  {/* Expanded body */}
                  {isExpanded && (
                    <div className="px-11 pb-5 pt-1">
                      {/* Columns chips */}
                      <div className="flex flex-wrap gap-1.5 mb-4">
                        {table.columns.map((col) => (
                          <span
                            key={col.name}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-muted/50 border border-border/50 text-[11px] font-mono"
                          >
                            {col.is_primary_key ? (
                              <Key className="h-2.5 w-2.5 text-yellow-500/70 shrink-0" />
                            ) : (
                              <Hash className="h-2.5 w-2.5 text-muted-foreground/40 shrink-0" />
                            )}
                            <span className="text-foreground/80">{col.name}</span>
                            <span className="text-muted-foreground/40">{col.data_type}</span>
                          </span>
                        ))}
                      </div>

                      {/* Docs area */}
                      {isEditing ? (
                        <div className="rounded-xl border border-border overflow-hidden">
                          <MarkdownToolbar
                            textareaRef={editTextareaRef}
                            value={editBuffer}
                            onChange={setEditBuffer}
                          />
                          <textarea
                            ref={editTextareaRef}
                            value={editBuffer}
                            onChange={(e) => setEditBuffer(e.target.value)}
                            className="w-full resize-none bg-background text-foreground text-xs font-mono p-4 outline-none border-0 min-h-[200px] leading-relaxed"
                            placeholder="Write markdown documentation…"
                            autoFocus
                          />
                          <div className="flex justify-end gap-1.5 px-3 py-2 border-t border-border bg-muted/20">
                            <button
                              onClick={() => setEditingKey(null)}
                              className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                            >
                              <X className="h-3 w-3" />
                              Cancel
                            </button>
                            <button
                              onClick={() => handleSaveEdit(key)}
                              className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                            >
                              <Save className="h-3 w-3" />
                              Save
                            </button>
                          </div>
                        </div>
                      ) : isGenerating && !docs ? (
                        <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
                          <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                          Generating documentation…
                        </div>
                      ) : docs ? (
                        <div>
                          <MarkdownRenderer content={docs} />
                          <div className="flex items-center gap-1 mt-3 pt-3 border-t border-border/30">
                            <button
                              onClick={() => handleStartEdit(key)}
                              className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground px-2 py-1 rounded hover:bg-accent transition-colors"
                            >
                              <Edit3 className="h-3 w-3" />
                              Edit
                            </button>
                            <button
                              onClick={() =>
                                generateForTable(key, table.schema, table.name)
                              }
                              className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground px-2 py-1 rounded hover:bg-accent transition-colors"
                            >
                              <RefreshCw className="h-3 w-3" />
                              Regenerate
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center justify-between py-3 px-4 rounded-xl border border-dashed border-border/60">
                          <p className="text-xs text-muted-foreground">
                            No documentation yet
                          </p>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              generateForTable(key, table.schema, table.name);
                            }}
                            className="flex items-center gap-1.5 text-xs text-primary px-2.5 py-1 rounded-lg bg-primary/10 hover:bg-primary/20 transition-colors"
                          >
                            <Sparkles className="h-3 w-3" />
                            Generate
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
