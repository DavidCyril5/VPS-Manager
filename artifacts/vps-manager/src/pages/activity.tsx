import { useListActivity } from "@workspace/api-client-react";
import { Activity, CheckCircle2, XCircle, Loader2 } from "lucide-react";

const statusIcon: Record<string, React.ReactNode> = {
  success: <CheckCircle2 className="h-4 w-4 text-emerald-400 flex-shrink-0" />,
  failure: <XCircle className="h-4 w-4 text-red-400 flex-shrink-0" />,
  running: <Loader2 className="h-4 w-4 text-amber-400 flex-shrink-0 animate-spin" />,
};

const typeColors: Record<string, string> = {
  deploy: "text-blue-400",
  ssl: "text-emerald-400",
  nginx_install: "text-amber-400",
  dns_setup: "text-purple-400",
  connection_test: "text-cyan-400",
  error: "text-red-400",
};

const typeLabels: Record<string, string> = {
  deploy: "Deploy",
  ssl: "SSL",
  nginx_install: "Nginx Install",
  dns_setup: "DNS Setup",
  connection_test: "Connection Test",
  error: "Error",
};

export default function ActivityPage() {
  const { data: activity, isLoading } = useListActivity();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Activity</h1>
        <p className="text-muted-foreground mt-1">Deployment logs and system events.</p>
      </div>

      {isLoading ? (
        <div className="text-muted-foreground text-sm">Loading...</div>
      ) : !activity || activity.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-12 text-center">
          <Activity className="h-10 w-10 text-muted-foreground mx-auto mb-4" />
          <p className="text-muted-foreground">No activity yet.</p>
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-card divide-y divide-border">
          {activity.map((entry) => (
            <div key={entry.id} className="flex items-start gap-4 px-6 py-4">
              <div className="mt-0.5">{statusIcon[entry.status] ?? statusIcon["success"]}</div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className={`text-xs font-bold uppercase ${typeColors[entry.type] ?? "text-muted-foreground"}`}>
                    {typeLabels[entry.type] ?? entry.type}
                  </span>
                  <span className="text-xs text-muted-foreground">{new Date(entry.createdAt).toLocaleString()}</span>
                </div>
                <div className="text-sm font-medium">{entry.message}</div>
                {entry.details && (
                  <details className="mt-2">
                    <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">Show output</summary>
                    <pre className="mt-2 text-xs bg-muted/50 p-3 rounded-lg overflow-auto max-h-48 whitespace-pre-wrap break-words font-mono">
                      {entry.details}
                    </pre>
                  </details>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
