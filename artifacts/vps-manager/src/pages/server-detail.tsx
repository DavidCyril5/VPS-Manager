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
import { ArrowLeft, Cpu, RefreshCw, Settings2, Wifi, CheckCircle2, XCircle, Loader2, Trash2, ScanSearch, AlertTriangle, HardDrive, FileX, Skull } from "lucide-react";
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

interface DiskScan {
  diskUsage: string;
  nginxLogs: string;
  journal: string;
  aptCache: string;
  nginxConfigs: string;
  tmp: string;
  home: string;
  cfgFiles: string[];
  largeDirs: { size: string; path: string }[];
  largeFiles: { size: string; path: string }[];
}

interface CleanupOptions {
  nginxLogs: boolean;
  journal: boolean;
  aptCache: boolean;
  tmp: boolean;
  orphanConfigs: string[];
}

function DiskCleanupPanel({ serverId }: { serverId: number }) {
  const { toast } = useToast();
  const [scanning, setScanning] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const [scan, setScan] = useState<DiskScan | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [cleanLog, setCleanLog] = useState<string | null>(null);
  const [deletingPath, setDeletingPath] = useState<string | null>(null);
  const [customPath, setCustomPath] = useState("");
  const [selected, setSelected] = useState<CleanupOptions>({
    nginxLogs: false,
    journal: false,
    aptCache: false,
    tmp: false,
    orphanConfigs: [],
  });

  const base = (import.meta.env.BASE_URL as string).replace(/\/$/, "");
  const token = localStorage.getItem("vpm-token");
  const headers = { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) };

  async function deletePath(path: string) {
    setDeletingPath(path);
    setCleanLog(null);
    try {
      const r = await fetch(`${base}/api/servers/${serverId}/delete-path`, {
        method: "POST",
        headers,
        body: JSON.stringify({ path }),
      });
      const data = await r.json() as { success: boolean; output: string; error?: string };
      if (!r.ok) {
        toast({ title: data.error ?? "Delete failed", variant: "destructive" });
        setCleanLog(`ERROR: ${data.error ?? "Delete failed"}`);
      } else {
        setCleanLog(data.output);
        toast({ title: data.success ? `Deleted ${path}` : "Delete had issues — check output", variant: data.success ? "default" : "destructive" });
        if (data.success) {
          setCustomPath("");
          await runScan();
        }
      }
    } catch {
      toast({ title: "Request failed", variant: "destructive" });
    } finally {
      setDeletingPath(null);
    }
  }

  async function runScan() {
    setScanning(true);
    setScanError(null);
    setScan(null);
    setCleanLog(null);
    setSelected({ nginxLogs: false, journal: false, aptCache: false, tmp: false, orphanConfigs: [] });
    try {
      const r = await fetch(`${base}/api/servers/${serverId}/disk-scan`, { headers });
      if (!r.ok) throw new Error(await r.text());
      const data = await r.json() as DiskScan;
      setScan(data);
    } catch (e: unknown) {
      setScanError((e as Error).message ?? "Scan failed");
    } finally {
      setScanning(false);
    }
  }

  async function runCleanup() {
    if (!selected.nginxLogs && !selected.journal && !selected.aptCache && !selected.tmp && selected.orphanConfigs.length === 0) {
      toast({ title: "Nothing selected to clean", variant: "destructive" });
      return;
    }
    setCleaning(true);
    setCleanLog(null);
    try {
      const r = await fetch(`${base}/api/servers/${serverId}/disk-cleanup`, {
        method: "POST",
        headers,
        body: JSON.stringify(selected),
      });
      const data = await r.json() as { success: boolean; output: string };
      setCleanLog(data.output);
      if (data.success) {
        toast({ title: "Cleanup complete — re-scanning..." });
        await runScan();
      } else {
        toast({ title: "Cleanup had issues", description: "Check the output below", variant: "destructive" });
      }
    } catch (e: unknown) {
      toast({ title: "Cleanup request failed", variant: "destructive" });
    } finally {
      setCleaning(false);
    }
  }

  function toggleOrphan(name: string) {
    setSelected((prev) => {
      const has = prev.orphanConfigs.includes(name);
      return { ...prev, orphanConfigs: has ? prev.orphanConfigs.filter((x) => x !== name) : [...prev.orphanConfigs, name] };
    });
  }

  function selectAll() {
    if (!scan) return;
    setSelected({ nginxLogs: true, journal: true, aptCache: true, tmp: true, orphanConfigs: [...scan.cfgFiles] });
  }

  const anySelected = selected.nginxLogs || selected.journal || selected.aptCache || selected.tmp || selected.orphanConfigs.length > 0;

  return (
    <div className="rounded-xl border border-border bg-card p-6 space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold flex items-center gap-2">
          <HardDrive className="h-4 w-4 text-muted-foreground" />
          Disk Cleanup
        </h2>
        <div className="flex items-center gap-2">
          {scan && (
            <button
              onClick={selectAll}
              className="text-xs text-amber-400 hover:text-amber-300 px-2 py-1 rounded-md hover:bg-amber-900/20 transition-colors"
            >
              Select All
            </button>
          )}
          <button
            onClick={runScan}
            disabled={scanning}
            className="flex items-center gap-1.5 text-xs bg-muted text-foreground px-3 py-1.5 rounded-lg font-medium hover:opacity-90 disabled:opacity-50"
          >
            {scanning ? <Loader2 className="h-3 w-3 animate-spin" /> : <ScanSearch className="h-3 w-3" />}
            {scanning ? "Scanning…" : scan ? "Re-scan" : "Scan Disk"}
          </button>
          {scan && anySelected && (
            <button
              onClick={runCleanup}
              disabled={cleaning}
              className="flex items-center gap-1.5 text-xs bg-red-600 text-white px-3 py-1.5 rounded-lg font-medium hover:bg-red-700 disabled:opacity-50"
            >
              {cleaning ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
              {cleaning ? "Cleaning…" : "Clean Selected"}
            </button>
          )}
        </div>
      </div>

      {!scan && !scanning && !scanError && (
        <p className="text-sm text-muted-foreground">
          Click <strong>Scan Disk</strong> to see what's using space and clean it up.
        </p>
      )}

      {scanError && (
        <div className="flex items-start gap-2 text-red-400 text-sm bg-red-900/20 rounded-lg p-3">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>{scanError}</span>
        </div>
      )}

      {scan && (
        <div className="space-y-4">
          {/* Disk overview */}
          <div className="bg-muted/40 rounded-lg px-4 py-3 flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Disk (used / free / use%)</span>
            <span className="font-mono font-medium">{scan.diskUsage.replace(/\|/g, " / ")}</span>
          </div>

          {/* Cleanable items */}
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Select items to clean</p>

            <CleanRow
              label="Nginx logs"
              sublabel="/var/log/nginx — access & error logs"
              size={scan.nginxLogs}
              checked={selected.nginxLogs}
              onChange={(v) => setSelected((p) => ({ ...p, nginxLogs: v }))}
            />
            <CleanRow
              label="Journal logs"
              sublabel="systemd journal — trimmed to 20 MB"
              size={scan.journal}
              checked={selected.journal}
              onChange={(v) => setSelected((p) => ({ ...p, journal: v }))}
            />
            <CleanRow
              label="Package cache"
              sublabel="apt/yum cache — safe to remove"
              size={scan.aptCache}
              checked={selected.aptCache}
              onChange={(v) => setSelected((p) => ({ ...p, aptCache: v }))}
            />
            <CleanRow
              label="/tmp old files"
              sublabel="Files older than 1 day"
              size={scan.tmp}
              checked={selected.tmp}
              onChange={(v) => setSelected((p) => ({ ...p, tmp: v }))}
            />
          </div>

          {/* Nginx config files */}
          {scan.cfgFiles.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider flex items-center gap-1.5">
                <FileX className="h-3 w-3" />
                Nginx site configs on disk ({scan.cfgFiles.length}) — select orphans to delete
              </p>
              <div className="rounded-lg border border-border overflow-hidden divide-y divide-border">
                {scan.cfgFiles.map((cfg) => (
                  <label key={cfg} className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/30 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selected.orphanConfigs.includes(cfg)}
                      onChange={() => toggleOrphan(cfg)}
                      className="h-3.5 w-3.5 accent-red-500"
                    />
                    <span className="font-mono text-xs text-foreground flex-1">{cfg}</span>
                    <span className="text-xs text-muted-foreground">nginx config</span>
                  </label>
                ))}
              </div>
              <p className="text-xs text-amber-400/80">
                ⚠ Only tick configs for sites you've already deleted. Removing an active site config will take it offline.
              </p>
            </div>
          )}

          {scan.cfgFiles.length === 0 && (
            <p className="text-xs text-emerald-400/80">✓ No nginx site configs found on disk.</p>
          )}

          {/* Large directories — what's actually eating space */}
          {scan.largeDirs.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider flex items-center gap-1.5">
                <HardDrive className="h-3 w-3" />
                Top space hogs — click Delete to free the space
              </p>
              <div className="rounded-lg border border-border overflow-hidden">
                <div className="divide-y divide-border max-h-80 overflow-y-auto">
                  {scan.largeDirs.map((d, i) => (
                    <div key={i} className="flex items-center gap-3 px-3 py-2 hover:bg-muted/20">
                      <span className={`font-mono text-xs font-bold w-14 shrink-0 ${i < 5 ? "text-red-400" : i < 10 ? "text-amber-400" : "text-muted-foreground"}`}>{d.size}</span>
                      <span className="font-mono text-xs text-foreground flex-1 truncate">{d.path}</span>
                      <button
                        onClick={() => deletePath(d.path)}
                        disabled={deletingPath === d.path}
                        className="shrink-0 text-xs text-red-500 hover:text-red-400 hover:bg-red-900/20 px-2 py-1 rounded disabled:opacity-40 transition-colors"
                      >
                        {deletingPath === d.path ? <Loader2 className="h-3 w-3 animate-spin inline" /> : "Delete"}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Large files */}
          {scan.largeFiles.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Large files (&gt;100 MB)</p>
              <div className="rounded-lg border border-border overflow-hidden">
                <div className="divide-y divide-border max-h-48 overflow-y-auto">
                  {scan.largeFiles.map((f, i) => (
                    <div key={i} className="flex items-center gap-3 px-3 py-2 hover:bg-muted/20">
                      <span className="font-mono text-xs font-bold w-14 shrink-0 text-amber-400">{f.size}</span>
                      <span className="font-mono text-xs text-foreground flex-1 truncate">{f.path}</span>
                      <button
                        onClick={() => deletePath(f.path)}
                        disabled={deletingPath === f.path}
                        className="shrink-0 text-xs text-red-500 hover:text-red-400 hover:bg-red-900/20 px-2 py-1 rounded disabled:opacity-40 transition-colors"
                      >
                        {deletingPath === f.path ? <Loader2 className="h-3 w-3 animate-spin inline" /> : "Delete"}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Custom path delete */}
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Delete custom path</p>
            <div className="flex gap-2">
              <input
                type="text"
                value={customPath}
                onChange={(e) => setCustomPath(e.target.value)}
                placeholder="/var/lib/docker  or  /home/ubuntu/old-backups"
                className="flex-1 bg-muted/30 border border-border rounded-lg px-3 py-2 text-xs font-mono text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-red-500/50"
              />
              <button
                onClick={() => { if (customPath.trim()) deletePath(customPath.trim()); }}
                disabled={!customPath.trim() || deletingPath === customPath.trim()}
                className="shrink-0 text-xs bg-red-700 hover:bg-red-600 disabled:opacity-40 text-white px-3 py-2 rounded-lg font-medium transition-colors"
              >
                {deletingPath === customPath.trim() ? <Loader2 className="h-3 w-3 animate-spin inline" /> : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}

      {cleanLog && (
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground font-medium">Cleanup output</p>
          <pre className="bg-black/40 rounded-lg p-3 text-xs font-mono text-slate-300 whitespace-pre-wrap max-h-64 overflow-y-auto">{cleanLog}</pre>
        </div>
      )}
    </div>
  );
}

function CleanRow({ label, sublabel, size, checked, onChange }: {
  label: string;
  sublabel: string;
  size: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-3 rounded-lg border border-border px-4 py-3 hover:bg-muted/30 cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-3.5 w-3.5 accent-red-500"
      />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">{sublabel}</p>
      </div>
      <span className={`text-sm font-mono font-semibold ${size !== "0" && size !== "0B" ? "text-amber-400" : "text-muted-foreground"}`}>
        {size}
      </span>
    </label>
  );
}

interface NukeOptions {
  nginxConfigs: boolean;
  siteFiles: boolean;
  nginxLogs: boolean;
  pm2: boolean;
  aptCache: boolean;
  journal: boolean;
}

function NukePanel({ serverId, serverName }: { serverId: number; serverName: string }) {
  const { toast } = useToast();
  const [expanded, setExpanded] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [nuking, setNuking] = useState(false);
  const [output, setOutput] = useState<string | null>(null);
  const [options, setOptions] = useState<NukeOptions>({
    nginxConfigs: false,
    siteFiles: false,
    nginxLogs: false,
    pm2: false,
    aptCache: false,
    journal: false,
  });

  const base = (import.meta.env.BASE_URL as string).replace(/\/$/, "");
  const token = localStorage.getItem("vpm-token");
  const headers = { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) };

  const anySelected = Object.values(options).some(Boolean);
  const confirmed = confirm.trim() === serverName.trim();

  async function runNuke() {
    if (!anySelected || !confirmed) return;
    setNuking(true);
    setOutput(null);
    try {
      const r = await fetch(`${base}/api/servers/${serverId}/nuke`, {
        method: "POST",
        headers,
        body: JSON.stringify({ ...options, confirm }),
      });
      const data = await r.json() as { success: boolean; output: string; error?: string };
      if (!r.ok) {
        setOutput(`ERROR: ${data.error ?? "Nuke failed"}`);
        toast({ title: data.error ?? "Nuke failed", variant: "destructive" });
      } else {
        setOutput(data.output);
        toast({ title: data.success ? "Nuke complete" : "Nuke finished with issues", variant: data.success ? "default" : "destructive" });
        setConfirm("");
        setOptions({ nginxConfigs: false, siteFiles: false, nginxLogs: false, pm2: false, aptCache: false, journal: false });
      }
    } catch {
      toast({ title: "Request failed", variant: "destructive" });
    } finally {
      setNuking(false);
    }
  }

  return (
    <div className="rounded-xl border-2 border-red-900/60 bg-red-950/10 p-6 space-y-4">
      <button
        className="w-full flex items-center justify-between group"
        onClick={() => setExpanded((v) => !v)}
      >
        <div className="flex items-center gap-2">
          <Skull className="h-4 w-4 text-red-500" />
          <h2 className="text-base font-semibold text-red-400">Nuke VPS</h2>
          <span className="text-xs bg-red-900/40 text-red-400 px-2 py-0.5 rounded-full font-medium">DESTRUCTIVE</span>
        </div>
        <span className="text-xs text-red-500/60 group-hover:text-red-400 transition-colors">
          {expanded ? "▲ hide" : "▼ expand"}
        </span>
      </button>

      {expanded && (
        <div className="space-y-5">
          <div className="flex items-start gap-2 bg-red-900/20 border border-red-800/40 rounded-lg p-3">
            <AlertTriangle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
            <p className="text-xs text-red-300">
              This permanently deletes selected data from your VPS. There is no undo. Use this to wipe old configs, files, and logs in one shot.
            </p>
          </div>

          <div className="space-y-2">
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Select what to destroy</p>

            <NukeRow
              label="All nginx site configs"
              sublabel="Removes every config in sites-available / conf.d and reloads nginx"
              checked={options.nginxConfigs}
              onChange={(v) => setOptions((p) => ({ ...p, nginxConfigs: v }))}
            />
            <NukeRow
              label="All site files in /var/www"
              sublabel="Deletes every folder inside /var/www (keeps /var/www/html)"
              checked={options.siteFiles}
              onChange={(v) => setOptions((p) => ({ ...p, siteFiles: v }))}
            />
            <NukeRow
              label="All nginx logs"
              sublabel="Truncates access.log and error.log + deletes rotated .gz logs"
              checked={options.nginxLogs}
              onChange={(v) => setOptions((p) => ({ ...p, nginxLogs: v }))}
            />
            <NukeRow
              label="All PM2 processes"
              sublabel="Runs pm2 delete all — kills every Node.js app"
              checked={options.pm2}
              onChange={(v) => setOptions((p) => ({ ...p, pm2: v }))}
            />
            <NukeRow
              label="Journal logs"
              sublabel="Vacuums systemd journal down to 10 MB"
              checked={options.journal}
              onChange={(v) => setOptions((p) => ({ ...p, journal: v }))}
            />
            <NukeRow
              label="APT / YUM package cache"
              sublabel="Clears downloaded package files"
              checked={options.aptCache}
              onChange={(v) => setOptions((p) => ({ ...p, aptCache: v }))}
            />
          </div>

          {anySelected && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <label className="text-xs text-red-400 font-medium">
                  Type <span className="font-mono bg-red-900/30 px-1 rounded">{serverName}</span> to confirm
                </label>
                <input
                  type="text"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  placeholder={serverName}
                  className="w-full bg-black/30 border border-red-900/50 rounded-lg px-3 py-2 text-sm font-mono text-red-200 placeholder:text-red-900 focus:outline-none focus:border-red-500"
                />
              </div>

              <button
                onClick={runNuke}
                disabled={!confirmed || nuking}
                className="w-full flex items-center justify-center gap-2 bg-red-700 hover:bg-red-600 disabled:bg-red-900/40 disabled:text-red-800 text-white font-bold py-2.5 rounded-lg transition-colors"
              >
                {nuking ? (
                  <><Loader2 className="h-4 w-4 animate-spin" /> Nuking…</>
                ) : (
                  <><Skull className="h-4 w-4" /> NUKE NOW</>
                )}
              </button>
            </div>
          )}

          {output && (
            <div className="space-y-1">
              <p className="text-xs text-red-400/80 font-medium">Nuke output</p>
              <pre className="bg-black/60 border border-red-900/30 rounded-lg p-3 text-xs font-mono text-slate-300 whitespace-pre-wrap max-h-64 overflow-y-auto">{output}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function NukeRow({ label, sublabel, checked, onChange }: {
  label: string;
  sublabel: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-start gap-3 rounded-lg border border-red-900/30 hover:border-red-700/50 px-4 py-3 hover:bg-red-900/10 cursor-pointer transition-colors">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-3.5 w-3.5 mt-0.5 accent-red-500 shrink-0"
      />
      <div>
        <p className="text-sm font-medium text-red-200">{label}</p>
        <p className="text-xs text-red-400/70">{sublabel}</p>
      </div>
    </label>
  );
}

export default function ServerDetail() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [nginxLive, setNginxLive] = useState<{ installed: boolean; version: string | null } | null>(null);
  const [checkingNginx, setCheckingNginx] = useState(false);
  const [installingNode, setInstallingNode] = useState(false);
  const [nodeLive, setNodeLive] = useState<{ installed: boolean; version: string | null } | null>(null);
  const [checkingNode, setCheckingNode] = useState(false);

  const { data: server, isLoading } = useGetServer(id, { query: { enabled: !!id } });
  const { data: stats, refetch: refetchStats, isFetching: fetchingStats } = useGetServerStats(id, { query: { enabled: !!id } });
  const testConn = useTestServerConnection();
  const installNginx = useInstallNginx();

  async function handleNodeCheck() {
    setCheckingNode(true);
    try {
      const token = localStorage.getItem("vpm-token");
      const res = await fetch(`/api/servers/${id}/node-status`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const data = await res.json();
      setNodeLive({ installed: data.installed, version: data.version });
      toast({
        title: data.installed ? `Node.js is installed${data.version ? ` (v${data.version})` : ""}` : "Node.js is NOT installed",
        variant: data.installed ? "default" : "destructive",
      });
    } catch {
      toast({ title: "Check failed", variant: "destructive" });
    } finally {
      setCheckingNode(false);
    }
  }

  async function handleInstallNode() {
    setInstallingNode(true);
    toast({ title: "Installing Node.js 20...", description: "This may take a minute." });
    try {
      const token = localStorage.getItem("vpm-token");
      const res = await fetch(`/api/servers/${id}/install-node`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      });
      const data = await res.json();
      setNodeLive({ installed: data.success, version: data.output?.match(/v(\d+\.\d+\.\d+)/)?.[1] ?? null });
      toast({
        title: data.success ? "Node.js installed successfully" : "Node.js installation failed",
        description: data.success ? (data.output?.match(/v\d+\.\d+\.\d+/)?.[0] ?? "") : data.message,
        variant: data.success ? "default" : "destructive",
      });
    } catch {
      toast({ title: "Installation failed", variant: "destructive" });
    } finally {
      setInstallingNode(false);
    }
  }

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
            onClick={handleInstallNode}
            disabled={installingNode}
            className="flex items-center gap-2 bg-muted text-foreground px-4 py-2 rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-50"
          >
            {installingNode ? <Loader2 className="h-4 w-4 animate-spin" /> : <Cpu className="h-4 w-4" />}
            {installingNode ? "Installing..." : "Install Node.js"}
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

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
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
        <div className="rounded-xl border border-border bg-card p-6">
          <div className="flex items-center justify-between mb-1">
            <div className="text-sm text-muted-foreground">Node.js</div>
            <button
              onClick={handleNodeCheck}
              disabled={checkingNode}
              className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
              title="Check if Node.js is installed"
            >
              {checkingNode ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
              Check
            </button>
          </div>
          <div className="flex items-center gap-2">
            {nodeLive !== null && (
              nodeLive.installed
                ? <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
                : <XCircle className="h-4 w-4 text-red-400 shrink-0" />
            )}
            <div className={`font-semibold ${
              nodeLive !== null
                ? nodeLive.installed ? "text-emerald-400" : "text-red-400"
                : "text-muted-foreground"
            }`}>
              {nodeLive !== null
                ? nodeLive.installed
                  ? nodeLive.version ? `v${nodeLive.version}` : "Installed ✓"
                  : "Not installed"
                : "Unknown"}
            </div>
          </div>
          {nodeLive === null && (
            <div className="text-xs text-muted-foreground mt-1">Click Check to verify live</div>
          )}
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

      <DiskCleanupPanel serverId={id} />
      <NukePanel serverId={id} serverName={server.name ?? ""} />
    </div>
  );
}
