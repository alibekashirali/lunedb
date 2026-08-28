import { Titlebar } from "./Titlebar";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col h-screen overflow-hidden bg-background text-foreground select-none">
      <Titlebar />
      <div className="flex flex-1 overflow-hidden min-h-0">
        {children}
      </div>
    </div>
  );
}
