import { create } from "zustand";
import type { TableInfo, ViewInfo, FunctionInfo, MatViewInfo, SequenceInfo, QueryResult } from "@/lib/tauri-commands";
import type { SavedConnection } from "@/lib/wiki-db";

export interface ExplainNode {
  "Node Type": string;
  "Relation Name"?: string;
  "Schema"?: string;
  "Alias"?: string;
  "Join Type"?: string;
  "Parent Relationship"?: string;
  "Index Name"?: string;
  "Index Cond"?: string;
  "Filter"?: string;
  "Hash Cond"?: string;
  "Merge Cond"?: string;
  "Join Filter"?: string;
  "Recheck Cond"?: string;
  "Startup Cost": number;
  "Total Cost": number;
  "Plan Rows": number;
  "Plan Width": number;
  "Actual Startup Time"?: number;
  "Actual Total Time"?: number;
  "Actual Rows"?: number;
  "Actual Loops"?: number;
  "Rows Removed by Filter"?: number;
  "Shared Hit Blocks"?: number;
  "Shared Read Blocks"?: number;
  "Plans"?: ExplainNode[];
}

export interface ExplainResult {
  Plan: ExplainNode;
  "Planning Time"?: number;
  "Execution Time"?: number;
}

type ConnectionStatus = "disconnected" | "connecting" | "connected" | "error";

export interface QueryTab {
  id: string;
  name: string;
  sql: string;
  result: QueryResult | null;
}

