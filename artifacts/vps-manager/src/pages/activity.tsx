import { useState, useEffect, useRef } from "react";
import { Activity, CheckCircle2, XCircle, Loader2, Trash2, RefreshCw, ChevronDown, ChevronUp, Globe, Server } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { ConfirmDialog } from "@/components/confirm-dialog";

interface LogEntry {
  id: number;
  siteId: number | null;
  serverId: number | null;
  siteName?: string | null;
  siteDomain?: string | null;
  serverName?: string | null;
  type: string;
  status: string;
  message: string;
  details?: string | null;
  createdAt: string;
}

const TYPE_LABELS: Record<string, string> = {
  deploy: "Deploy",
  ssl: "SSL",
  nginx_install: "Nginx",
  dns_setup: "DNS",
  connection_test: "Connection",
  error: "Error",
};

const TYPE_COLORS: Record<string, string> = {
  deploy: "bg-blue-900/40 text-blue-400 border-blue-800/50",
  ssl: "bg-emerald-900/40 text-emerald-400 border-emerald-800/50",
  nginx_install: "bg-amber-900/40 text-amber-400 border-amber-800/50",
  dns_setup: "bg-purple-900/40 text-purple-400 border-purple-800/50",
  connection_test: "bg-cyan-900/40 text-cyan-400 border-cyan-800/50",
  error: "bg-red-900/40 text-red-400 border-red-800/50",
};

const STATUS_ICON: Record<string, React.ReactNode> = {
  success: <CheckCircle2 className="h-4 w-4 text-emerald-400 flex-shrink-0" />,
  failure: <XCircle className="h-4 w-4 text-red-400 flex-shrink-0" />,
  running: <Loader2 className="h-4 w-4 text-amber-400 flex-shrink-0 animate-spin" />,
};

function useActivityLogs(typeFilter: string, statusFilter: string) {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");

  async function load(silent = false) {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    try {
      const params = new URLSearchParams();
      if (typeFilter !== "all") params.set("type", typeFilter);
      if (statusFilter !== "all") params.set("status", statusFilter);
      params.set("limit", "300");
      const r = await fetch(`${base}/api/activity?${params}`);
      const data = await r.json() as LogEntry[];
      setLogs(data);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => { void load(); }, [typeFilter, statusFilter]);

  const hasRunning = logs.some((l) => l.status === "running");
  useEffect(() => {
    if (!hasRunning) return;
    const t = setInterval(() => void load(true), 8000);
    return () => clearInterval(t);
  }, [hasRunning, typeFilter, statusFilter]);

  return { logs, loading, refreshing, reload: () => load(true) };
}

function LogRow({ entry }: { entry: LogEntry }) {
  const [expanded, setExpanded] = useState(false);
  const outputRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    if (expanded && outputRef.current) outputRef.current.scrollTop = outputRef.current.scrollHeight;
  }, [expanded, entry.details]);

  return (
    <div className="border-b border-border last:border-0">
      <div
        className="flex items-start gap-3 px-5 py-3.5 hover:bg-muted/20 transition-colors cursor-pointer"
        onClick={() => entry.details && setExpanded((v) => !v)}
      >
        <div className="mt-0.5">{STATUS_ICON[entry.status] ?? STATUS_ICON.success}</div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className={`text-[10px] font-bold uppercase tracking-wide border px-1.5 py-0.5 rounded ${TYPE_COLORS[entry.type] ?? "bg-muted text-muted-foreground border-border"}`}>
              {TYPE_LABELS[entry.type] ?? entry.type}
            </span>
            {entry.siteName && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <Globe className="h-3 w-3" />
                {entry.siteName}
                {entry.siteDomain && <span className="opacity-60">({entry.siteDomain})</span>}
              </span>
            )}
            {entry.serverName && !entry.siteName && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <Server className="h-3 w-3" />
                {entry.serverName}
              </span>
            )}
            <span className="text-xs text-muted-foreground ml-auto">
              {new Date(entry.createdAt).toLocaleString()}
            </span>
          </div>
          <p className="text-sm">{entry.message}</p>
        </div>
        {entry.details && (
          <div className="text-muted-foreground mt-0.5 flex-shrink-0">
            {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </div>
        )}
      </div>
      {expanded && entry.details && (
        <div className="px-5 pb-4">
          <pre
            ref={outputRef}
            className="text-xs font-mono bg-black/60 text-green-300 p-4 rounded-lg overflow-auto max-h-96 whitespace-pre-wrap break-words border border-border leading-relaxed"
          >
            {entry.details}
          </pre>
        </div>
      )}
    </div>
  );
}

