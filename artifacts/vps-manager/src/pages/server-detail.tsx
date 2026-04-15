import { useState } from "react";
import { useParams } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetServer,
  useGetServerStats,
  useTestServerConnection,
  useInstallNginx,
  getListServersQueryKey,
  getGetServerQueryKey,
} from "@workspace/api-client-react";
import { ArrowLeft, Cpu, RefreshCw, Settings2, Wifi, CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { Link } from "wouter";
import { useToast } from "@/hooks/use-toast";

function pct(used: number, total: number) {
  if (!total) return 0;
  return Math.round((used / total) * 100);
}

function StatBar({ label, used, total, unit }: { label: string; used: number; total: number; unit: string }) {
  const p = pct(used, total);
  return (
    <div>
      <div className="flex justify-between text-sm mb-1">
        <span className="text-muted-foreground">{label}</span>
        <span>{used.toLocaleString()} / {total.toLocaleString()} {unit}</span>
      </div>
      <div className="h-2 bg-muted rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${p > 80 ? "bg-red-500" : p > 60 ? "bg-amber-500" : "bg-emerald-500"}`}
          style={{ width: `${p}%` }}
        />
      </div>
    </div>
  );
}

export default function ServerDetail() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [nginxLive, setNginxLive] = useState<{ installed: boolean; version: string | null } | null>(null);
  const [checkingNginx, setCheckingNginx] = useState(false);

  const { data: server, isLoading } = useGetServer(id, { query: { enabled: !!id } });
  const { data: stats, refetch: refetchStats, isFetching: fetchingStats } = useGetServerStats(id, { query: { enabled: !!id } });
  const testConn = useTestServerConnection();
  const installNginx = useInstallNginx();

  async function handleNginxCheck() {
    setCheckingNginx(true);
    try {
      const token = localStorage.getItem("vpm-token");
      const res = await fetch(`/api/servers/${id}/nginx-status`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const data = await res.json();
      setNginxLive({ installed: data.installed, version: data.version });
      queryClient.invalidateQueries({ queryKey: getGetServerQueryKey(id) });
      queryClient.invalidateQueries({ queryKey: getListServersQueryKey() });
      toast({
        title: data.installed ? `Nginx is installed${data.version ? ` (v${data.version})` : ""}` : "Nginx is NOT installed",
        variant: data.installed ? "default" : "destructive",
      });
    } catch {
      toast({ title: "Check failed", variant: "destructive" });
    } finally {
      setCheckingNginx(false);
    }
  }

  function handleTest() {
    testConn.mutate(
      { id },
      {
        onSuccess: (result) => {
          queryClient.invalidateQueries({ queryKey: getGetServerQueryKey(id) });
          queryClient.invalidateQueries({ queryKey: getListServersQueryKey() });
          toast({
            title: result.success ? "Connection successful" : "Connection failed",
            description: result.message,
            variant: result.success ? "default" : "destructive",
          });
        },
      }
    );
  }

  function handleNginx() {
    toast({ title: "Installing Nginx...", description: "This may take a minute." });
    installNginx.mutate(
      { id },
      {
        onSuccess: (result) => {
          queryClient.invalidateQueries({ queryKey: getGetServerQueryKey(id) });
          queryClient.invalidateQueries({ queryKey: getListServersQueryKey() });
          toast({
            title: result.success ? "Nginx installed" : "Nginx install failed",
            variant: result.success ? "default" : "destructive",
          });
        },
      }
    );
  }

  if (isLoading) return <div className="text-muted-foreground">Loading...</div>;
  if (!server) return <div className="text-muted-foreground">Server not found.</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/servers" className="text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{server.name}</h1>
          <p className="text-muted-foreground">{server.username}@{server.host}:{server.port}</p>
        </div>
        <div className="ml-auto flex gap-2">
          <button
            onClick={handleTest}
            disabled={testConn.isPending}
            className="flex items-center gap-2 bg-muted text-foreground px-4 py-2 rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-50"
          >
            <Wifi className="h-4 w-4" />
            Test Connection
          </button>
          <button
            onClick={handleNginx}
            disabled={installNginx.isPending}
            className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-50"
          >
            <Settings2 className="h-4 w-4" />
            {installNginx.isPending ? "Installing..." : server.nginxInstalled ? "Reinstall Nginx" : "Install Nginx"}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="rounded-xl border border-border bg-card p-6">
          <div className="text-sm text-muted-foreground mb-1">Status</div>
          <div className={`font-semibold capitalize ${server.status === "connected" ? "text-emerald-400" : server.status === "disconnected" ? "text-red-400" : "text-muted-foreground"}`}>
            {server.status}
          </div>
        </div>
        <div className="rounded-xl border border-border bg-card p-6">
          <div className="flex items-center justify-between mb-1">
            <div className="text-sm text-muted-foreground">Nginx</div>
            <button
              onClick={handleNginxCheck}
              disabled={checkingNginx}
              className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
              title="Run a live check on the server"
            >
              {checkingNginx ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
              Check
            </button>
          </div>
          <div className="flex items-center gap-2">
            {nginxLive !== null ? (
              nginxLive.installed ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
              ) : (
                <XCircle className="h-4 w-4 text-red-400 shrink-0" />
              )
            ) : null}
            <div className={`font-semibold ${
              nginxLive !== null
                ? nginxLive.installed ? "text-emerald-400" : "text-red-400"
                : server.nginxInstalled ? "text-emerald-400" : "text-muted-foreground"
            }`}>
              {nginxLive !== null
                ? nginxLive.installed
                  ? nginxLive.version ? `v${nginxLive.version}` : "Installed ✓"
                  : "Not installed"
                : server.nginxInstalled ? "Installed (cached)" : "Not installed"}
            </div>
          </div>
          {nginxLive === null && (
            <div className="text-xs text-muted-foreground mt-1">Click Check to verify live</div>
          )}
        </div>
        <div className="rounded-xl border border-border bg-card p-6">
          <div className="text-sm text-muted-foreground mb-1">Uptime</div>
          <div className="font-semibold">{stats?.uptime ?? "—"}</div>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold flex items-center gap-2">
            <Cpu className="h-4 w-4 text-muted-foreground" />
            Resource Usage
          </h2>
          <button
            onClick={() => refetchStats()}
            disabled={fetchingStats}
            className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
          >
            <RefreshCw className={`h-3 w-3 ${fetchingStats ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>
        {stats ? (
          <div className="space-y-4">
            <div>
              <div className="flex justify-between text-sm mb-1">
                <span className="text-muted-foreground flex items-center gap-1"><Cpu className="h-3 w-3" /> CPU</span>
                <span>{stats.cpu.toFixed(1)}%</span>
              </div>
              <div className="h-2 bg-muted rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${stats.cpu > 80 ? "bg-red-500" : stats.cpu > 60 ? "bg-amber-500" : "bg-emerald-500"}`}
                  style={{ width: `${stats.cpu}%` }}
                />
              </div>
            </div>
            <StatBar label="Memory (MB)" used={stats.memoryUsed} total={stats.memoryTotal} unit="MB" />
            <StatBar label="Disk (KB)" used={stats.diskUsed} total={stats.diskTotal} unit="KB" />
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Click Refresh or Test Connection to load stats.</p>
        )}
      </div>
    </div>
  );
}
