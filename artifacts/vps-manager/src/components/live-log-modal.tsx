import { useEffect, useRef, useState } from "react";
import { CheckCircle2, XCircle, Loader2, X } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { getListSitesQueryKey } from "@workspace/api-client-react";

interface LiveLogModalProps {
  siteId: number;
  siteName: string;
  onClose: () => void;
}

export function LiveLogModal({ siteId, siteName, onClose }: LiveLogModalProps) {
  const [chunks, setChunks] = useState<string[]>([]);
  const [done, setDone] = useState(false);
  const [success, setSuccess] = useState<boolean | null>(null);
  const [statusMsg, setStatusMsg] = useState("Connecting to server...");
  const scrollRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();
  const base = (import.meta.env.BASE_URL as string).replace(/\/$/, "");

  useEffect(() => {
    const es = new EventSource(`${base}/api/sites/${siteId}/deploy/stream`);

    es.onmessage = (e: MessageEvent) => {
      const data = JSON.parse(e.data as string) as { type: string; text?: string; success?: boolean };
      if (data.type === "log" && data.text) {
        setChunks((prev) => [...prev, data.text!]);
        setTimeout(() => {
          if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
          }
        }, 10);
      } else if (data.type === "status" && data.text) {
        setStatusMsg(data.text);
      } else if (data.type === "done") {
        setDone(true);
        setSuccess(data.success ?? false);
        setStatusMsg(data.success ? "Deployed successfully!" : "Deployment failed");
        queryClient.invalidateQueries({ queryKey: getListSitesQueryKey() });
        es.close();
      }
    };

    es.onerror = () => {
      if (!done) {
        setDone(true);
        setSuccess(false);
        setStatusMsg("Connection lost");
      }
      es.close();
    };

    return () => es.close();
  }, [siteId]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div
        className="bg-card border border-border rounded-xl shadow-2xl w-full max-w-3xl flex flex-col"
        style={{ maxHeight: "88vh" }}
      >
        <div className="flex items-center gap-3 px-5 py-4 border-b border-border shrink-0">
          {!done ? (
            <Loader2 className="h-5 w-5 text-amber-400 animate-spin shrink-0" />
          ) : success ? (
            <CheckCircle2 className="h-5 w-5 text-emerald-400 shrink-0" />
          ) : (
            <XCircle className="h-5 w-5 text-red-400 shrink-0" />
          )}
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-sm">Deploying {siteName}</p>
            <p className="text-xs text-muted-foreground">{statusMsg}</p>
          </div>
          <button
            onClick={onClose}
            disabled={!done}
            title={done ? "Close" : "Wait for deploy to finish"}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-25 disabled:cursor-not-allowed transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto p-4 font-mono text-xs leading-relaxed"
          style={{ background: "#0a0e1a", minHeight: "320px" }}
        >
          {chunks.length === 0 && !done && (
            <span className="text-slate-500">Waiting for output...</span>
          )}
          <pre className="whitespace-pre-wrap text-slate-300 m-0">{chunks.join("")}</pre>
          {done && (
            <div className={`mt-3 font-bold text-sm ${success ? "text-emerald-400" : "text-red-400"}`}>
              {success ? "✓ Deploy complete" : "✗ Deploy failed — scroll up to see the error"}
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-border flex items-center justify-between shrink-0">
          <span className="text-xs text-muted-foreground">
            {done ? "Finished" : "Running — do not close this tab"}
          </span>
          <button
            onClick={onClose}
            disabled={!done}
            className="bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-30 disabled:cursor-not-allowed"
          >
            {done ? "Close" : "Deploying..."}
          </button>
        </div>
      </div>
    </div>
  );
}