const TYPE_TABS = [
  { value: "all", label: "All" },
  { value: "deploy", label: "Deploy" },
  { value: "ssl", label: "SSL" },
  { value: "nginx_install", label: "Nginx" },
  { value: "dns_setup", label: "DNS" },
  { value: "connection_test", label: "Connection" },
  { value: "error", label: "Error" },
];

export default function ActivityPage() {
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [clearConfirm, setClearConfirm] = useState(false);
  const { toast } = useToast();
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");

  const { logs, loading, refreshing, reload } = useActivityLogs(typeFilter, statusFilter);

  const filtered = search
    ? logs.filter((l) => l.message.toLowerCase().includes(search.toLowerCase()) || l.siteName?.toLowerCase().includes(search.toLowerCase()) || l.siteDomain?.toLowerCase().includes(search.toLowerCase()))
    : logs;

  async function clearLogs() {
    await fetch(`${base}/api/activity`, { method: "DELETE" });
    toast({ title: "Logs cleared" });
    reload();
  }

  const hasRunning = logs.some((l) => l.status === "running");

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Deployment Logs</h1>
          <p className="text-muted-foreground mt-1">All activity and output from your servers.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={reload}
            className="flex items-center gap-1.5 text-xs bg-muted hover:bg-muted/70 px-3 py-2 rounded-lg transition-colors"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
            Refresh
          </button>
          <button
            onClick={() => setClearConfirm(true)}
            className="flex items-center gap-1.5 text-xs bg-red-900/30 hover:bg-red-900/50 text-red-400 border border-red-800/50 px-3 py-2 rounded-lg transition-colors"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Clear logs
          </button>
        </div>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex rounded-lg border border-border overflow-hidden text-xs">
          {TYPE_TABS.map((tab) => (
            <button
              key={tab.value}
              onClick={() => setTypeFilter(tab.value)}
              className={`px-3 py-1.5 transition-colors border-r border-border last:border-0 ${typeFilter === tab.value ? "bg-primary text-primary-foreground" : "hover:bg-muted/50"}`}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className="flex rounded-lg border border-border overflow-hidden text-xs">
          {[{ v: "all", l: "All statuses" }, { v: "success", l: "Success" }, { v: "failure", l: "Failed" }, { v: "running", l: "Running" }].map((s) => (
            <button
              key={s.v}
              onClick={() => setStatusFilter(s.v)}
              className={`px-3 py-1.5 transition-colors border-r border-border last:border-0 ${statusFilter === s.v ? "bg-primary text-primary-foreground" : "hover:bg-muted/50"}`}
            >
              {s.l}
            </button>
          ))}
        </div>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search logs..."
          className="rounded-lg border border-border bg-background px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
        />
        {hasRunning && (
          <span className="flex items-center gap-1.5 text-xs text-amber-400 animate-pulse">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Live — auto-refreshing
          </span>
        )}
        <span className="text-xs text-muted-foreground ml-auto">{filtered.length} entries</span>
      </div>

      <div className="rounded-xl border border-border bg-card overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground gap-2">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="text-sm">Loading logs...</span>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Activity className="h-10 w-10 text-muted-foreground mb-3" />
            <p className="text-muted-foreground text-sm">No logs found.</p>
          </div>
        ) : (
          filtered.map((entry) => <LogRow key={entry.id} entry={entry} />)
        )}
      </div>

      <ConfirmDialog
        open={clearConfirm}
        title="Clear all logs?"
        description="This will permanently delete all activity logs. This cannot be undone."
        confirmLabel="Clear all"
        onConfirm={() => { setClearConfirm(false); void clearLogs(); }}
        onCancel={() => setClearConfirm(false)}
      />
    </div>
  );
}
