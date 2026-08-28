import { useState } from "react";
import { ConnectionDialog } from "@/components/db/ConnectionDialog";
import { useAppStore } from "@/store/useAppStore";
import { getSavedConnections } from "@/lib/wiki-db";
import { getSchema, getViews, getMatViews, getSequences, getFunctions } from "@/lib/tauri-commands";
import { Database, Zap, BookOpen, GitFork, Terminal } from "lucide-react";

const FEATURES = [
  {
    icon: Terminal,
    title: "SQL Editor",
    desc: "Cursor-aware execution, multi-statement, history, autocomplete",
  },
  {
    icon: BookOpen,
    title: "AI Docs",
    desc: "Auto-generate wiki for every table using a local Ollama model",
  },
  {
    icon: GitFork,
    title: "ER Diagram",
    desc: "Visual map of your schema with FK relationships",
  },
  {
    icon: Zap,
    title: "EXPLAIN Visualizer",
    desc: "Query plan tree with timing bars and cost breakdown",
  },
];

interface Props {
  onConnected: () => void;
}

export function OnboardingScreen({ onConnected }: Props) {
  const [open, setOpen] = useState(false);
  const { setSavedConnections, setSchema, setViews, setMatViews, setSequences, setFunctions } = useAppStore();

  const handleConnected = async () => {
    setOpen(false);
    const [conns, tables, views, matViews, seqs, fns] = await Promise.all([
      getSavedConnections(),
      getSchema(),
      getViews(),
      getMatViews(),
      getSequences(),
      getFunctions(),
    ]);
    setSavedConnections(conns);
    setSchema(tables);
    setViews(views);
    setMatViews(matViews);
    setSequences(seqs);
    setFunctions(fns);
    onConnected();
  };

  return (
    <div className="flex-1 flex flex-col items-center justify-center bg-background px-6 select-none">
      {/* Logo */}
      <div className="flex flex-col items-center gap-4 mb-10">
        <img src="/logo.svg" alt="LuneDB" className="h-10 w-auto" />
        <p className="text-sm text-muted-foreground max-w-xs text-center">
          A local-first PostgreSQL client with AI documentation and schema explorer.
        </p>
      </div>

      {/* CTA */}
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors shadow-lg shadow-primary/20 mb-12"
      >
        <Database className="h-4 w-4" />
        Connect to PostgreSQL
      </button>

      {/* Feature grid */}
      <div className="grid grid-cols-2 gap-3 max-w-md w-full">
        {FEATURES.map(({ icon: Icon, title, desc }) => (
          <div
            key={title}
            className="bg-card border border-border rounded-xl p-4 flex flex-col gap-2"
          >
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
                <Icon className="h-3.5 w-3.5 text-primary" />
              </div>
              <span className="text-xs font-semibold text-foreground">{title}</span>
            </div>
            <p className="text-[11px] text-muted-foreground leading-relaxed">{desc}</p>
          </div>
        ))}
      </div>

      <ConnectionDialog
        open={open}
        onOpenChange={setOpen}
        onConnected={handleConnected}
      />
    </div>
  );
}
