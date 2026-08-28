import { useState, useRef, useEffect, useCallback } from "react";
import { useAppStore } from "@/store/useAppStore";
import { streamOllama, buildChatPrompt } from "@/lib/ollama";
import { MarkdownRenderer } from "./MarkdownRenderer";
import { Send, Bot, User, Copy, Play, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface Message {
  role: "user" | "assistant";
  content: string;
}


export function AiChatPanel() {
  const { schema, ollamaModel, connectionStatus, setSqlText } = useAppStore();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = useCallback(async () => {
    const question = input.trim();
    if (!question || isStreaming) return;

    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: question }]);
    setIsStreaming(true);

    const schemaCtx = schema.map((t) => ({
      name: `${t.schema}.${t.name}`,
      columns: t.columns.map((c) => ({
        name: c.name,
        type: c.data_type,
        isPk: c.is_primary_key,
      })),
    }));

    const prompt = buildChatPrompt(question, schemaCtx);

    // Add empty assistant message to stream into
    setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

    try {
      let accumulated = "";
      for await (const token of streamOllama(prompt, ollamaModel)) {
        accumulated += token;
        setMessages((prev) => {
          const next = [...prev];
          next[next.length - 1] = { role: "assistant", content: accumulated };
          return next;
        });
      }
    } catch (err) {
      setMessages((prev) => {
        const next = [...prev];
        next[next.length - 1] = {
          role: "assistant",
          content: `Error: ${String(err)}`,
        };
        return next;
      });
    } finally {
      setIsStreaming(false);
    }
  }, [input, isStreaming, schema, ollamaModel]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleRunSql = (sql: string) => {
    setSqlText(sql);
  };

  const isConnected = connectionStatus === "connected";

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-4">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-center px-4">
            <div className="p-3 rounded-xl bg-primary/10">
              <Bot className="h-6 w-6 text-primary" />
            </div>
            <div>
              <p className="text-sm font-medium text-foreground mb-1">
                Ask about your data
              </p>
              <p className="text-xs text-muted-foreground">
                {isConnected
                  ? "Ask anything — I'll write SQL for you"
                  : "Connect to a database first"}
              </p>
            </div>
            {isConnected && (
              <div className="flex flex-col gap-1.5 w-full max-w-[220px]">
                {[
                  "Which tables have the most rows?",
                  "Show me the latest 5 records",
                  "What columns does users have?",
                ].map((q) => (
                  <button
                    key={q}
                    onClick={() => { setInput(q); textareaRef.current?.focus(); }}
                    className="text-left text-xs text-muted-foreground hover:text-foreground bg-muted/30 hover:bg-muted/60 rounded-lg px-3 py-1.5 transition-colors"
                  >
                    {q}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={cn("flex gap-2.5", msg.role === "user" && "flex-row-reverse")}>
            {/* Avatar */}
            <div
              className={cn(
                "w-6 h-6 rounded-full flex items-center justify-center shrink-0 mt-0.5",
                msg.role === "assistant"
                  ? "bg-primary/20 text-primary"
                  : "bg-muted text-muted-foreground"
              )}
            >
              {msg.role === "assistant" ? (
                <Bot className="h-3.5 w-3.5" />
              ) : (
                <User className="h-3.5 w-3.5" />
              )}
            </div>

            {/* Bubble */}
            <div
              className={cn(
                "flex-1 min-w-0 rounded-xl px-3 py-2 text-xs",
                msg.role === "assistant"
                  ? "bg-muted/40 text-foreground"
                  : "bg-primary/15 text-foreground"
              )}
            >
              {msg.role === "assistant" ? (
                <AssistantMessage
                  content={msg.content}
                  isStreaming={isStreaming && i === messages.length - 1}
                  onRunSql={handleRunSql}
                />
              ) : (
                <p className="whitespace-pre-wrap">{msg.content}</p>
              )}
            </div>
          </div>
        ))}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="border-t border-border px-3 py-2.5 shrink-0">
        <div className="flex gap-2 items-end">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={isConnected ? "Ask about your data…" : "Connect to a database first"}
            disabled={!isConnected || isStreaming}
            rows={1}
            className="flex-1 resize-none bg-muted/40 border border-border rounded-xl px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground/40 outline-none focus:border-primary/40 focus:ring-1 focus:ring-primary/10 transition-colors disabled:opacity-40 leading-relaxed"
            style={{ maxHeight: "96px", overflowY: "auto" }}
            onInput={(e) => {
              const t = e.currentTarget;
              t.style.height = "auto";
              t.style.height = `${Math.min(t.scrollHeight, 96)}px`;
            }}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || !isConnected || isStreaming}
            className="p-2 rounded-xl bg-primary text-primary-foreground disabled:opacity-40 disabled:cursor-not-allowed hover:bg-primary/90 transition-colors shrink-0"
          >
            {isStreaming ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Send className="h-3.5 w-3.5" />
            )}
          </button>
        </div>
        <p className="text-[10px] text-muted-foreground/40 mt-1.5 text-right">
          ⌘↵ to send
        </p>
      </div>
    </div>
  );
}

function AssistantMessage({
  content,
  isStreaming,
  onRunSql,
}: {
  content: string;
  isStreaming: boolean;
  onRunSql: (sql: string) => void;
}) {
  if (!content) {
    return (
      <div className="flex items-center gap-1.5 text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" />
        <span>Thinking…</span>
      </div>
    );
  }

  // Split content into text and sql blocks
  const parts = content.split(/(```sql[\s\S]*?```)/i);

  return (
    <div className="space-y-2">
      {parts.map((part, i) => {
        const sqlMatch = part.match(/```sql\s*([\s\S]*?)```/i);
        if (sqlMatch) {
          const sql = sqlMatch[1].trim();
          return (
            <div key={i} className="rounded-lg overflow-hidden border border-border/60">
              <div className="flex items-center justify-between px-2.5 py-1 bg-muted/60 border-b border-border/60">
                <span className="text-[10px] text-muted-foreground font-mono uppercase tracking-wider">
                  SQL
                </span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => navigator.clipboard.writeText(sql)}
                    className="p-0.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground"
                    title="Copy"
                  >
                    <Copy className="h-3 w-3" />
                  </button>
                  <button
                    onClick={() => onRunSql(sql)}
                    className="flex items-center gap-1 px-2 py-0.5 rounded bg-primary/20 hover:bg-primary/30 text-primary text-[10px] font-medium transition-colors"
                    title="Insert into editor"
                  >
                    <Play className="h-2.5 w-2.5" />
                    Run
                  </button>
                </div>
              </div>
              <pre className="px-2.5 py-2 text-[11px] font-mono text-foreground/90 overflow-x-auto whitespace-pre-wrap bg-background/40">
                {sql}
              </pre>
            </div>
          );
        }
        const trimmed = part.trim();
        if (!trimmed) return null;
        return (
          <MarkdownRenderer key={i} content={trimmed} />
        );
      })}
      {isStreaming && (
        <span className="inline-block w-1.5 h-3.5 bg-primary/70 animate-pulse rounded-sm" />
      )}
    </div>
  );
}