function makeId() {
  return `tab-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

function makeTab(sql = "", name = "Query"): QueryTab {
  return { id: makeId(), name, sql, result: null };
}

const INIT_TAB = makeTab("", "Query 1");

interface AppStore {
  // Connection
  connectionStatus: ConnectionStatus;
  connectionError: string | null;
  setConnectionStatus: (s: ConnectionStatus, error?: string) => void;

  // Saved connections
  savedConnections: SavedConnection[];
  setSavedConnections: (c: SavedConnection[]) => void;
  currentConnectionId: number | null;
  setCurrentConnectionId: (id: number | null) => void;

  // Schema
  schema: TableInfo[];
  setSchema: (tables: TableInfo[]) => void;
  views: ViewInfo[];
  setViews: (v: ViewInfo[]) => void;
  matViews: MatViewInfo[];
  setMatViews: (v: MatViewInfo[]) => void;
  sequences: SequenceInfo[];
  setSequences: (s: SequenceInfo[]) => void;
  functions: FunctionInfo[];
  setFunctions: (f: FunctionInfo[]) => void;

  // Selected table
  selectedTable: TableInfo | null;
  selectTable: (table: TableInfo | null) => void;

  // Query tabs  ("structure" is the special structure-view tab id)
  tabs: QueryTab[];
  activeTabId: string;
  createTab: (sql?: string, name?: string) => void;
  closeTab: (id: string) => void;
  setActiveTab: (id: string) => void;   // id = tab id OR "structure"
  nameActiveTab: (name: string) => void;

  // SQL editor / results — always mirror the active query tab
  sqlText: string;
  setSqlText: (sql: string) => void;
  queryResult: QueryResult | null;
  isQueryRunning: boolean;
  setQueryResult: (r: QueryResult | null) => void;
  setQueryRunning: (b: boolean) => void;

  // Pagination
  lastRunSql: string | null;
  queryPage: number;
  setLastRunSql: (sql: string | null) => void;
  setQueryPage: (page: number) => void;

  // Docs panel
  docsContent: string;
  setDocsContent: (c: string) => void;
  isGeneratingDocs: boolean;
  setGeneratingDocs: (b: boolean) => void;
  isEditingDocs: boolean;
  setEditingDocs: (b: boolean) => void;

  // App mode
  appMode: "query" | "docs" | "er";
  setAppMode: (m: "query" | "docs" | "er") => void;

  // Theme
  theme: "dark" | "light";
  toggleTheme: () => void;

  // EXPLAIN plan
  explainPlan: ExplainResult | null;
  setExplainPlan: (plan: ExplainResult | null) => void;

  // AI settings
  ollamaModel: string;
  setOllamaModel: (m: string) => void;
  offlineMode: boolean;
  setOfflineMode: (b: boolean) => void;
}

export const useAppStore = create<AppStore>((set) => ({
  connectionStatus: "disconnected",
  connectionError: null,
  setConnectionStatus: (connectionStatus, connectionError = undefined) =>
    set({ connectionStatus, connectionError: connectionError ?? null }),

  savedConnections: [],
  setSavedConnections: (savedConnections) => set({ savedConnections }),
  currentConnectionId: null,
  setCurrentConnectionId: (currentConnectionId) => set({ currentConnectionId }),

  schema: [],
  setSchema: (schema) => set({ schema }),
  views: [],
  setViews: (views) => set({ views }),
  matViews: [],
  setMatViews: (matViews) => set({ matViews }),
  sequences: [],
  setSequences: (sequences) => set({ sequences }),
  functions: [],
  setFunctions: (functions) => set({ functions }),

  selectedTable: null,
  selectTable: (selectedTable) => set({ selectedTable }),

  // ── Tabs ──────────────────────────────────────────────────────────────────

  tabs: [INIT_TAB],
  activeTabId: INIT_TAB.id,

  createTab: (sql = "", name?: string) =>
    set((s) => {
      // Flush current editor state into current tab first
      const saved = s.tabs.map((t) =>
        t.id === s.activeTabId ? { ...t, sql: s.sqlText, result: s.queryResult } : t
      );
      const tabName = name ?? `Query ${saved.length + 1}`;
      const tab = makeTab(sql, tabName);
      return {
        tabs: [...saved, tab],
        activeTabId: tab.id,
        sqlText: sql,
        queryResult: null,
        isQueryRunning: false,
      };
    }),

  closeTab: (id: string) =>
    set((s) => {
      if (s.tabs.length === 1) return {}; // keep at least one tab
      const idx = s.tabs.findIndex((t) => t.id === id);
      const next = s.tabs.filter((t) => t.id !== id);
      // Pick the tab to switch to
      let newActiveId = s.activeTabId;
      let newSql = s.sqlText;
      let newResult = s.queryResult;
      if (s.activeTabId === id) {
        const newTab = next[Math.min(idx, next.length - 1)];
        newActiveId = newTab.id;
        newSql = newTab.sql;
        newResult = newTab.result;
      }
      return {
        tabs: next,
        activeTabId: newActiveId,
        sqlText: newSql,
        queryResult: newResult,
        isQueryRunning: false,
      };
    }),

  setActiveTab: (id: string) =>
    set((s) => {
      if (id === s.activeTabId) return {};
      // Save current editor state to old tab (only if it was a query tab)
      const saved = s.tabs.map((t) =>
        t.id === s.activeTabId ? { ...t, sql: s.sqlText, result: s.queryResult } : t
      );
      // Load new tab state (if it's a query tab)
      const newTab = saved.find((t) => t.id === id);
      return {
        tabs: saved,
        activeTabId: id,
        sqlText: newTab?.sql ?? "",
        queryResult: newTab?.result ?? null,
        isQueryRunning: false,
      };
    }),

  nameActiveTab: (name: string) =>
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === s.activeTabId ? { ...t, name } : t)),
    })),

  // ── SQL editor ────────────────────────────────────────────────────────────

  sqlText: INIT_TAB.sql,
  setSqlText: (sqlText) => set({ sqlText }),
  queryResult: null,
  isQueryRunning: false,
  setQueryResult: (queryResult) =>
    set((s) => ({
      queryResult,
      tabs: s.tabs.map((t) =>
        t.id === s.activeTabId ? { ...t, result: queryResult } : t
      ),
    })),
  setQueryRunning: (isQueryRunning) => set({ isQueryRunning }),

  lastRunSql: null,
  queryPage: 0,
  setLastRunSql: (lastRunSql) => set({ lastRunSql }),
  setQueryPage: (queryPage) => set({ queryPage }),

  // ── Docs ──────────────────────────────────────────────────────────────────

  docsContent: "",
  setDocsContent: (docsContent) => set({ docsContent }),
  isGeneratingDocs: false,
  setGeneratingDocs: (isGeneratingDocs) => set({ isGeneratingDocs }),
  isEditingDocs: false,
  setEditingDocs: (isEditingDocs) => set({ isEditingDocs }),

  appMode: "query",
  setAppMode: (appMode) => set({ appMode }),

  theme: "dark",
  toggleTheme: () => set((s) => ({ theme: s.theme === "dark" ? "light" : "dark" })),

  explainPlan: null,
  setExplainPlan: (explainPlan) => set({ explainPlan }),

  ollamaModel: "qwen2.5:7b",
  setOllamaModel: (ollamaModel) => set({ ollamaModel }),
  offlineMode: true,
  setOfflineMode: (offlineMode) => set({ offlineMode }),
}));
