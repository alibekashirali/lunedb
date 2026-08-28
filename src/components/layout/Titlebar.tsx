import { getCurrentWindow } from "@tauri-apps/api/window";
import { useAppStore } from "@/store/useAppStore";
import { Terminal, BookOpen, Sun, Moon, GitFork } from "lucide-react";
import { cn } from "@/lib/utils";

export function Titlebar() {
  const { appMode, setAppMode, theme, toggleTheme } = useAppStore();

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest("button")) return;
    getCurrentWindow().startDragging();
  };

  return (
    <div
      onMouseDown={handleMouseDown}
      data-tauri-drag-region
      className="h-9 shrink-0 bg-background border-b border-border flex items-center px-3 select-none"
    >
      {/* Spacer for macOS traffic lights (~70px) */}
      <div className="w-20 shrink-0" data-tauri-drag-region />

      {/* Mode switcher — centered */}
      <div className="flex-1 flex justify-center" data-tauri-drag-region>
        <div className="flex items-center gap-0.5 rounded-lg bg-muted/50 border border-border/50 p-0.5">
          <ModeBtn
            active={appMode === "query"}
            onClick={() => setAppMode("query")}
            icon={<Terminal className="h-3 w-3" />}
            label="Query"
          />
          <ModeBtn
            active={appMode === "docs"}
            onClick={() => setAppMode("docs")}
            icon={<BookOpen className="h-3 w-3" />}
            label="Docs"
          />
          <ModeBtn
            active={appMode === "er"}
            onClick={() => setAppMode("er")}
            icon={<GitFork className="h-3 w-3" />}
            label="ER"
          />
        </div>
      </div>

      {/* Theme toggle */}
      <div className="w-24 flex justify-end shrink-0">
        <button
          onClick={toggleTheme}
          className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          title={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
        >
          {theme === "dark"
            ? <Sun className="h-3.5 w-3.5" />
            : <Moon className="h-3.5 w-3.5" />}
        </button>
      </div>
    </div>
  );
}

function ModeBtn({
  active, onClick, icon, label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-all duration-150",
        active
          ? "bg-background text-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground"
      )}
    >
      {icon}
      {label}
    </button>
  );
}
