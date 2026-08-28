import { useState, useEffect, useMemo } from "react";
import { useAppStore } from "@/store/useAppStore";
import { connectPostgres, setConnectionPassword, getConnectionPassword, setSshPassword, getSshPassword } from "@/lib/tauri-commands";
import {
  saveConnection, getSavedConnections, updateConnection,
  type SavedConnection,
} from "@/lib/wiki-db";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Loader2, Database, Pencil, Copy } from "lucide-react";

const COLORS = [
  "#6360FB", "#22C55E", "#F59E0B", "#3B82F6",
  "#EF4444", "#EC4899", "#14B8A6", "#F97316",
];

function parseConnectionUrl(url: string): Partial<{ host: string; port: string; user: string; password: string; database: string }> | null {
  try {
    const u = new URL(url);
    if (!["postgres:", "postgresql:"].includes(u.protocol)) return null;
    return {
      host: u.hostname || "localhost",
      port: u.port || "5432",
      user: decodeURIComponent(u.username) || "postgres",
      password: decodeURIComponent(u.password) || "",
      database: u.pathname.replace(/^\//, "") || "postgres",
    };
  } catch {
    return null;
  }
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConnected: () => void;
  editConnection?: SavedConnection | null;
  duplicateFrom?: SavedConnection | null;
}

export function ConnectionDialog({ open, onOpenChange, onConnected, editConnection, duplicateFrom }: Props) {
  const { setConnectionStatus, setSavedConnections, setCurrentConnectionId, currentConnectionId, savedConnections } = useAppStore();
  const existingGroups = useMemo(
    () => [...new Set(savedConnections.map((c) => c.group_name || "Default"))].sort(),
    [savedConnections]
  );
  const isEdit = !!editConnection;
  const isDuplicate = !!duplicateFrom && !isEdit;

  const [form, setForm] = useState({
    name: "",
    host: "localhost",
    port: "5432",
    user: "postgres",
    password: "",
    database: "postgres",
    color: COLORS[0],
    group_name: "Default",
    ssl_mode: "prefer",
    ssl_ca_cert: "",
    ssh_enabled: false,
    ssh_host: "",
    ssh_port: "22",
    ssh_user: "",
    ssh_auth: "password" as "password" | "key",
    ssh_key_path: "",
    ssh_password: "",
  });
  const [urlInput, setUrlInput] = useState("");
  const [urlParsed, setUrlParsed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);
  const [testStatus, setTestStatus] = useState<"idle" | "testing" | "ok" | "error">("idle");
  const [testMessage, setTestMessage] = useState("");

  useEffect(() => {
    setError(null);
    setSaved(false);
    setUrlInput("");
    setUrlParsed(false);
    setTestStatus("idle");
    setTestMessage("");

    if (editConnection) {
      setForm({
        name: editConnection.name,
        host: editConnection.host,
        port: String(editConnection.port),
        user: editConnection.username,
        password: "",
        database: editConnection.database,
        color: editConnection.color,
        group_name: editConnection.group_name || "Default",
        ssl_mode: editConnection.ssl_mode ?? "prefer",
        ssl_ca_cert: editConnection.ssl_ca_cert ?? "",
        ssh_enabled: !!editConnection.ssh_enabled,
        ssh_host: editConnection.ssh_host ?? "",
        ssh_port: String(editConnection.ssh_port ?? 22),
        ssh_user: editConnection.ssh_user ?? "",
        ssh_auth: (editConnection.ssh_auth ?? "password") as "password" | "key",
        ssh_key_path: editConnection.ssh_key_path ?? "",
        ssh_password: "",
      });
      getConnectionPassword(editConnection.id)
        .then((pwd) => setForm((f) => ({ ...f, password: pwd })))
        .catch(() => {});
      getSshPassword(editConnection.id)
        .then((pwd) => setForm((f) => ({ ...f, ssh_password: pwd })))
        .catch(() => {});
    } else if (duplicateFrom) {
      setForm({
        name: `Copy of ${duplicateFrom.name}`,
        host: duplicateFrom.host,
        port: String(duplicateFrom.port),
        user: duplicateFrom.username,
        password: "",
        database: duplicateFrom.database,
        color: duplicateFrom.color,
        group_name: duplicateFrom.group_name || "Default",
        ssl_mode: duplicateFrom.ssl_mode ?? "prefer",
        ssl_ca_cert: duplicateFrom.ssl_ca_cert ?? "",
        ssh_enabled: !!duplicateFrom.ssh_enabled,
        ssh_host: duplicateFrom.ssh_host ?? "",
        ssh_port: String(duplicateFrom.ssh_port ?? 22),
        ssh_user: duplicateFrom.ssh_user ?? "",
        ssh_auth: (duplicateFrom.ssh_auth ?? "password") as "password" | "key",
        ssh_key_path: duplicateFrom.ssh_key_path ?? "",
        ssh_password: "",
      });
      getConnectionPassword(duplicateFrom.id)
        .then((pwd) => setForm((f) => ({ ...f, password: pwd })))
        .catch(() => {});
      getSshPassword(duplicateFrom.id)
        .then((pwd) => setForm((f) => ({ ...f, ssh_password: pwd })))
        .catch(() => {});
    } else {
      setForm({ name: "", host: "localhost", port: "5432", user: "postgres", password: "", database: "postgres", color: COLORS[0], group_name: "Default", ssl_mode: "prefer", ssl_ca_cert: "", ssh_enabled: false, ssh_host: "", ssh_port: "22", ssh_user: "", ssh_auth: "password", ssh_key_path: "", ssh_password: "" });
    }
  }, [editConnection, duplicateFrom, open]);

  const set = (field: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [field]: e.target.value }));

  const handleUrlChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setUrlInput(val);
    // Strip env-var prefix: DATABASE_URL=... or KEY = "..."
    const raw = val.replace(/^\s*\w+\s*=\s*["']?/, "").replace(/["']?\s*$/, "");
    const parsed = parseConnectionUrl(raw);
    if (parsed) {
      setForm((f) => ({ ...f, ...parsed }));
      setUrlParsed(true);
    } else {
      setUrlParsed(false);
    }
  };

  const handleTest = async () => {
    setTestStatus("testing");
    setTestMessage("");
    try {
      const result = await connectPostgres({
        host: form.host,
        port: parseInt(form.port, 10),
        user: form.user,
        password: form.password,
        database: form.database,
        ssl_mode: form.ssl_mode,
        ssl_ca_cert: form.ssl_ca_cert || undefined,
        ssh_enabled: form.ssh_enabled,
        ssh_host: form.ssh_host || undefined,
        ssh_port: form.ssh_host ? parseInt(form.ssh_port, 10) || 22 : undefined,
        ssh_user: form.ssh_user || undefined,
        ssh_password: form.ssh_password || undefined,
        ssh_key_path: form.ssh_key_path || undefined,
        ssh_auth: form.ssh_auth,
      });
      if (result.success) {
        setTestStatus("ok");
        setTestMessage(result.message ?? "Connection successful");
      } else {
        setTestStatus("error");
        setTestMessage(result.message ?? "Connection failed");
      }
    } catch (err) {
      setTestStatus("error");
      setTestMessage(String(err));
    }
  };

  // ── Edit: update SQLite only ───────────────────────────────────────────────

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editConnection) return;
    setError(null);
    setLoading(true);
    try {
      await updateConnection(editConnection.id, {
        name: form.name || `${form.database}@${form.host}`,
        host: form.host,
        port: parseInt(form.port, 10),
        username: form.user,
        database: form.database,
        color: form.color,
        group_name: form.group_name || "Default",
        ssl_mode: form.ssl_mode,
        ssl_ca_cert: form.ssl_ca_cert,
        ssh_enabled: form.ssh_enabled ? 1 : 0,
        ssh_host: form.ssh_host,
        ssh_port: parseInt(form.ssh_port, 10) || 22,
        ssh_user: form.ssh_user,
        ssh_auth: form.ssh_auth,
        ssh_key_path: form.ssh_key_path,
      });
      if (form.password) await setConnectionPassword(editConnection.id, form.password);
      if (form.ssh_password) await setSshPassword(editConnection.id, form.ssh_password);
      const conns = await getSavedConnections();
      setSavedConnections(conns);
      setSaved(true);
      setTimeout(() => { onOpenChange(false); setSaved(false); }, 800);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  // ── New / Duplicate: connect + save ───────────────────────────────────────

  const handleConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    setConnectionStatus("connecting");
    try {
      const result = await connectPostgres({
        host: form.host,
        port: parseInt(form.port, 10),
        user: form.user,
        password: form.password,
        database: form.database,
        ssl_mode: form.ssl_mode,
        ssl_ca_cert: form.ssl_ca_cert || undefined,
        ssh_enabled: form.ssh_enabled,
        ssh_host: form.ssh_host || undefined,
        ssh_port: form.ssh_host ? parseInt(form.ssh_port, 10) || 22 : undefined,
        ssh_user: form.ssh_user || undefined,
        ssh_password: form.ssh_password || undefined,
        ssh_key_path: form.ssh_key_path || undefined,
        ssh_auth: form.ssh_auth,
      });
      if (result.success) {
        setConnectionStatus("connected");
        const conn = await saveConnection(
          form.host, parseInt(form.port, 10), form.user, form.database,
          { name: form.name || undefined, color: form.color, group_name: form.group_name || "Default", allowDuplicate: isDuplicate, ssl_mode: form.ssl_mode, ssl_ca_cert: form.ssl_ca_cert, ssh_enabled: form.ssh_enabled ? 1 : 0, ssh_host: form.ssh_host, ssh_port: parseInt(form.ssh_port, 10) || 22, ssh_user: form.ssh_user, ssh_auth: form.ssh_auth, ssh_key_path: form.ssh_key_path }
        );
        await setConnectionPassword(conn.id, form.password);
        if (form.ssh_enabled && form.ssh_password) {
          await setSshPassword(conn.id, form.ssh_password);
        }
        const allConns = await getSavedConnections();
        setSavedConnections(allConns);
        setCurrentConnectionId(conn.id);
        onConnected();
      } else {
        setConnectionStatus("error", result.message);
        setError(result.message);
      }
    } catch (err) {
      const msg = String(err);
      setConnectionStatus("error", msg);
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const isActive = editConnection?.id === currentConnectionId;
  const titleIcon = isEdit
    ? <Pencil className="h-4 w-4 text-primary" />
    : isDuplicate
    ? <Copy className="h-4 w-4 text-primary" />
    : <Database className="h-4 w-4 text-primary" />;
  const titleText = isEdit ? "Edit Connection" : isDuplicate ? "Duplicate Connection" : "New Connection";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card border-border text-foreground max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            {titleIcon} {titleText}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={isEdit ? handleSaveEdit : handleConnect} className="space-y-3 mt-2">
          {/* Connection name — always visible */}
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Connection name</Label>
            <Input
              value={form.name}
              onChange={set("name")}
              placeholder={`${form.database}@${form.host}`}
              className="bg-muted border-border text-sm h-8"
            />
          </div>

          {/* Group */}
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Group</Label>
            <Input
              value={form.group_name}
              onChange={set("group_name")}
              placeholder="Default"
              list="conn-groups"
              className="bg-muted border-border text-sm h-8"
            />
            <datalist id="conn-groups">
              {existingGroups.map((g) => <option key={g} value={g} />)}
            </datalist>
          </div>

          {/* Color picker — always visible */}
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Color</Label>
            <div className="flex items-center gap-2">
              {COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, color: c }))}
                  className="w-5 h-5 rounded-full border-2 transition-all"
                  style={{
                    background: c,
                    borderColor: form.color === c ? "white" : "transparent",
                    transform: form.color === c ? "scale(1.25)" : "scale(1)",
                  }}
                />
              ))}
            </div>
          </div>

          {/* URL / .env paste (new + duplicate only) */}
          {!isEdit && (
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">
                Connection URL or .env
                <span className="ml-1.5 text-muted-foreground/40 font-normal">optional</span>
              </Label>
              <div className="relative">
                <Input
                  value={urlInput}
                  onChange={handleUrlChange}
                  placeholder="postgres://user:pass@host/db  or  DATABASE_URL=…"
                  className="bg-muted border-border text-sm h-8 font-mono pr-14"
                />
                {urlParsed && (
                  <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-green-500 font-medium">
                    parsed ✓
                  </span>
                )}
              </div>
            </div>
          )}

          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2 space-y-1.5">
              <Label className="text-xs text-muted-foreground">Host</Label>
              <Input value={form.host} onChange={set("host")} placeholder="localhost" className="bg-muted border-border text-sm h-8" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Port</Label>
              <Input value={form.port} onChange={set("port")} placeholder="5432" className="bg-muted border-border text-sm h-8" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">User</Label>
              <Input value={form.user} onChange={set("user")} placeholder="postgres" className="bg-muted border-border text-sm h-8" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Password</Label>
              <Input type="password" value={form.password} onChange={set("password")} className="bg-muted border-border text-sm h-8" />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Database</Label>
            <Input value={form.database} onChange={set("database")} placeholder="postgres" className="bg-muted border-border text-sm h-8" />
          </div>

          {/* SSL */}
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">SSL Mode</Label>
            <select
              value={form.ssl_mode}
              onChange={(e) => setForm((f) => ({ ...f, ssl_mode: e.target.value, ssl_ca_cert: "" }))}
              className="w-full h-8 rounded-md bg-muted border border-border px-2 text-sm text-foreground outline-none focus:border-primary/50"
            >
              <option value="prefer">Prefer — try SSL, fallback to plain</option>
              <option value="disable">Disable — no encryption</option>
              <option value="require">Require — enforce SSL (no cert verify)</option>
              <option value="verify-ca">Verify CA — validate certificate authority</option>
              <option value="verify-full">Verify Full — validate CA + hostname</option>
            </select>
          </div>

          {(form.ssl_mode === "verify-ca" || form.ssl_mode === "verify-full") && (
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">CA Certificate Path</Label>
              <Input
                value={form.ssl_ca_cert}
                onChange={set("ssl_ca_cert")}
                placeholder="/path/to/ca.crt"
                className="bg-muted border-border text-sm h-8 font-mono"
              />
            </div>
          )}

          {/* SSH Tunnel */}
          <div className="space-y-2">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={form.ssh_enabled}
                onChange={(e) => setForm((f) => ({ ...f, ssh_enabled: e.target.checked }))}
                className="rounded"
              />
              <span className="text-xs text-muted-foreground">Use SSH Tunnel</span>
            </label>

            {form.ssh_enabled && (
              <div className="space-y-2 pl-1 border-l-2 border-primary/20">
                <div className="grid grid-cols-3 gap-2">
                  <div className="col-span-2 space-y-1">
                    <Label className="text-xs text-muted-foreground">SSH Host</Label>
                    <Input value={form.ssh_host} onChange={set("ssh_host")} placeholder="bastion.example.com" className="bg-muted border-border text-sm h-8" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Port</Label>
                    <Input value={form.ssh_port} onChange={set("ssh_port")} placeholder="22" className="bg-muted border-border text-sm h-8" />
                  </div>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">SSH User</Label>
                  <Input value={form.ssh_user} onChange={set("ssh_user")} placeholder="ubuntu" className="bg-muted border-border text-sm h-8" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Auth</Label>
                  <select
                    value={form.ssh_auth}
                    onChange={(e) => setForm((f) => ({ ...f, ssh_auth: e.target.value as "password" | "key" }))}
                    className="w-full h-8 rounded-md bg-muted border border-border px-2 text-sm text-foreground outline-none focus:border-primary/50"
                  >
                    <option value="password">Password</option>
                    <option value="key">Key File</option>
                  </select>
                </div>
                {form.ssh_auth === "password" ? (
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">SSH Password</Label>
                    <Input type="password" value={form.ssh_password} onChange={set("ssh_password")} className="bg-muted border-border text-sm h-8" />
                  </div>
                ) : (
                  <>
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Key File Path</Label>
                      <Input value={form.ssh_key_path} onChange={set("ssh_key_path")} placeholder="~/.ssh/id_ed25519" className="bg-muted border-border text-sm h-8 font-mono" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Key Passphrase</Label>
                      <Input type="password" value={form.ssh_password} onChange={set("ssh_password")} placeholder="leave empty if the key is not encrypted" className="bg-muted border-border text-sm h-8" />
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Test result */}
          {testStatus !== "idle" && (
            <div className={`flex items-center gap-2 px-3 py-2 rounded text-[11px] ${
              testStatus === "testing"
                ? "bg-muted/60 text-muted-foreground"
                : testStatus === "ok"
                ? "bg-green-500/10 text-green-500"
                : "bg-destructive/10 text-destructive"
            }`}>
              {testStatus === "testing"
                ? <Loader2 className="h-3 w-3 animate-spin shrink-0" />
                : <span className="shrink-0">{testStatus === "ok" ? "✓" : "✗"}</span>}
              <span className="break-words">
                {testStatus === "testing" ? "Testing connection…" : testMessage}
              </span>
            </div>
          )}

          {isEdit && isActive && (
            <p className="text-[11px] text-muted-foreground/60 bg-muted/40 rounded px-3 py-2">
              This is the active connection — changes apply on next reconnect.
            </p>
          )}

          {error && (
            <p className="text-xs text-destructive bg-destructive/10 rounded px-3 py-2 break-words">{error}</p>
          )}

          {/* Footer */}
          <div className="pt-2 flex items-center justify-between gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleTest}
              disabled={loading || testStatus === "testing"}
              className="text-xs shrink-0"
            >
              {testStatus === "testing"
                ? <><Loader2 className="h-3 w-3 animate-spin mr-1" />Testing…</>
                : "Test Connection"}
            </Button>
            <div className="flex gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => onOpenChange(false)} disabled={loading}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={loading}>
                {loading
                  ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />Saving…</>
                  : saved ? "Saved ✓"
                  : isEdit ? "Save changes"
                  : "Connect"}
              </Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
