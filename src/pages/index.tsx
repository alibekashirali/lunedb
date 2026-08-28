import { useEffect, useState } from "react";
import Head from "next/head";
import { useAppStore } from "@/store/useAppStore";
import { OnboardingScreen } from "@/components/layout/OnboardingScreen";
import { AppShell } from "@/components/layout/AppShell";
import { WorkspaceLayout } from "@/components/layout/WorkspaceLayout";
import { getSavedConnections, updateConnectionLastUsed } from "@/lib/wiki-db";
import {
  connectPostgres,
  getConnectionPassword,
  getSshPassword,
  getSchema,
  getViews,
  getFunctions,
  getMatViews,
} from "@/lib/tauri-commands";

export default function Home() {
  const {
    connectionStatus,
    setConnectionStatus,
    setSchema,
    setViews,
    setMatViews,
    setFunctions,
    setSavedConnections,
    setCurrentConnectionId,
  } = useAppStore();

  const [isInitializing, setIsInitializing] = useState(true);

  useEffect(() => {
    async function tryAutoConnect() {
      try {
        const conns = await getSavedConnections();
        setSavedConnections(conns);

        if (conns.length === 0) {
          setIsInitializing(false);
          return;
        }

        // conns[0] is the most recently used (ordered by last_used_at DESC)
        const last = conns[0];
        setConnectionStatus("connecting");

        const password = await getConnectionPassword(last.id);
        const sshPassword = last.ssh_enabled ? await getSshPassword(last.id) : undefined;
        const result = await connectPostgres({
          host: last.host,
          port: last.port,
          user: last.username,
          password,
          database: last.database,
          ssl_mode: last.ssl_mode,
          ssl_ca_cert: last.ssl_ca_cert || undefined,
          ssh_enabled: !!last.ssh_enabled,
          ssh_host: last.ssh_host || undefined,
          ssh_port: last.ssh_port || undefined,
          ssh_user: last.ssh_user || undefined,
          ssh_password: sshPassword || undefined,
          ssh_key_path: last.ssh_key_path || undefined,
          ssh_auth: last.ssh_auth === "key" ? "key" : "password",
        });

        if (result.success) {
          const [tables, viewList, fnList, matViewList] = await Promise.all([
            getSchema(),
            getViews(),
            getFunctions(),
            getMatViews(),
          ]);
          setSchema(tables);
          setViews(viewList);
          setFunctions(fnList);
          setMatViews(matViewList);
          setCurrentConnectionId(last.id);
          await updateConnectionLastUsed(last.id);
          setConnectionStatus("connected");
        } else {
          // Connection failed (db might be down) — show workspace so user can pick another
          setConnectionStatus("error", result.message);
        }
      } catch {
        setConnectionStatus("disconnected");
      } finally {
        setIsInitializing(false);
      }
    }

    tryAutoConnect();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (isInitializing) {
    return (
      <div className="h-screen bg-background flex items-center justify-center">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <div className="h-4 w-4 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
          Connecting…
        </div>
      </div>
    );
  }

  return (
    <>
      <Head>
        <title>LuneDB</title>
        <meta name="description" content="Local-First AI Database Client" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="/favicon.ico" />
      </Head>

      {connectionStatus === "disconnected" ? (
        <div className="h-screen flex flex-col bg-background">
          <OnboardingScreen onConnected={() => {}} />
        </div>
      ) : (
        <AppShell>
          <WorkspaceLayout />
        </AppShell>
      )}
    </>
  );
}
