import { invoke } from "@tauri-apps/api/core";

export interface ConnectionConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  ssl_mode?: string;
  ssl_ca_cert?: string;
  ssh_enabled?: boolean;
  ssh_host?: string;
  ssh_port?: number;
  ssh_user?: string;
  /** SSH password, or the private key passphrase when `ssh_auth` is "key". */
  ssh_password?: string;
  ssh_key_path?: string;
  ssh_auth?: "password" | "key";
}

export interface ColumnInfo {
  name: string;
  data_type: string;
  is_nullable: boolean;
  column_default: string | null;
  is_primary_key: boolean;
}

export interface TableInfo {
  schema: string;
  name: string;
  columns: ColumnInfo[];
  row_count_estimate: number | null;
}

export interface ViewInfo {
  schema: string;
  name: string;
}

export interface MatViewInfo {
  schema: string;
  name: string;
  is_populated: boolean;
}

export interface FunctionInfo {
  schema: string;
  name: string;
  return_type: string;
  language: string;
  kind: string;
}

export interface QueryResult {
  columns: string[];
  rows: unknown[][];
  row_count: number;
  execution_time_ms: number;
  truncated: boolean;
  error: string | null;
}

export interface ConnectionResult {
  success: boolean;
  message: string;
}

export const connectPostgres = (config: ConnectionConfig) =>
  invoke<ConnectionResult>("connect_postgres", { config });

export const disconnectPostgres = () => invoke<void>("disconnect_postgres");

export const getSchema = () => invoke<TableInfo[]>("get_schema");

export const getViews = () => invoke<ViewInfo[]>("get_views");

export const getMatViews = () => invoke<MatViewInfo[]>("get_materialized_views");

export interface SequenceInfo {
  schema: string;
  name: string;
  data_type: string;
  start_value: string;
  increment: string;
  min_value: string;
  max_value: string;
  cycle: boolean;
}

export const getSequences = () => invoke<SequenceInfo[]>("get_sequences");

export const getObjectDefinition = (schema: string, name: string, kind: string) =>
  invoke<string>("get_object_definition", { schema, name, kind });

export const getFunctions = () => invoke<FunctionInfo[]>("get_functions");

export const getTableDdl = (schema: string, table: string) =>
  invoke<string>("get_table_ddl", { schema, table });

export const executeQuery = (sql: string) =>
  invoke<QueryResult>("execute_query", { sql });

export const setConnectionPassword = (connId: number, password: string) =>
  invoke<void>("keychain_set", { connId, password });

export const getConnectionPassword = (connId: number) =>
  invoke<string>("keychain_get", { connId });

export const deleteConnectionPassword = (connId: number) =>
  invoke<void>("keychain_delete", { connId });

export const setSshPassword = (connId: number, password: string) =>
  invoke<void>("keychain_set_ssh", { connId, password });
export const getSshPassword = (connId: number) =>
  invoke<string>("keychain_get_ssh", { connId });
export const deleteSshPassword = (connId: number) =>
  invoke<void>("keychain_delete_ssh", { connId });
