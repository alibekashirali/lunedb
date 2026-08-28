import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { useAppStore } from "@/store/useAppStore";
import {
  connectPostgres,
  getConnectionPassword,
  getSshPassword,
  getSchema,
  getViews,
  getFunctions,
  getMatViews,
  getSequences,
  getObjectDefinition,
} from "@/lib/tauri-commands";
import {
  getDocsPage,
  getSavedConnections,
  deleteConnection,
  updateConnectionLastUsed,
  type SavedConnection,
} from "@/lib/wiki-db";
import { ConnectionDialog } from "@/components/db/ConnectionDialog";
import { SchemaTree } from "@/components/db/SchemaTree";
import {
  ChevronDown,
  RefreshCw,
  Plus,
  Search,
  Loader2,
  Trash2,
  Pencil,
  Copy,
} from "lucide-react";
import type { TableInfo, ViewInfo } from "@/lib/tauri-commands";

export function LeftPanel() {
  const {
    connectionStatus,
    schema,
    views,
    matViews,
    sequences,
    functions,
    setSchema,
    setViews,
    setMatViews,
    setSequences,
    setFunctions,
    selectedTable,
    selectTable,
    setSqlText,
    setDocsContent,
    setConnectionStatus,
    nameActiveTab,
    connectionError,
    savedConnections,
    setSavedConnections,
    currentConnectionId,
    setCurrentConnectionId,
  } = useAppStore();

  const [showConnSwitcher, setShowConnSwitcher] = useState(false);
  const [showConnectionDialog, setShowConnectionDialog] = useState(false);
  const [editConn, setEditConn] = useState<SavedConnection | null>(null);
  const [duplicateConn, setDuplicateConn] = useState<SavedConnection | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [switchingId, setSwitchingId] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const switcherRef = useRef<HTMLDivElement>(null);

  // Load saved connections on mount
  useEffect(() => {
    getSavedConnections().then(setSavedConnections).catch(console.error);
  }, [setSavedConnections]);

  // Close switcher when clicking outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (switcherRef.current && !switcherRef.current.contains(e.target as Node)) {
        setShowConnSwitcher(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const loadFullSchema = useCallback(async () => {
    const [tables, viewList, matViewList, seqList, fnList] = await Promise.all([
      getSchema(),
      getViews(),
      getMatViews(),
      getSequences(),
      getFunctions(),
    ]);
    setSchema(tables);
    setViews(viewList);
    setMatViews(matViewList);
    setSequences(seqList);
    setFunctions(fnList);
  }, [setSchema, setViews, setMatViews, setSequences, setFunctions]);

  const handleConnected = useCallback(async () => {
    setShowConnectionDialog(false);
    await loadFullSchema();
    const conns = await getSavedConnections();
    setSavedConnections(conns);
  }, [loadFullSchema, setSavedConnections]);

  const handleRefresh = useCallback(async () => {
    if (connectionStatus !== "connected") return;
    setIsRefreshing(true);
    try {
      await loadFullSchema();
    } finally {
      setIsRefreshing(false);
    }
  }, [connectionStatus, loadFullSchema]);

  const handleSelectTable = useCallback(
    async (table: TableInfo) => {
      selectTable(table);
      setSqlText(`SELECT *\nFROM ${table.schema}.${table.name};`);
      nameActiveTab(table.name);
      const saved = await getDocsPage(`${table.schema}.${table.name}`);
      setDocsContent(saved ?? "");
    },
    [selectTable, setSqlText, nameActiveTab, setDocsContent]
  );

  const handleSelectView = useCallback(
    (view: ViewInfo) => {
      setSqlText(`SELECT *\nFROM ${view.schema}.${view.name}\nLIMIT 100;`);
    },
    [setSqlText]
  );

  const handleSelectObject = useCallback(
    async (schema: string, name: string, kind: string) => {
      try {
        const def = await getObjectDefinition(schema, name, kind);
        setSqlText(def);
        nameActiveTab(name);
      } catch {
        // silently ignore
      }
    },
    [setSqlText, nameActiveTab]
  );

  const handleSwitchConnection = useCallback(
    async (conn: SavedConnection) => {
      if (conn.id === currentConnectionId && connectionStatus === "connected") {
        setShowConnSwitcher(false);
        return;
      }
      setSwitchingId(conn.id);
      setConnectionStatus("connecting");
      try {
        const password = await getConnectionPassword(conn.id);
        const sshPassword = conn.ssh_enabled ? await getSshPassword(conn.id) : undefined;
        const result = await connectPostgres({
          host: conn.host,
          port: conn.port,
          user: conn.username,
          password,
          database: conn.database,
          ssl_mode: conn.ssl_mode,
          ssl_ca_cert: conn.ssl_ca_cert || undefined,
          ssh_enabled: !!conn.ssh_enabled,
          ssh_host: conn.ssh_host || undefined,
          ssh_port: conn.ssh_port || undefined,
          ssh_user: conn.ssh_user || undefined,
          ssh_password: sshPassword || undefined,
          ssh_key_path: conn.ssh_key_path || undefined,
          ssh_auth: conn.ssh_auth === "key" ? "key" : "password",
        });
        if (result.success) {
          setConnectionStatus("connected");
          setCurrentConnectionId(conn.id);
          selectTable(null);
          setSqlText("");
          setDocsContent("");
          await loadFullSchema();
          await updateConnectionLastUsed(conn.id);
          setShowConnSwitcher(false);
        } else {
          setConnectionStatus("error", result.message);
        }
      } catch (err) {
        setConnectionStatus("error", String(err));
      } finally {
        setSwitchingId(null);
      }
    },
    [
      currentConnectionId,
      connectionStatus,
      setConnectionStatus,
      setCurrentConnectionId,
      selectTable,
      setSqlText,
      setDocsContent,
      loadFullSchema,
    ]
  );

  const handleDeleteConnection = useCallback(
    async (e: React.MouseEvent, id: number) => {
      e.stopPropagation();
      await deleteConnection(id);
      const conns = await getSavedConnections();
      setSavedConnections(conns);
      if (id === currentConnectionId) {
        setCurrentConnectionId(null);
        setConnectionStatus("disconnected");
      }
    },
    [currentConnectionId, setCurrentConnectionId, setSavedConnections, setConnectionStatus]
  );

  const groupedConnections = useMemo(() => {
    const map = new Map<string, typeof savedConnections>();
    for (const conn of savedConnections) {
      const g = conn.group_name || "Default";
      if (!map.has(g)) map.set(g, []);
      map.get(g)!.push(conn);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [savedConnections]);

  const currentConn = savedConnections.find((c) => c.id === currentConnectionId) ?? null;
  const isConnected = connectionStatus === "connected";
  const isConnecting = connectionStatus === "connecting";

  const statusColor = isConnected
    ? "bg-green-500"
    : isConnecting
    ? "bg-yellow-500 animate-pulse"
    : connectionStatus === "error"
    ? "bg-red-500"
    : "bg-muted-foreground/40";

  return (
    <div className="w-full flex flex-col bg-sidebar overflow-hidden">
      {/* Connection switcher */}
      <div ref={switcherRef} className="relative shrink-0">
        <div className="flex items-center gap-1 px-2 py-1.5 border-b border-border">
          <button
            onClick={() => setShowConnSwitcher((v) => !v)}
            className="flex items-center gap-2 flex-1 rounded px-2 py-1 hover:bg-accent min-w-0"
          >
            <div className={`w-2 h-2 rounded-full shrink-0 ${statusColor}`} />
            <span className="text-xs font-medium text-foreground truncate">
              {currentConn?.name ?? (isConnecting ? "Connecting…" : "No connection")}
            </span>
            <ChevronDown
              className={`h-3 w-3 text-muted-foreground ml-auto shrink-0 transition-transform duration-150 ${
                showConnSwitcher ? "rotate-180" : ""
              }`}
            />
          </button>

          <button
            onClick={() => {
              setShowConnSwitcher(false);
              setShowConnectionDialog(true);
            }}
            className="p-1.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground shrink-0"
            title="New connection"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>

          {isConnected && (
            <button
              onClick={handleRefresh}
              className="p-1.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground shrink-0"
              title="Refresh schema"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${isRefreshing ? "animate-spin" : ""}`}
              />
            </button>
          )}
        </div>

        {/* Connections dropdown */}
        {showConnSwitcher && (
          <div className="absolute top-full left-0 right-0 z-50 bg-card border border-border rounded-b-xl shadow-xl shadow-black/40 overflow-hidden">
            {savedConnections.length === 0 ? (
              <p className="text-xs text-muted-foreground px-3 py-3 text-center">
                No saved connections
              </p>
            ) : (
              <div className="max-h-56 overflow-y-auto">
                {groupedConnections.map(([groupName, conns]) => (
                  <div key={groupName}>
                    <div className="px-3 py-1 flex items-center gap-1.5">
                      <span className="text-[10px] font-semibold text-muted-foreground/50 uppercase tracking-wider">
                        {groupName}
                      </span>
                      <div className="flex-1 h-px bg-border/50" />
                    </div>
                    {conns.map((conn) => {
                      const isActive = conn.id === currentConnectionId;
                      const isSwitching = switchingId === conn.id;
                      return (
                        <button
                          key={conn.id}
                          onClick={() => handleSwitchConnection(conn)}
                          disabled={isSwitching}
                          className="w-full flex items-center gap-2 px-3 py-2 hover:bg-accent/60 text-left group"
                        >
                          <div
                            className="w-2 h-2 rounded-full shrink-0"
                            style={{ background: conn.color }}
                          />
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-medium text-foreground truncate">
                              {conn.name}
                            </p>
                            <p className="text-[10px] text-muted-foreground/60 truncate">
                              {conn.host}:{conn.port}
                            </p>
                          </div>
                          {isSwitching ? (
                            <Loader2 className="h-3 w-3 animate-spin text-muted-foreground shrink-0" />
                          ) : (
                            <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                              {isActive && (
                                <span className="text-[10px] text-primary/70 bg-primary/10 px-1.5 py-0.5 rounded mr-1">
                                  active
                                </span>
                              )}
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setShowConnSwitcher(false);
                                  setEditConn(conn);
                                  setShowConnectionDialog(true);
                                }}
                                className="p-0.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground"
                                title="Edit connection"
                              >
                                <Pencil className="h-3 w-3" />
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setShowConnSwitcher(false);
                                  setDuplicateConn(conn);
                                  setShowConnectionDialog(true);
                                }}
                                className="p-0.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground"
                                title="Duplicate connection"
                              >
                                <Copy className="h-3 w-3" />
                              </button>
                              {!isActive && (
                                <button
                                  onClick={(e) => handleDeleteConnection(e, conn.id)}
                                  className="p-0.5 rounded hover:bg-destructive/20 text-muted-foreground hover:text-destructive"
                                  title="Delete connection"
                                >
                                  <Trash2 className="h-3 w-3" />
                                </button>
                              )}
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>
            )}
            <div className="border-t border-border">
              <button
                onClick={() => {
                  setShowConnSwitcher(false);
                  setShowConnectionDialog(true);
                }}
                className="w-full flex items-center gap-2 px-3 py-2 hover:bg-accent/60 text-xs text-muted-foreground hover:text-foreground"
              >
                <Plus className="h-3.5 w-3.5" />
                New connection
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Connection error banner */}
      {connectionStatus === "error" && connectionError && (
        <div className="px-3 py-2 bg-destructive/10 border-b border-destructive/20 shrink-0">
          <p className="text-[11px] text-destructive leading-snug break-words">
            {connectionError}
          </p>
        </div>
      )}

      {/* Search */}
      {isConnected && (
        <div className="px-2 py-1.5 border-b border-border shrink-0">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground/50 pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search…"
              className="w-full bg-muted/40 border border-transparent rounded-md pl-6 pr-2 py-1 text-xs text-foreground placeholder:text-muted-foreground/40 outline-none focus:border-primary/30 focus:bg-muted/60 transition-colors"
            />
          </div>
        </div>
      )}

      {/* Schema tree or empty state */}
      <div className="flex-1 overflow-y-auto py-1">
        {isConnected && (schema.length > 0 || views.length > 0 || functions.length > 0) ? (
          <SchemaTree
            tables={schema}
            views={views}
            matViews={matViews}
            sequences={sequences}
            functions={functions}
            selectedTable={selectedTable}
            onSelectTable={handleSelectTable}
            onSelectView={handleSelectView}
            onSelectObject={handleSelectObject}
            search={search}
          />
        ) : !isConnected && !isConnecting ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 px-4 text-center">
            <div className="w-10 h-10 rounded-xl bg-muted/50 flex items-center justify-center">
              <Plus className="h-5 w-5 text-muted-foreground/40" />
            </div>
            <p className="text-xs text-muted-foreground">
              No active connection.
            </p>
            <button
              onClick={() => setShowConnectionDialog(true)}
              className="text-xs text-primary hover:underline"
            >
              Add connection
            </button>
          </div>
        ) : isConnecting ? (
          <div className="flex items-center justify-center h-full gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Connecting…
          </div>
        ) : null}
      </div>

      <ConnectionDialog
        open={showConnectionDialog}
        onOpenChange={(open) => {
          setShowConnectionDialog(open);
          if (!open) { setEditConn(null); setDuplicateConn(null); }
        }}
        onConnected={handleConnected}
        editConnection={editConn}
        duplicateFrom={duplicateConn}
      />
    </div>
  );
}
