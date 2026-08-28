import { useState, useCallback } from "react";
import { useAppStore } from "@/store/useAppStore";
import { getTableDdl } from "@/lib/tauri-commands";
import { saveDocsPage } from "@/lib/wiki-db";
import { streamDocumentation } from "@/lib/ollama";
import { MarkdownRenderer } from "./MarkdownRenderer";
import { Sparkles, Edit3, Save, X, RefreshCw, FileText, Loader2, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export function DocsPanel() {
  const {
    selectedTable,
    docsContent,
    setDocsContent,
    isGeneratingDocs,
    setGeneratingDocs,
    isEditingDocs,
    setEditingDocs,
    ollamaModel,
    setOllamaModel,
  } = useAppStore();

  const [editBuffer, setEditBuffer] = useState("");
  const [genError, setGenError] = useState<string | null>(null);
  const [showModelInput, setShowModelInput] = useState(false);

  const handleGenerateDocs = useCallback(async () => {
    if (!selectedTable) return;
    setGenError(null);
    setGeneratingDocs(true);
    setDocsContent("");

    try {
      const ddl = await getTableDdl(selectedTable.schema, selectedTable.name);
      let accumulated = "";

      for await (const chunk of streamDocumentation(selectedTable.name, ddl, ollamaModel)) {
        accumulated += chunk;
        setDocsContent(accumulated);
      }

      const tableKey = `${selectedTable.schema}.${selectedTable.name}`;
      await saveDocsPage(tableKey, accumulated);
    } catch (err) {
      setGenError(
        String(err).includes("fetch")
          ? "Could not reach Ollama. Make sure it's running on http://localhost:11434"
          : String(err)
      );
    } finally {
      setGeneratingDocs(false);
    }
  }, [selectedTable, setGeneratingDocs, setDocsContent, ollamaModel]);

  const handleStartEdit = () => {
    setEditBuffer(docsContent);
    setEditingDocs(true);
  };

  const handleSaveEdit = async () => {
    if (!selectedTable) return;
    const tableKey = `${selectedTable.schema}.${selectedTable.name}`;
    await saveDocsPage(tableKey, editBuffer);
    setDocsContent(editBuffer);
    setEditingDocs(false);
  };

  const handleCancelEdit = () => {
    setEditingDocs(false);
    setEditBuffer("");
  };

  // ── No table selected ──────────────────────────────────────────────
  if (!selectedTable) {
    return (
      <div className="flex-1 flex flex-col min-h-0">
        <DocsHeader
          label="AI Docs"
          model={ollamaModel}
          setModel={setOllamaModel}
          showModelInput={showModelInput}
          setShowModelInput={setShowModelInput}
        />
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center px-6">
          <FileText className="h-8 w-8 text-muted-foreground/30" />
          <p className="text-xs text-muted-foreground">
            Select a table to view or generate documentation
          </p>
        </div>
      </div>
    );
  }

  const tableKey = `${selectedTable.schema}.${selectedTable.name}`;

  // ── Editing mode ───────────────────────────────────────────────────
  if (isEditingDocs) {
    return (
      <div className="flex-1 flex flex-col min-h-0">
        <div className="flex items-center justify-between px-3 h-9 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <Edit3 className="h-3.5 w-3.5 text-primary" />
            <span className="text-xs font-medium">{tableKey}</span>
          </div>
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-2 text-xs"
              onClick={handleCancelEdit}
            >
              <X className="h-3 w-3 mr-1" />
              Cancel
            </Button>
            <Button
              size="sm"
              className="h-6 px-2 text-xs"
              onClick={handleSaveEdit}
            >
              <Save className="h-3 w-3 mr-1" />
              Save
            </Button>
          </div>
        </div>
        <textarea
          value={editBuffer}
          onChange={(e) => setEditBuffer(e.target.value)}
          className="flex-1 resize-none bg-background text-foreground text-xs font-mono p-4 outline-none border-0 leading-relaxed"
          placeholder="Write markdown documentation for this table…"
          autoFocus
        />
      </div>
    );
  }

  // ── Main view ──────────────────────────────────────────────────────
  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Header */}
      <DocsHeader
        label={tableKey}
        model={ollamaModel}
        setModel={setOllamaModel}
        showModelInput={showModelInput}
        setShowModelInput={setShowModelInput}
      >
        {docsContent && !isGeneratingDocs && (
          <>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-2 text-xs text-muted-foreground"
              onClick={handleStartEdit}
              title="Edit documentation"
            >
              <Edit3 className="h-3 w-3" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-2 text-xs text-muted-foreground"
              onClick={handleGenerateDocs}
              title="Regenerate docs"
            >
              <RefreshCw className="h-3 w-3" />
            </Button>
          </>
        )}
      </DocsHeader>

      {/* Content area */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {isGeneratingDocs && !docsContent && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
            Generating documentation…
          </div>
        )}

        {(docsContent || isGeneratingDocs) ? (
          <MarkdownRenderer content={docsContent} />
        ) : (
          /* Empty state — no content yet */
          <div className="flex flex-col items-center justify-center h-full gap-4 text-center -mt-4">
            <div className="p-3 rounded-xl bg-primary/10">
              <Sparkles className="h-6 w-6 text-primary" />
            </div>
            <div>
              <p className="text-sm font-medium text-foreground mb-1">
                No documentation yet
              </p>
              <p className="text-xs text-muted-foreground">
                Generate AI docs for{" "}
                <span className="font-mono text-primary">{selectedTable.name}</span>{" "}
                using your local Ollama model
              </p>
            </div>
            <Button
              onClick={handleGenerateDocs}
              size="sm"
              className="gap-1.5"
              disabled={isGeneratingDocs}
            >
              <Sparkles className="h-3.5 w-3.5" />
              Generate Docs
            </Button>
            {genError && (
              <p className="text-xs text-destructive max-w-[240px] text-center">
                {genError}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

const OLLAMA_MODELS = [
  "qwen2.5:7b", "qwen2.5:14b", "qwen2.5-coder:7b",
  "llama3.1:8b", "llama3.2:3b", "mistral:7b",
  "deepseek-coder:6.7b", "codellama:7b",
];

function DocsHeader({
  label,
  model,
  setModel,
  showModelInput,
  setShowModelInput,
  children,
}: {
  label: string;
  model: string;
  setModel: (m: string) => void;
  showModelInput: boolean;
  setShowModelInput: (v: boolean) => void;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col border-b border-border shrink-0">
      <div className="flex items-center justify-between px-3 h-9">
        <div className="flex items-center gap-2 min-w-0">
          <Sparkles className="h-3.5 w-3.5 text-primary shrink-0" />
          <span className="text-xs font-medium truncate">{label}</span>
        </div>
        <div className="flex items-center gap-1 shrink-0 ml-2">
          {children}
          <button
            onClick={() => setShowModelInput(!showModelInput)}
            className={`p-1.5 rounded hover:bg-accent transition-colors ${
              showModelInput ? "text-primary" : "text-muted-foreground hover:text-foreground"
            }`}
            title="Change Ollama model"
          >
            <Settings2 className="h-3 w-3" />
          </button>
        </div>
      </div>

      {showModelInput && (
        <div className="px-3 pb-2 flex items-center gap-2">
          <span className="text-[10px] text-muted-foreground/60 shrink-0">Model:</span>
          <input
            list="docs-ollama-models"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="qwen2.5:7b"
            className="flex-1 min-w-0 bg-muted/40 border border-border rounded px-2 py-0.5 text-[11px] font-mono text-foreground placeholder:text-muted-foreground/40 outline-none focus:border-primary/40"
          />
          <datalist id="docs-ollama-models">
            {OLLAMA_MODELS.map((m) => <option key={m} value={m} />)}
          </datalist>
        </div>
      )}
    </div>
  );
}
