import { useGetDashboardSummary, useListActivity } from "@workspace/api-client-react";
import { Server, Globe, ShieldCheck, Activity, Zap } from "lucide-react";

const statusColors: Record<string, string> = {
  success: "text-emerald-400",
  failure: "text-red-400",
  running: "text-amber-400",
};

const typeLabels: Record<string, string> = {
  deploy: "Deploy",
  ssl: "SSL",
  nginx_install: "Nginx Install",
  dns_setup: "DNS Setup",
  connection_test: "Connection Test",
  error: "Error",
};

export default function Dashboard() {
  const { data: summary, isLoading } = useGetDashboardSummary();
  const { data: activity } = useListActivity();

  const stats = [
    { label: "Total Servers", value: summary?.totalServers ?? 0, icon: Server, color: "text-blue-400" },
    { label: "Total Sites", value: summary?.totalSites ?? 0, icon: Globe, color: "text-indigo-400" },
    { label: "Active Sites", value: summary?.activeSites ?? 0, icon: Zap, color: "text-emerald-400" },
    { label: "SSL Enabled", value: summary?.sslEnabled ?? 0, icon: ShieldCheck, color: "text-amber-400" },
  ];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground mt-1">Overview of your infrastructure.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => (
          <div key={stat.label} className="rounded-xl border border-border bg-card p-6">
            <div className="flex items-center justify-between mb-4">
              <span className="text-sm font-medium text-muted-foreground">{stat.label}</span>
              <stat.icon className={`h-5 w-5 ${stat.color}`} />
            </div>
            <div className="text-3xl font-bold">{isLoading ? "—" : stat.value}</div>
          </div>
        ))}
      </div>

      <div>
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <Activity className="h-5 w-5 text-muted-foreground" />
          Recent Activity
        </h2>
        {!activity || activity.length === 0 ? (
          <div className="rounded-xl border border-border bg-card p-8 text-center text-muted-foreground">
            No activity yet. Add a server and deploy a site to get started.
          </div>
        ) : (
          <div className="rounded-xl border border-border bg-card divide-y divide-border">
            {activity.slice(0, 10).map((entry) => (
              <div key={entry.id} className="flex items-start gap-4 px-6 py-4">
                <div className={`mt-0.5 text-xs font-bold uppercase ${statusColors[entry.status] ?? "text-muted-foreground"}`}>
                  {entry.status}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium">{entry.message}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {typeLabels[entry.type] ?? entry.type} · {new Date(entry.createdAt).toLocaleString()}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
