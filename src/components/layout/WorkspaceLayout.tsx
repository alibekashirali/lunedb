import { useState, useEffect } from "react";
import { LeftPanel } from "./LeftPanel";
import { CenterPanel } from "./CenterPanel";
import { RightPanel } from "./RightPanel";
import { DocsOverview } from "@/components/wiki/DocsOverview";
import { CommandPalette } from "./CommandPalette";
import { ERDiagram } from "@/components/er/ERDiagram";
import { useAppStore } from "@/store/useAppStore";

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

function ResizeHandle({ onDrag }: { onDrag: (delta: number) => void }) {
  const start = (e: React.MouseEvent) => {
    e.preventDefault();
    let last = e.clientX;
    const move = (e: MouseEvent) => { onDrag(e.clientX - last); last = e.clientX; };
    const up = () => {
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", up);
      document.body.style.cursor = "";
    };
    document.body.style.cursor = "col-resize";
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
  };

  return (
    <div onMouseDown={start} className="w-[5px] shrink-0 cursor-col-resize group relative z-10">
      <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-px bg-border group-hover:bg-primary/50 group-active:bg-primary transition-colors" />
    </div>
  );
}

function useGlobalShortcuts(rightOpen: boolean, setRightOpen: (v: boolean) => void) {
  const { tabs, activeTabId, createTab, closeTab, setActiveTab } = useAppStore();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;

      // ⌘T — new tab
      if (e.key === "t" && !e.shiftKey) {
        e.preventDefault();
        createTab();
        return;
      }

      // ⌘W — close current tab
      if (e.key === "w" && !e.shiftKey) {
        if (tabs.length > 1) {
          e.preventDefault();
          closeTab(activeTabId);
        }
        return;
      }

      // ⌘1–⌘9 — switch to tab N
      const n = parseInt(e.key, 10);
      if (!isNaN(n) && n >= 1 && n <= 9) {
        const tab = tabs[n - 1];
        if (tab) { e.preventDefault(); setActiveTab(tab.id); }
        return;
      }

      // ⌘\ — toggle right panel
      if (e.key === "\\") {
        e.preventDefault();
        setRightOpen(!rightOpen);
      }
    };

    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [tabs, activeTabId, createTab, closeTab, setActiveTab, rightOpen, setRightOpen]);
}

export function WorkspaceLayout() {
  const [leftW, setLeftW] = useState(240);
  const [rightW, setRightW] = useState(380);
  const [rightOpen, setRightOpen] = useState(true);
  const { appMode } = useAppStore();

  useGlobalShortcuts(rightOpen, setRightOpen);

  return (
    <div className="flex flex-1 overflow-hidden min-h-0">
      <CommandPalette />
      <div className="flex flex-col overflow-hidden shrink-0" style={{ width: leftW }}>
        <LeftPanel />
      </div>

      <ResizeHandle onDrag={(d) => setLeftW((w) => clamp(w + d, 160, 440))} />

      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        {appMode === "docs" ? (
          <DocsOverview />
        ) : appMode === "er" ? (
          <ERDiagram />
        ) : (
          <CenterPanel rightOpen={rightOpen} onToggleRight={() => setRightOpen((v) => !v)} />
        )}
      </div>

      {appMode === "query" && rightOpen && (
        <>
          <ResizeHandle onDrag={(d) => setRightW((w) => clamp(w - d, 280, 640))} />
          <div className="flex flex-col overflow-hidden shrink-0" style={{ width: rightW }}>
            <RightPanel onClose={() => setRightOpen(false)} />
          </div>
        </>
      )}
    </div>
  );
}
