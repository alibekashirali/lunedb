import { useState, useCallback } from "react";
import { useAppStore } from "@/store/useAppStore";
import { connectPostgres, getSchema, getViews, getFunctions, setConnectionPassword } from "@/lib/tauri-commands";
import { saveConnection, getSavedConnections } from "@/lib/wiki-db";
import { Switch } from "@/components/ui/switch";
import {
  Server,
  Hash,
  User,
  Lock,
  Eye,
  EyeOff,
  Sparkles,
  Brain,
  ShieldCheck,
  ChevronDown,
  Lock as LockIcon,
} from "lucide-react";

const OLLAMA_MODELS = [
  "qwen2.5:7b",
  "qwen2.5:14b",
  "qwen2.5-coder:7b",
  "qwen2.5-coder:14b",
  "llama3.1:8b",
  "llama3.2:3b",
  "codellama:7b",
  "deepseek-coder:6.7b",
  "mistral:7b",
];

function Field({
  label,
  icon,
  right,
  inputProps,
}: {
  label: string;
  icon: React.ReactNode;
  right?: React.ReactNode;
  inputProps: React.InputHTMLAttributes<HTMLInputElement>;
}) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      <div className="relative">
        <div className="absolute left-3 top-1/2 -translate-y-1/2 text-primary/60 pointer-events-none">
          {icon}
        </div>
        <input
          {...inputProps}
          className="w-full bg-muted/60 border border-border rounded-lg pl-9 py-2 text-sm text-foreground placeholder:text-muted-foreground/40 outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-colors"
          style={{ paddingRight: right ? "2.25rem" : "0.75rem" }}
        />
        {right && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2">{right}</div>
        )}
      </div>
    </div>
  );
}

