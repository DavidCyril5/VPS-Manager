import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListSites,
  useListServers,
  useCreateSite,
  useDeleteSite,
  useDeploySite,
  useInstallSsl,
  getListSitesQueryKey,
} from "@workspace/api-client-react";
import { Globe, Plus, Trash2, Rocket, ShieldCheck, ExternalLink } from "lucide-react";
import { Link } from "wouter";
import { useToast } from "@/hooks/use-toast";

const statusColors: Record<string, string> = {
  active: "bg-emerald-900/40 text-emerald-400 border-emerald-800/50",
  deploying: "bg-amber-900/40 text-amber-400 border-amber-800/50",
  failed: "bg-red-900/40 text-red-400 border-red-800/50",
  stopped: "bg-muted/40 text-muted-foreground border-border",
};

export default function Sites() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: sites, isLoading } = useListSites();
  const { data: servers } = useListServers();
  const createSite = useCreateSite();
  const deleteSite = useDeleteSite();
  const deploySite = useDeploySite();
  const installSsl = useInstallSsl();

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    serverId: 0,
    name: "",
    domain: "",
    repoUrl: "",
    repoToken: "",
    deployPath: "/var/www/html",
    buildCommand: "",
    siteType: "static" as const,
    autoSync: false,
  });

  function handleChange(e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) {
    const { name, value, type } = e.target;
    setForm((f) => ({
      ...f,
      [name]: type === "checkbox" ? (e.target as HTMLInputElement).checked : name === "serverId" ? Number(value) : value,
    }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    createSite.mutate(
      {
        data: {
          ...form,
          repoUrl: form.repoUrl || null,
          repoToken: form.repoToken || null,
          buildCommand: form.buildCommand || null,
        },
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListSitesQueryKey() });
          setShowForm(false);
          toast({ title: "Site created" });
        },
        onError: () => toast({ title: "Failed to create site", variant: "destructive" }),
      }
    );
  }

  function handleDeploy(id: number) {
    toast({ title: "Deploying...", description: "This may take a moment." });
    deploySite.mutate(
      { params: { id } },
      {
        onSuccess: (result) => {
          queryClient.invalidateQueries({ queryKey: getListSitesQueryKey() });
          toast({
            title: result.success ? "Deploy successful" : "Deploy failed",
            variant: result.success ? "default" : "destructive",
          });
        },
        onError: () => toast({ title: "Deploy failed", variant: "destructive" }),
      }
    );
  }

  function handleSsl(id: number) {
    toast({ title: "Installing SSL...", description: "This may take a moment." });
    installSsl.mutate(
      { params: { id } },
      {
        onSuccess: (result) => {
          queryClient.invalidateQueries({ queryKey: getListSitesQueryKey() });
          toast({
            title: result.success ? "SSL installed" : "SSL install failed",
            variant: result.success ? "default" : "destructive",
          });
        },
        onError: () => toast({ title: "SSL install failed", variant: "destructive" }),
      }
    );
  }

  function handleDelete(id: number) {
    if (!confirm("Remove this site?")) return;
    deleteSite.mutate(
      { params: { id } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListSitesQueryKey() });
          toast({ title: "Site removed" });
        },
        onError: () => toast({ title: "Failed to remove site", variant: "destructive" }),
      }
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Sites</h1>
          <p className="text-muted-foreground mt-1">Deploy and manage your websites.</p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm font-medium hover:opacity-90"
        >
          <Plus className="h-4 w-4" />
          Deploy Site
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className="rounded-xl border border-border bg-card p-6 space-y-4">
          <h2 className="text-lg font-semibold">New Site</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-muted-foreground mb-1">Server</label>
              <select name="serverId" value={form.serverId} onChange={handleChange} required className="w-full rounded-lg bg-background border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring">
                <option value={0} disabled>Select a server</option>
                {servers?.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.host})</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm text-muted-foreground mb-1">Site Name</label>
              <input name="name" value={form.name} onChange={handleChange} placeholder="My Website" required className="w-full rounded-lg bg-background border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
            </div>
            <div>
              <label className="block text-sm text-muted-foreground mb-1">Domain</label>
              <input name="domain" value={form.domain} onChange={handleChange} placeholder="mysite.com" required className="w-full rounded-lg bg-background border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
            </div>
            <div>
              <label className="block text-sm text-muted-foreground mb-1">Deploy Path</label>
              <input name="deployPath" value={form.deployPath} onChange={handleChange} required className="w-full rounded-lg bg-background border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
            </div>
            <div>
              <label className="block text-sm text-muted-foreground mb-1">Site Type</label>
              <select name="siteType" value={form.siteType} onChange={handleChange} className="w-full rounded-lg bg-background border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring">
                <option value="static">Static</option>
                <option value="nodejs">Node.js</option>
                <option value="php">PHP</option>
                <option value="python">Python</option>
              </select>
            </div>
            <div>
              <label className="block text-sm text-muted-foreground mb-1">Repo URL (optional)</label>
              <input name="repoUrl" value={form.repoUrl} onChange={handleChange} placeholder="https://github.com/user/repo" className="w-full rounded-lg bg-background border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
            </div>
            <div>
              <label className="block text-sm text-muted-foreground mb-1">Access Token (optional)</label>
              <input name="repoToken" type="password" value={form.repoToken} onChange={handleChange} placeholder="ghp_xxxxx" className="w-full rounded-lg bg-background border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
            </div>
            <div>
              <label className="block text-sm text-muted-foreground mb-1">Build Command (optional)</label>
              <input name="buildCommand" value={form.buildCommand} onChange={handleChange} placeholder="npm run build" className="w-full rounded-lg bg-background border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
            </div>
            <div className="col-span-2 flex items-center gap-2">
              <input name="autoSync" type="checkbox" checked={form.autoSync} onChange={handleChange} id="autoSync" className="rounded" />
              <label htmlFor="autoSync" className="text-sm">Enable auto-sync from repo</label>
            </div>
          </div>
          <div className="flex gap-3 pt-2">
            <button type="submit" disabled={createSite.isPending} className="bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-50">
              {createSite.isPending ? "Creating..." : "Create Site"}
            </button>
            <button type="button" onClick={() => setShowForm(false)} className="bg-muted text-foreground px-4 py-2 rounded-lg text-sm font-medium hover:opacity-90">
              Cancel
            </button>
          </div>
        </form>
      )}

      {isLoading ? (
        <div className="text-muted-foreground text-sm">Loading...</div>
      ) : !sites || sites.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-12 text-center">
          <Globe className="h-10 w-10 text-muted-foreground mx-auto mb-4" />
          <p className="text-muted-foreground">No sites yet. Deploy your first website.</p>
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-card divide-y divide-border">
          {sites.map((site) => (
            <div key={site.id} className="flex items-center gap-4 px-6 py-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-3 mb-1">
                  <span className="font-semibold">{site.name}</span>
                  <span className={`text-xs border px-2 py-0.5 rounded-full capitalize ${statusColors[site.status] ?? statusColors.stopped}`}>
                    {site.status}
                  </span>
                  {site.sslInstalled && (
                    <span className="text-xs bg-emerald-900/40 text-emerald-400 border border-emerald-800/50 px-2 py-0.5 rounded-full">SSL</span>
                  )}
                  {site.autoSync && (
                    <span className="text-xs bg-blue-900/40 text-blue-400 border border-blue-800/50 px-2 py-0.5 rounded-full">Auto-sync</span>
                  )}
                </div>
                <div className="text-sm text-muted-foreground flex items-center gap-2">
                  <ExternalLink className="h-3 w-3" />
                  {site.domain}
                  <span className="text-xs bg-muted px-1.5 py-0.5 rounded">{site.siteType}</span>
                  {site.lastDeployedAt && <span>Last deployed {new Date(site.lastDeployedAt).toLocaleDateString()}</span>}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleDeploy(site.id)}
                  disabled={deploySite.isPending}
                  className="flex items-center gap-1.5 text-xs bg-blue-900/30 hover:bg-blue-900/50 text-blue-400 border border-blue-800/50 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
                >
                  <Rocket className="h-3 w-3" />
                  Deploy
                </button>
                {!site.sslInstalled && site.status === "active" && (
                  <button
                    onClick={() => handleSsl(site.id)}
                    disabled={installSsl.isPending}
                    className="flex items-center gap-1.5 text-xs bg-emerald-900/30 hover:bg-emerald-900/50 text-emerald-400 border border-emerald-800/50 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
                  >
                    <ShieldCheck className="h-3 w-3" />
                    Install SSL
                  </button>
                )}
                <Link href={`/sites/${site.id}`} className="flex items-center gap-1.5 text-xs bg-muted hover:bg-muted/70 text-foreground px-3 py-1.5 rounded-lg transition-colors">
                  Details
                </Link>
                <button
                  onClick={() => handleDelete(site.id)}
                  className="p-1.5 text-muted-foreground hover:text-red-400 transition-colors"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
