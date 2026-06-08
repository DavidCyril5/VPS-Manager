import { useEffect, useRef, useState } from "react";
import { X, ScrollText, Wifi, WifiOff, Trash2 } from "lucide-react";

interface SiteLogsModalProps {
  siteId: number;
  domain: string;
  onClose: () => void;
}

type LogType = "access" | "error";

export function SiteLogsModal({ siteId, domain, onClose }: SiteLogsModalProps) {
  const [chunks, setChunks] = useState<string[]>([]);
  const [logType, setLogType] = useState<LogType>("access");
  const [connected, setConnected] = useState(false);
  const [lineCount, setLineCount] = useState(0);
  const [clearing, setClearing] = useState(false);
  const [clearMsg, setClearMsg] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const esRef = useRef<EventSource | null>(null);
  const base = (import.meta.env.BASE_URL as string).replace(/\/$/, "");

  function connect(type: LogType) {
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }
    setChunks([]);
    setLineCount(0);
    setConnected(false);

    const es = new EventSource(`${base}/api/sites/${siteId}/logs/stream?type=${type}`);
    esRef.current = es;

    es.onopen = () => setConnected(true);

    es.onmessage = (e: MessageEvent) => {
      const data = JSON.parse(e.data as string) as { text: string };
      setConnected(true);
      setChunks((prev) => {
        const next = [...prev, data.text];
        return next.length > 500 ? next.slice(next.length - 500) : next;
      });
      setLineCount((n) => n + (data.text.match(/\n/g)?.length ?? 1));
      setTimeout(() => {
        if (scrollRef.current) {
          scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
      }, 10);
    };

    es.onerror = () => {
      setConnected(false);
    };
  }

  useEffect(() => {
    connect(logType);
    return () => {
      esRef.current?.close();
    };
  }, []);

  function switchLogType(type: LogType) {
    setLogType(type);
    connect(type);
  }

  function clearDisplay() {
    setChunks([]);
    setLineCount(0);
  }

  async function clearOnServer() {
    setClearing(true);
    setClearMsg(null);
    try {
      const r = await fetch(`${base}/api/sites/${siteId}/clear-logs`, { method: "POST" });
      const data = await r.json() as { success: boolean; output?: string };
      if (data.success) {
        setClearMsg("Logs cleared on server");
        clearDisplay();
        setTimeout(() => connect(logType), 500);
      } else {
        setClearMsg("Clear failed — check server permissions");
      }
    } catch {
      setClearMsg("Request failed");
    } finally {
      setClearing(false);
      setTimeout(() => setClearMsg(null), 4000);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 p-0 sm:p-4">
      <div
        className="bg-card border border-border rounded-t-xl sm:rounded-xl shadow-2xl w-full sm:max-w-4xl flex flex-col"
        style={{ height: "90vh" }}
      >
        <div className="flex items-center gap-3 px-5 py-3 border-b border-border shrink-0">
          <ScrollText className="h-4 w-4 text-muted-foreground shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-sm">Live Logs — {domain}</p>
            <div className="flex items-center gap-2 mt-0.5">
              <div className={`h-1.5 w-1.5 rounded-full ${connected ? "bg-emerald-400" : "bg-red-400"}`} />
              <span className="text-xs text-muted-foreground">
                {connected ? "Streaming" : "Disconnected"} · {lineCount} lines received
              </span>
              {clearMsg && (
                <span className="text-xs text-emerald-400">{clearMsg}</span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-1 bg-muted rounded-lg p-0.5">
            <button
              onClick={() => switchLogType("access")}
              className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${logType === "access" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
            >
              Access
            </button>
            <button
              onClick={() => switchLogType("error")}
              className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${logType === "error" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
            >
              Error
            </button>
          </div>

          <button
            onClick={clearDisplay}
            className="text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded-md hover:bg-muted transition-colors"
            title="Clear display only"
          >
            Clear
          </button>

          <button
            onClick={clearOnServer}
            disabled={clearing}
            className="flex items-center gap-1.5 text-xs text-red-400 hover:text-red-300 px-2 py-1 rounded-md hover:bg-red-900/20 transition-colors disabled:opacity-50"
            title="Truncate log files on the server to free disk space"
          >
            <Trash2 className="h-3 w-3" />
            {clearing ? "Clearing…" : "Clear on Server"}
          </button>

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto p-4 font-mono text-xs leading-relaxed"
          style={{ background: "#0a0e1a" }}
        >
          {chunks.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
              {connected ? (
                <>
                  <Wifi className="h-6 w-6 text-emerald-400/60" />
                  <p className="text-sm">Connected — waiting for {logType} log entries...</p>
                  <p className="text-xs opacity-60">Logs appear here as requests hit {domain}</p>
                </>
              ) : (
                <>
                  <WifiOff className="h-6 w-6 opacity-40" />
                  <p className="text-sm">Connecting to server...</p>
                </>
              )}
            </div>
          )}
          <pre className="whitespace-pre-wrap text-slate-300 m-0">{chunks.join("")}</pre>
        </div>

        <div className="px-5 py-3 border-t border-border flex items-center justify-between shrink-0 text-xs text-muted-foreground">
          <span>
            Tailing <code className="bg-muted px-1 rounded">/var/log/nginx/{logType}.log</code>
            {" · "}filtered for <code className="bg-muted px-1 rounded">{domain}</code>
            {" · "}
            <span className="text-amber-400/70">Clear on Server truncates the actual log file</span>
          </span>
          <button
            onClick={onClose}
            className="bg-muted text-foreground px-3 py-1.5 rounded-lg text-xs font-medium hover:opacity-90"
          >
            Stop &amp; Close
          </button>
        </div>
      </div>
    </div>
  );
}