export function WelcomePage() {
  const {
    setConnectionStatus,
    setSchema,
    setViews,
    setFunctions,
    setSavedConnections,
    setCurrentConnectionId,
    ollamaModel,
    setOllamaModel,
    offlineMode,
    setOfflineMode,
  } = useAppStore();

  const [form, setForm] = useState({
    host: "localhost",
    port: "5432",
    user: "postgres",
    password: "",
    database: "postgres",
  });
  const [showPassword, setShowPassword] = useState(false);
  const [showAI, setShowAI] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const field = (key: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((f) => ({ ...f, [key]: e.target.value }));

  const handleConnect = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setError(null);
      setLoading(true);
      try {
        const result = await connectPostgres({
          host: form.host,
          port: parseInt(form.port, 10),
          user: form.user,
          password: form.password,
          database: form.database,
        });
        if (result.success) {
          const [tables, viewList, fnList] = await Promise.all([
            getSchema(),
            getViews(),
            getFunctions(),
          ]);
          setSchema(tables);
          setViews(viewList);
          setFunctions(fnList);
          const conn = await saveConnection(
            form.host,
            parseInt(form.port, 10),
            form.user,
            form.database
          );
          await setConnectionPassword(conn.id, form.password);
          const allConns = await getSavedConnections();
          setSavedConnections(allConns);
          setCurrentConnectionId(conn.id);
          // only switch to app on confirmed success
          setConnectionStatus("connected");
        } else {
          setError(result.message);
        }
      } catch (err) {
        setError(String(err));
      } finally {
        setLoading(false);
      }
    },
    [form, setConnectionStatus, setSchema, setViews, setFunctions, setSavedConnections, setCurrentConnectionId]
  );

  return (
    <div
      className="h-screen bg-background flex flex-col items-center justify-center px-4 overflow-y-auto"
      data-tauri-drag-region
    >
      <div className="w-full max-w-[420px] py-6">

        {/* Logo */}
        <div className="flex justify-center mb-7">
          <img
            src="/logo.svg"
            alt="LuneDB"
            className="h-9 w-auto pointer-events-none"
            draggable={false}
          />
        </div>

        {/* Card */}
        <div className="rounded-2xl border border-border bg-card shadow-2xl shadow-black/50">
          {/* Card header */}
          <div className="px-6 pt-5 pb-4 border-b border-border text-center">
            <div className="inline-flex items-center justify-center w-9 h-9 rounded-xl bg-primary/15 mb-2.5">
              <Server className="h-4.5 w-4.5 text-primary" style={{ width: 18, height: 18 }} />
            </div>
            <h1 className="text-base font-bold text-foreground">New Database Connection</h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              Connect to your PostgreSQL database to get started.
            </p>
          </div>

          {/* Form */}
          <form onSubmit={handleConnect} className="px-6 py-5 space-y-3">

            {/* Host + Port */}
            <div className="grid grid-cols-[1fr_118px] gap-2">
              <Field
                label="Host"
                icon={<Server className="h-3.5 w-3.5" />}
                inputProps={{ value: form.host, onChange: field("host"), placeholder: "localhost" }}
              />
              <Field
                label="Port"
                icon={<Hash className="h-3.5 w-3.5" />}
                inputProps={{ value: form.port, onChange: field("port"), placeholder: "5432" }}
              />
            </div>

            {/* User + Database */}
            <div className="grid grid-cols-2 gap-2">
              <Field
                label="User"
                icon={<User className="h-3.5 w-3.5" />}
                inputProps={{ value: form.user, onChange: field("user"), placeholder: "postgres" }}
              />
              <Field
                label="Database"
                icon={<Server className="h-3.5 w-3.5" />}
                inputProps={{ value: form.database, onChange: field("database"), placeholder: "postgres" }}
              />
            </div>

            {/* Password */}
            <Field
              label="Password"
              icon={<Lock className="h-3.5 w-3.5" />}
              inputProps={{
                type: showPassword ? "text" : "password",
                value: form.password,
                onChange: field("password"),
                placeholder: "••••••••",
              }}
              right={
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="text-muted-foreground hover:text-foreground transition-colors"
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </button>
              }
            />

            {/* AI Settings — collapsible */}
            <div className="rounded-xl border border-border overflow-hidden">
              {/* Toggle header */}
              <button
                type="button"
                onClick={() => setShowAI((v) => !v)}
                className="w-full flex items-center gap-2.5 px-3.5 py-2.5 bg-muted/30 hover:bg-muted/50 transition-colors text-left"
              >
                <Brain className="h-3.5 w-3.5 text-primary/80 shrink-0" />
                <span className="text-xs font-semibold text-foreground flex-1">
                  Local AI Settings
                </span>
                {/* active indicator */}
                {showAI && (
                  <span className="text-[10px] font-mono text-primary/70 bg-primary/10 px-1.5 py-0.5 rounded">
                    {ollamaModel}
                  </span>
                )}
                <ChevronDown
                  className={`h-3.5 w-3.5 text-muted-foreground transition-transform duration-200 shrink-0 ${
                    showAI ? "rotate-180" : ""
                  }`}
                />
              </button>

              {/* Expanded content */}
              {showAI && (
                <div className="border-t border-border divide-y divide-border bg-muted/10">
                  {/* Offline toggle */}
                  <div className="flex items-center justify-between px-3.5 py-2.5">
                    <div className="flex items-center gap-2">
                      <ShieldCheck className="h-3.5 w-3.5 text-primary/70 shrink-0" />
                      <div>
                        <p className="text-xs font-medium text-foreground">Offline Mode</p>
                        <p className="text-[11px] text-muted-foreground/60">
                          Zero-Trust, no cloud requests
                        </p>
                      </div>
                    </div>
                    <Switch checked={offlineMode} onCheckedChange={setOfflineMode} />
                  </div>

                  {/* Model selector — free text + datalist suggestions */}
                  <div className="px-3.5 py-2.5">
                    <p className="text-[11px] font-medium text-muted-foreground mb-1.5">
                      Ollama Model
                    </p>
                    <input
                      list="ollama-models"
                      value={ollamaModel}
                      onChange={(e) => setOllamaModel(e.target.value)}
                      placeholder="e.g. qwen2.5:7b"
                      className="w-full bg-background border border-border rounded-lg px-3 py-2 text-xs font-mono text-foreground placeholder:text-muted-foreground/40 outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-colors"
                    />
                    <datalist id="ollama-models">
                      {OLLAMA_MODELS.map((m) => (
                        <option key={m} value={m} />
                      ))}
                    </datalist>
                  </div>
                </div>
              )}
            </div>

            {/* Error */}
            {error && (
              <div className="rounded-lg bg-destructive/10 border border-destructive/20 px-3 py-2 text-xs text-destructive">
                {error}
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 rounded-xl bg-primary text-primary-foreground font-semibold text-sm py-3 hover:bg-primary/90 active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg shadow-primary/20"
            >
              {loading ? (
                <>
                  <div className="h-3.5 w-3.5 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
                  Scanning Schema…
                </>
              ) : (
                <>
                  <Sparkles className="h-3.5 w-3.5" />
                  Connect &amp; Scan Schema
                </>
              )}
            </button>
          </form>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-center gap-1.5 mt-4 text-[11px] text-muted-foreground/40">
          <LockIcon className="h-2.5 w-2.5" />
          <span>Credentials saved locally on your device only.</span>
        </div>
      </div>
    </div>
  );
}
