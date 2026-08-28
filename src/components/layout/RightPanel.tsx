import { useState } from "react";
import { DocsPanel } from "@/components/wiki/DocsPanel";
import { AiChatPanel } from "@/components/wiki/AiChatPanel";
import { Sparkles, MessageSquare, PanelRightClose } from "lucide-react";
import { cn } from "@/lib/utils";

type Tab = "docs" | "chat";

interface Props {
  onClose: () => void;
}

export function RightPanel({ onClose }: Props) {
  const [tab, setTab] = useState<Tab>("docs");

  return (
    <div className="w-full flex-1 flex flex-col min-h-0 overflow-hidden border-l border-border">
      {/* Tab bar */}
      <div className="flex items-center border-b border-border shrink-0 px-1 pt-1 gap-0.5" data-tauri-drag-region>
        <TabButton
          active={tab === "docs"}
          onClick={() => setTab("docs")}
          icon={<Sparkles className="h-3 w-3" />}
          label="Docs"
        />
        <TabButton
          active={tab === "chat"}
          onClick={() => setTab("chat")}
          icon={<MessageSquare className="h-3 w-3" />}
          label="AI Chat"
        />
        <button
          onClick={onClose}
          className="ml-auto mr-1 p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
          title="Close panel"
        >
          <PanelRightClose className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Panel content */}
      <div className="flex-1 overflow-hidden flex flex-col">
        {tab === "docs" ? <DocsPanel /> : <AiChatPanel />}
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  label,
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
        "flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-t-lg transition-colors border-b-2 -mb-px",
        active
          ? "border-primary text-primary bg-primary/5"
          : "border-transparent text-muted-foreground hover:text-foreground hover:bg-accent/50"
      )}
    >
      {icon}
      {label}
    </button>
  );
}
