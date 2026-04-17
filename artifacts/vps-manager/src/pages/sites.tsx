import { useState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListSites,
  useListServers,
  useCreateSite,
  useDeleteSite,
  useDeploySite,
  useInstallSsl,
  useUpdateSite,
  useListCloudflareConfigs,
  getListSitesQueryKey,
} from "@workspace/api-client-react";
import { Globe, Plus, Trash2, Rocket, ShieldCheck, ExternalLink, Copy, Check, FileCode, Clock, Key, Save, Pencil, X, Search, BookOpen, Lock, Unlock, ScrollText, RotateCcw, RefreshCw, Play, Square, Timer, AlertCircle, Trash, MoreVertical } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { LogModal } from "@/components/log-modal";
import { NginxConfigModal } from "@/components/nginx-config-modal";
import { LiveLogModal } from "@/components/live-log-modal";
import { SiteLogsModal } from "@/components/site-logs-modal";

interface GitToken { id: number; label: string; host: string; }
interface GHRepo { full_name: string; clone_url: string; private: boolean; description: string | null; updated_at: string; }

function useGitTokens() {
  const [tokens, setTokens] = useState<GitToken[]>([]);
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");
  function load() {
    fetch(`${base}/api/git-tokens`).then((r) => r.json()).then(setTokens).catch(() => {});
  }
  useEffect(() => { load(); }, []);
  async function saveToken(label: string, host: string, token: string) {
    await fetch(`${base}/api/git-tokens`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ label, host, token }) });
    load();
  }
  async function deleteToken(id: number) {
    await fetch(`${base}/api/git-tokens/${id}`, { method: "DELETE" });
    load();
  }
  async function resolveToken(id: number): Promise<string> {
    const r = await fetch(`${base}/api/git-tokens/${id}/resolve`);
    const d = await r.json() as { token: string };
    return d.token;
  }
  return { tokens, saveToken, deleteToken, resolveToken };
}

const statusColors: Record<string, string> = {
  active: "bg-emerald-900/40 text-emerald-400 border-emerald-800/50",
  deploying: "bg-amber-900/40 text-amber-400 border-amber-800/50",
  failed: "bg-red-900/40 text-red-400 border-red-800/50",
  stopped: "bg-muted/40 text-muted-foreground border-border",
};

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }
  return (
    <button onClick={copy} className="p-1 text-muted-foreground hover:text-foreground transition-colors" title="Copy">
      {copied ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
    </button>
  );
}

function SslExpiryBadge({ expiresAt }: { expiresAt: string | null | undefined }) {
  if (!expiresAt) return null;
  const days = Math.ceil((new Date(expiresAt).getTime() - Date.now()) / (86400 * 1000));
  const color = days < 14 ? "bg-red-900/40 text-red-400 border-red-800/50" : days < 30 ? "bg-amber-900/40 text-amber-400 border-amber-800/50" : "bg-emerald-900/40 text-emerald-400 border-emerald-800/50";
  return (
    <span className={`text-xs border px-2 py-0.5 rounded-full flex items-center gap-1 ${color}`}>
      <Clock className="h-2.5 w-2.5" />
      SSL {days}d
    </span>
  );
}

export default function Sites() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: sites, isLoading } = useListSites({ query: { refetchInterval: 30000 } });
  const { data: servers } = useListServers();
  const createSite = useCreateSite();
  const deleteSite = useDeleteSite();
  const deploySite = useDeploySite();
  const installSsl = useInstallSsl();

  const updateSite = useUpdateSite();
  const { tokens: gitTokens, saveToken, deleteToken, resolveToken } = useGitTokens();
  const { data: cfAccounts } = useListCloudflareConfigs();
  const [showForm, setShowForm] = useState(false);
  const [editTarget, setEditTarget] = useState<number | null>(null);
  const [editForm, setEditForm] = useState({
    name: "", domain: "", repoUrl: "", repoToken: "",
    deployPath: "", webRoot: "", buildCommand: "", startCommand: "", port: 3000, siteType: "static", autoSync: false,
    cloudflareConfigId: 0, logSizeLimitMb: 50,
  });
  const [deleteTarget, setDeleteTarget] = useState<number | null>(null);
  const [logModal, setLogModal] = useState<{ title: string; success: boolean; output: string } | null>(null);
  const [liveDeployTarget, setLiveDeployTarget] = useState<{ id: number; name: string } | null>(null);
  const [siteLogsTarget, setSiteLogsTarget] = useState<{ id: number; domain: string } | null>(null);
  const [nginxModal, setNginxModal] = useState<{ siteId: number; domain: string } | null>(null);
  const [webhookVisible, setWebhookVisible] = useState<Set<number>>(new Set());
  const [saveTokenLabel, setSaveTokenLabel] = useState("");
  const [showSaveToken, setShowSaveToken] = useState(false);
  const [showManageTokens, setShowManageTokens] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [uptimeMap, setUptimeMap] = useState<Record<number, { up: boolean; ms: number; statusCode: number } | null>>({});
  const [pm2LoadingSet, setPm2LoadingSet] = useState<Set<number>>(new Set());
  const [pm2LogsModal, setPm2LogsModal] = useState<{ name: string; output: string } | null>(null);
  const [rollbackModal, setRollbackModal] = useState<{ siteId: number; name: string; commits: { sha: string; subject: string; date: string }[] } | null>(null);
  const [rollbackLoading, setRollbackLoading] = useState(false);
  const [sslRenewalLoading, setSslRenewalLoading] = useState<Set<number>>(new Set());
  const [mobileMenuOpen, setMobileMenuOpen] = useState<number | null>(null);

  const [repoBrowser, setRepoBrowser] = useState<{ open: boolean; loading: boolean; repos: GHRepo[]; search: string; error: string | null }>({ open: false, loading: false, repos: [], search: "", error: null });

  const [form, setForm] = useState({
    serverId: 0,
    name: "",
    domain: "",
    repoUrl: "",
    repoToken: "",
    deployPath: "/var/www/html",
    webRoot: "",
    buildCommand: "",
    startCommand: "",
    port: 3000,
    siteType: "static" as const,
    autoSync: false,
    cloudflareConfigId: 0,
  });

  const base = import.meta.env.BASE_URL.replace(/\/$/, "");

  useEffect(() => {
    const interval = setInterval(() => {
      if (sites) {
        sites.forEach(site => {
          if (site.siteType === "nodejs" || site.siteType === "python") {
            handleCleanPm2Logs(site.id, false);
          }
        });
      }
    }, 3600000); // 1 hour

    return () => clearInterval(interval);
  }, [sites]);
  
  async function handleCleanPm2Logs(siteId: number, showToast: boolean) {
    try {
      await fetch(`${base}/api/sites/${siteId}/pm2/clean-logs`, { method: "POST" });
      if (showToast) {
        toast({ title: "PM2 logs cleaned" });
      }
    } catch {
      if (showToast) {
        toast({ title: "Failed to clean PM2 logs", variant: "destructive" });
      }
    }
  }

  async function handleSelectSavedToken(id: number) {
    if (!id) return;
    const token = await resolveToken(id);
    setForm((f) => ({ ...f, repoToken: token }));
  }

  async function handleSaveToken() {
    if (!form.repoToken || !saveTokenLabel) return;
    const host = form.repoUrl.includes("gitlab") ? "gitlab.com" : form.repoUrl.includes("bitbucket") ? "bitbucket.org" : "github.com";
    await saveToken(saveTokenLabel, host, form.repoToken);
    setSaveTokenLabel("");
    setShowSaveToken(false);
    toast({ title: "Token saved" });
  }

  function openEdit(site: typeof sites extends (infer T)[] | undefined ? T : never) {
    const s = site as unknown as Record<string, unknown>;
    setEditTarget(site.id);
    setEditForm({
      name: site.name ?? "",
      domain: site.domain ?? "",
      repoUrl: (s.repoUrl as string) ?? "",
      repoToken: "",
      deployPath: (s.deployPath as string) ?? "",
      webRoot: (s.webRoot as string) ?? "",
      buildCommand: (s.buildCommand as string) ?? "",
      startCommand: (s.startCommand as string) ?? "",
      port: (s.port as number) || 3000,
      siteType: site.siteType ?? "static",
      autoSync: (s.autoSync as boolean) ?? false,
      cloudflareConfigId: (s.cloudflareConfigId as number) || 0,
      logSizeLimitMb: (s.logSizeLimitMb as number) || 50,
    });
  }

  function handleEditChange(e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) {
    const { name, value, type } = e.target;
    setEditForm((f) => ({
      ...f,
      [name]: type === "checkbox" ? (e.target as HTMLInputElement).checked : (name === "port" || name === "cloudflareConfigId") ? Number(value) : value,
    }));
  }

  async function handleEditSaveAndRedeploy(andRedeploy: boolean) {
    if (!editTarget) return;
    updateSite.mutate(
      {
        id: editTarget,
        data: {
          ...editForm,
          repoUrl: editForm.repoUrl || null,
          repoToken: editForm.repoToken || null,
          webRoot: editForm.webRoot || null,
          buildCommand: editForm.buildCommand || null,
          startCommand: editForm.startCommand || null,
          port: editForm.port || undefined,
          cloudflareConfigId: editForm.cloudflareConfigId || null,
        },
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListSitesQueryKey() });
          toast({ title: "Settings saved" });
          if (andRedeploy) handleDeploy(editTarget);
          setEditTarget(null);
        },
        onError: () => toast({ title: "Failed to save", variant: "destructive" }),
      }
    );
  }

  async function handleEditSelectSavedToken(id: number) {
    if (!id) return;
    const token = await resolveToken(id);
    setEditForm((f) => ({ ...f, repoToken: token }));
  }

  async function fetchRepos(token?: string) {
    const t = token ?? form.repoToken;
    if (!t) return;
    setRepoBrowser((b) => ({ ...b, open: true, loading: true, repos: [], error: null, search: "" }));
    try {
      const all: GHRepo[] = [];
      let page = 1;
      while (true) {
        const r = await fetch(`https://api.github.com/user/repos?per_page=100&page=${page}&sort=updated&affiliation=owner,collaborator,organization_member`, {
          headers: { Authorization: `Bearer ${t}`, Accept: "application/vnd.github+json" },
        });
        if (!r.ok) { setRepoBrowser((b) => ({ ...b, loading: false, error: `GitHub error: ${r.status} ${r.statusText}` })); return; }
        const data = await r.json() as GHRepo[];
        all.push(...data);
        if (data.length < 100) break;
        page++;
      }
      setRepoBrowser((b) => ({ ...b, loading: false, repos: all }));
    } catch {
      setRepoBrowser((b) => ({ ...b, loading: false, error: "Failed to fetch repos. Check your token." }));
    }
  }

  function selectRepo(repo: GHRepo) {
    setForm((f) => ({ ...f, repoUrl: repo.clone_url }));
    setRepoBrowser((b) => ({ ...b, open: false }));
  }

  const defaultPaths = ["/var/www/html", ""];
  const buildSuggestions: Record<string, string> = {
    nodejs: "npm install && npm run build --if-present",
    python: "pip install -r requirements.txt",
    php: "",
    static: "",
  };

  function slugify(s: string) {
    return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) {
    const { name, value, type } = e.target;
    const checked = type === "checkbox" ? (e.target as HTMLInputElement).checked : undefined;
    setForm((f) => {
      const updated = { ...f, [name]: checked !== undefined ? checked : (name === "serverId" || name === "port" || name === "cloudflareConfigId") ? Number(value) : value };
      if (name === "name" && value) {
        const slug = slugify(value);
        if (defaultPaths.includes(f.deployPath) || f.deployPath === `/var/www/${slugify(f.name)}`) {
          updated.deployPath = `/var/www/${slug}`;
        }
      }
      if (name === "siteType" && !f.buildCommand) {
        updated.buildCommand = buildSuggestions[value] ?? "";
      }
      return updated;
    });
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    createSite.mutate(
      {
        data: {
          ...form,
          repoUrl: form.repoUrl || null,
          repoToken: form.repoToken || null,
          webRoot: form.webRoot || null,
          buildCommand: form.buildCommand || null,
          startCommand: form.startCommand || null,
          port: form.port || undefined,
          cloudflareConfigId: form.cloudflareConfigId || null,
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
    const site = sites?.find((s) => s.id === id);
    setLiveDeployTarget({ id, name: site?.name ?? "Site" });
  }

  async function checkUptime(id: number) {
    try {
      const r = await fetch(`${base}/api/sites/${id}/uptime`);
      const d = await r.json() as { up: boolean; ms: number; statusCode: number };
      setUptimeMap((prev) => ({ ...prev, [id]: d }));
    } catch {
      setUptimeMap((prev) => ({ ...prev, [id]: null }));
    }
  }

  async function handlePm2Action(siteId: number, action: string, siteName: string) {
    setPm2LoadingSet((prev) => new Set(prev).add(siteId));
    try {
      const r = await fetch(`${base}/api/sites/${siteId}/pm2/${action}`, { method: "POST" });
      const d = await r.json() as { success: boolean; output: string };
      if (action === "logs") {
        setPm2LogsModal({ name: siteName, output: d.output });
      } else {
        toast({ title: d.success ? `PM2 ${action} succeeded` : `PM2 ${action} failed`, variant: d.success ? "default" : "destructive" });
        queryClient.invalidateQueries({ queryKey: getListSitesQueryKey() });
      }
    } catch {
      toast({ title: "PM2 action failed", variant: "destructive" });
    } finally {
      setPm2LoadingSet((prev) => { const s = new Set(prev); s.delete(siteId); return s; });
    }
  }

  async function handleRollbackOpen(siteId: number, siteName: string) {
    try {
      const r = await fetch(`${base}/api/sites/${siteId}/commits`);
      const d = await r.json() as { commits: { sha: string; subject: string; date: string }[] };
      setRollbackModal({ siteId, name: siteName, commits: d.commits ?? [] });
    } catch {
      toast({ title: "Failed to fetch commits", variant: "destructive" });
    }
  }

  async function confirmRollback(sha: string) {
    if (!rollbackModal) return;
    setRollbackLoading(true);
    try {
      const r = await fetch(`${base}/api/sites/${rollbackModal.siteId}/rollback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sha }),
      });
      const d = await r.json() as { success: boolean; output: string };
      setLogModal({ title: d.success ? "Rollback Successful" : "Rollback Failed", success: d.success, output: d.output });
      queryClient.invalidateQueries({ queryKey: getListSitesQueryKey() });
    } catch {
      toast({ title: "Rollback failed", variant: "destructive" });
    } finally {
      setRollbackLoading(false);
      setRollbackModal(null);
    }
  }

  async function handleSslRenewal(id: number) {
    setSslRenewalLoading((prev) => new Set(prev).add(id));
    try {
      const r = await fetch(`${base}/api/sites/${id}/setup-ssl-renewal`, { method: "POST" });
      const d = await r.json() as { success: boolean; output: string };
      setLogModal({ title: "SSL Auto-Renewal Setup", success: d.success, output: d.output });
    } catch {
      toast({ title: "Failed to setup SSL renewal", variant: "destructive" });
    } finally {
      setSslRenewalLoading((prev) => { const s = new Set(prev); s.delete(id); return s; });
    }
  }

  function handleSsl(id: number) {
    toast({ title: "Installing SSL...", description: "This may take a moment." });
    installSsl.mutate(
      { id },
      {
        onSuccess: (result) => {
          queryClient.invalidateQueries({ queryKey: getListSitesQueryKey() });
          setLogModal({
            title: result.success ? "SSL Installed" : "SSL Install Failed",
            success: result.success,
            output: result.output,
          });
        },
        onError: () => toast({ title: "SSL install failed", variant: "destructive" }),
      }
    );
  }

  function confirmDelete() {
    if (!deleteTarget) return;
    deleteSite.mutate(
      { id: deleteTarget },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListSitesQueryKey() });
          toast({ title: "Site removed" });
        },
        onError: () => toast({ title: "Failed to remove site", variant: "destructive" }),
      }
    );
    setDeleteTarget(null);
  }

  function toggleWebhook(id: number) {
    setWebhookVisible((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function getWebhookUrl(token: string | null | undefined) {
    if (!token) return "";
    return `${window.location.origin}${base}/api/webhook/${token}`;
  }

  const filteredSites = (sites ?? []).filter((s) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return s.name.toLowerCase().includes(q) || s.domain.toLowerCase().includes(q);
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Sites</h1>
          <p className="text-muted-foreground mt-1 text-sm sm:text-base">Deploy and manage your websites.</p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-2 bg-primary text-primary-foreground px-3 py-2 sm:px-4 rounded-lg text-sm font-medium hover:opacity-90 shrink-0"
        >
          <Plus className="h-4 w-4" />
          <span className="hidden sm:inline">Deploy Site</span>
          <span className="sm:hidden">Deploy</span>
        </button>
      </div>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search sites by name or domain..."
          className="w-full rounded-lg bg-card border border-border pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className="rounded-xl border border-border bg-card p-4 sm:p-6 space-y-4">
          <h2 className="text-lg font-semibold">New Site</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
              <label className="block text-sm text-muted-foreground mb-1">
                Serve From <span className="text-xs opacity-60">(optional — subfolder nginx serves, e.g. <code>dist</code> or <code>artifacts/vps-manager/dist/public</code>)</span>
              </label>
              <input name="webRoot" value={form.webRoot} onChange={handleChange} placeholder="Leave blank to use Deploy Path" className="w-full rounded-lg bg-background border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
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
            {cfAccounts && cfAccounts.length > 0 && (
              <div>
                <label className="block text-sm text-muted-foreground mb-1">Cloudflare Account <span className="opacity-60 text-xs">(for DNS)</span></label>
                <select name="cloudflareConfigId" value={form.cloudflareConfigId} onChange={handleChange} className="w-full rounded-lg bg-background border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring">
                  <option value={0}>— Auto-detect from all accounts —</option>
                  {cfAccounts.map((a) => <option key={a.id} value={a.id}>{a.label} ({a.email})</option>)}
                </select>
              </div>
            )}
            <div className="col-span-2 space-y-2">
              <div className="flex items-center justify-between mb-1">
                <label className="block text-sm text-muted-foreground">Repo URL (optional)</label>
                {form.repoToken && (
                  <button type="button" onClick={() => fetchRepos()} className="flex items-center gap-1.5 text-xs text-primary hover:underline">
                    <BookOpen className="h-3 w-3" />
                    Browse my repos
                  </button>
                )}
              </div>
              <input name="repoUrl" value={form.repoUrl} onChange={handleChange} placeholder="https://github.com/user/repo" className="w-full rounded-lg bg-background border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
              {repoBrowser.open && (
                <div className="border border-border rounded-lg bg-background overflow-hidden">
                  <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
                    <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <input
                      autoFocus
                      value={repoBrowser.search}
                      onChange={(e) => setRepoBrowser((b) => ({ ...b, search: e.target.value }))}
                      placeholder="Search repos..."
                      className="flex-1 bg-transparent text-sm focus:outline-none"
                    />
                    <button type="button" onClick={() => setRepoBrowser((b) => ({ ...b, open: false }))} className="text-muted-foreground hover:text-foreground"><X className="h-3.5 w-3.5" /></button>
                  </div>
                  <div className="max-h-56 overflow-y-auto">
                    {repoBrowser.loading && <p className="text-sm text-muted-foreground px-4 py-3">Loading repos...</p>}
                    {repoBrowser.error && <p className="text-sm text-red-400 px-4 py-3">{repoBrowser.error}</p>}
                    {!repoBrowser.loading && !repoBrowser.error && repoBrowser.repos
                      .filter((r) => r.full_name.toLowerCase().includes(repoBrowser.search.toLowerCase()))
                      .map((repo) => (
                        <button
                          key={repo.full_name}
                          type="button"
                          onClick={() => selectRepo(repo)}
                          className="w-full flex items-start gap-3 px-4 py-2.5 hover:bg-muted/50 text-left transition-colors"
                        >
                          {repo.private ? <Lock className="h-3.5 w-3.5 text-amber-400 shrink-0 mt-0.5" /> : <Unlock className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />}
                          <div className="min-w-0">
                            <p className="text-sm font-medium truncate">{repo.full_name}</p>
                            {repo.description && <p className="text-xs text-muted-foreground truncate">{repo.description}</p>}
                          </div>
                        </button>
                      ))
                    }
                    {!repoBrowser.loading && !repoBrowser.error && repoBrowser.repos.length === 0 && (
                      <p className="text-sm text-muted-foreground px-4 py-3">No repos found.</p>
                    )}
                  </div>
                </div>
              )}
            </div>
            <div className="space-y-2">
              <label className="block text-sm text-muted-foreground mb-1">Access Token (optional)</label>
              {gitTokens.length > 0 && (
                <select
                  defaultValue=""
                  onChange={async (e) => { if (e.target.value) { const tok = await resolveToken(Number(e.target.value)); setForm((f) => ({ ...f, repoToken: tok })); fetchRepos(tok); } }}
                  className="w-full rounded-lg bg-background border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="">— Use saved token —</option>
                  {gitTokens.map((t) => (
                    <option key={t.id} value={t.id}>{t.label} ({t.host})</option>
                  ))}
                </select>
              )}
              <div className="flex gap-2">
                <input name="repoToken" type="password" value={form.repoToken} onChange={handleChange} placeholder="ghp_xxxxx or select saved token above" className="flex-1 rounded-lg bg-background border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
                {form.repoToken && (
                  <button type="button" onClick={() => fetchRepos()} title="Browse your GitHub repos" className="flex items-center gap-1 text-xs bg-muted hover:bg-muted/70 px-3 py-2 rounded-lg transition-colors">
                    <BookOpen className="h-3.5 w-3.5" />
                  </button>
                )}
                {form.repoToken && (
                  <button type="button" onClick={() => setShowSaveToken(!showSaveToken)} className="flex items-center gap-1 text-xs bg-muted px-3 py-2 rounded-lg hover:opacity-80" title="Save token for later">
                    <Save className="h-3 w-3" />
                  </button>
                )}
              </div>
              {showSaveToken && (
                <div className="flex gap-2">
                  <input
                    value={saveTokenLabel}
                    onChange={(e) => setSaveTokenLabel(e.target.value)}
                    placeholder="Label (e.g. My GitHub)"
                    className="flex-1 rounded-lg bg-background border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                  <button type="button" onClick={handleSaveToken} className="text-xs bg-primary text-primary-foreground px-3 py-2 rounded-lg hover:opacity-90">Save</button>
                </div>
              )}
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-sm text-muted-foreground">Build Command (optional)</label>
                {buildSuggestions[form.siteType] && (
                  <button type="button" onClick={() => setForm((f) => ({ ...f, buildCommand: buildSuggestions[f.siteType] ?? "" }))} className="text-xs text-primary hover:underline">
                    Use suggested
                  </button>
                )}
              </div>
              <input name="buildCommand" value={form.buildCommand} onChange={handleChange} placeholder={buildSuggestions[form.siteType] || "e.g. npm run build"} className="w-full rounded-lg bg-background border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
              {form.siteType === "nodejs" && !form.buildCommand && (
                <p className="text-xs text-muted-foreground mt-1">Leave blank — auto-detects <code className="bg-muted px-1 rounded">pnpm</code> / <code className="bg-muted px-1 rounded">yarn</code> / <code className="bg-muted px-1 rounded">npm</code> from lock files, installs deps, and runs the build script if one exists in package.json</p>
              )}
              {form.siteType === "python" && !form.buildCommand && (
                <p className="text-xs text-muted-foreground mt-1">Leave blank — Python sites auto-run <code className="bg-muted px-1 rounded">pip install -r requirements.txt</code> if it exists</p>
              )}
            </div>
            {(form.siteType === "nodejs" || form.siteType === "python") && (<>
              <div>
                <label className="block text-sm text-muted-foreground mb-1">
                  App Port <span className="opacity-60 text-xs">(port your app listens on)</span>
                </label>
                <input name="port" type="number" value={form.port} onChange={handleChange} placeholder="3000" className="w-full rounded-lg bg-background border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
              </div>
              <div>
                <label className="block text-sm text-muted-foreground mb-1">
                  Start Command <span className="opacity-60 text-xs">(how pm2 starts your app)</span>
                </label>
                <input name="startCommand" value={form.startCommand} onChange={handleChange} placeholder={form.siteType === "python" ? "gunicorn app:app" : "npm run start"} className="w-full rounded-lg bg-background border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
                <p className="text-xs text-muted-foreground mt-1">Leave blank to use <code className="bg-muted px-1 rounded">{form.siteType === "python" ? "gunicorn app:app" : "npm run start"}</code> automatically</p>
              </div>
            </>)}
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

      {gitTokens.length > 0 && (
        <div className="rounded-xl border border-border bg-card px-6 py-4">
          <button
            onClick={() => setShowManageTokens(!showManageTokens)}
            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <Key className="h-4 w-4" />
            Saved Git Tokens ({gitTokens.length})
            <span className="text-xs">{showManageTokens ? "▲" : "▼"}</span>
          </button>
          {showManageTokens && (
            <div className="mt-3 space-y-2">
              {gitTokens.map((t) => (
                <div key={t.id} className="flex items-center justify-between bg-background rounded-lg px-3 py-2 border border-border">
                  <span className="text-sm">{t.label} <span className="text-xs text-muted-foreground">({t.host})</span></span>
                  <button onClick={() => deleteToken(t.id)} className="p-1 text-muted-foreground hover:text-red-400 transition-colors">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {isLoading ? (
        <div className="text-muted-foreground text-sm">Loading...</div>
      ) : !sites || sites.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-12 text-center">
          <Globe className="h-10 w-10 text-muted-foreground mx-auto mb-4" />
          <p className="font-medium text-muted-foreground">No sites yet</p>
          <p className="text-sm text-muted-foreground mt-1">Deploy your first website from a Git repo.</p>
          <button onClick={() => setShowForm(true)} className="mt-4 bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm font-medium hover:opacity-90">
            Deploy Site
          </button>
        </div>
      ) : filteredSites.length === 0 && searchQuery ? (
        <div className="rounded-xl border border-border bg-card p-8 text-center">
          <p className="text-muted-foreground text-sm">No sites match "<span className="text-foreground">{searchQuery}</span>"</p>
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-card divide-y divide-border">
          {filteredSites.map((site) => {
            const uptime = uptimeMap[site.id];
            const isNodeOrPy = site.siteType === "nodejs" || site.siteType === "python";
            const pm2Loading = pm2LoadingSet.has(site.id);
            return (
            <div key={site.id} className="px-4 py-3 sm:px-6 sm:py-4 space-y-2">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className="font-semibold">{site.name}</span>
                    <span className={`text-xs border px-2 py-0.5 rounded-full capitalize ${statusColors[site.status] ?? statusColors.stopped}`}>
                      {site.status}
                    </span>
                    {uptime !== undefined && uptime !== null && (
                      <span className={`text-xs border px-2 py-0.5 rounded-full flex items-center gap-1 ${uptime.up ? "bg-emerald-900/40 text-emerald-400 border-emerald-800/50" : "bg-red-900/40 text-red-400 border-red-800/50"}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${uptime.up ? "bg-emerald-400" : "bg-red-400"}`} />
                        {uptime.up ? `Up ${uptime.ms}ms` : "Down"}
                      </span>
                    )}
                    {site.sslInstalled && (
                      <span className="text-xs bg-emerald-900/40 text-emerald-400 border border-emerald-800/50 px-2 py-0.5 rounded-full">SSL</span>
                    )}
                    {site.sslExpiresAt && <SslExpiryBadge expiresAt={site.sslExpiresAt} />}
                    {site.autoSync && (
                      <span className="text-xs bg-blue-900/40 text-blue-400 border border-blue-800/50 px-2 py-0.5 rounded-full">Auto-sync</span>
                    )}
                    <span className="text-xs bg-muted px-1.5 py-0.5 rounded">{site.siteType}</span>
                  </div>
                  <div className="text-sm text-muted-foreground flex items-center gap-2 flex-wrap">
                    <ExternalLink className="h-3 w-3 shrink-0" />
                    <a href={`http://${site.domain}`} target="_blank" rel="noreferrer" className="hover:text-foreground transition-colors truncate">
                      {site.domain}
                    </a>
                    {site.lastDeployedAt && <span className="text-xs shrink-0">· Last deployed {new Date(site.lastDeployedAt).toLocaleDateString()}</span>}
                  </div>
                </div>
                {/* ── Desktop actions (all visible) ── */}
                <div className="hidden sm:flex items-center gap-2 flex-wrap">
                  <button onClick={() => handleDeploy(site.id)} disabled={deploySite.isPending} className="flex items-center gap-1.5 text-xs bg-blue-900/30 hover:bg-blue-900/50 text-blue-400 border border-blue-800/50 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50">
                    <Rocket className="h-3 w-3" />Deploy
                  </button>
                  {site.status === "active" && (
                    <button onClick={() => handleSsl(site.id)} disabled={installSsl.isPending} className="flex items-center gap-1.5 text-xs bg-emerald-900/30 hover:bg-emerald-900/50 text-emerald-400 border border-emerald-800/50 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50" title={site.sslInstalled ? "Reinstall / renew SSL certificate" : "Install SSL certificate"}>
                      <ShieldCheck className="h-3 w-3" />{site.sslInstalled ? "Renew SSL" : "SSL"}
                    </button>
                  )}
                  <button onClick={() => setNginxModal({ siteId: site.id, domain: site.domain })} className="flex items-center gap-1.5 text-xs bg-muted hover:bg-muted/70 text-foreground px-3 py-1.5 rounded-lg transition-colors">
                    <FileCode className="h-3 w-3" />Nginx
                  </button>
                  {site.status === "active" && (
                    <button onClick={() => setSiteLogsTarget({ id: site.id, domain: site.domain })} className="flex items-center gap-1.5 text-xs bg-purple-900/30 hover:bg-purple-900/50 text-purple-400 border border-purple-800/50 px-3 py-1.5 rounded-lg transition-colors">
                      <ScrollText className="h-3 w-3" />Logs
                    </button>
                  )}
                  {isNodeOrPy && site.status === "active" && (
                    <>
                      <button onClick={() => handlePm2Action(site.id, "restart", site.name)} disabled={pm2Loading} className="flex items-center gap-1.5 text-xs bg-amber-900/30 hover:bg-amber-900/50 text-amber-400 border border-amber-800/50 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50">
                        <RefreshCw className="h-3 w-3" />Restart
                      </button>
                      <button onClick={() => handlePm2Action(site.id, "stop", site.name)} disabled={pm2Loading} className="flex items-center gap-1.5 text-xs bg-muted hover:bg-muted/70 text-muted-foreground px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50">
                        <Square className="h-3 w-3" />Stop
                      </button>
                      <button onClick={() => handlePm2Action(site.id, "logs", site.name)} disabled={pm2Loading} className="flex items-center gap-1.5 text-xs bg-muted hover:bg-muted/70 text-muted-foreground px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50">
                        <ScrollText className="h-3 w-3" />PM2 Logs
                      </button>
                      <button onClick={() => handleCleanPm2Logs(site.id, true)} className="flex items-center gap-1.5 text-xs bg-red-900/30 hover:bg-red-900/50 text-red-400 border border-red-800/50 px-3 py-1.5 rounded-lg transition-colors">
                        <Trash className="h-3 w-3" />Clean Logs
                      </button>
                    </>
                  )}
                  {site.repoUrl && (
                    <button onClick={() => handleRollbackOpen(site.id, site.name)} className="flex items-center gap-1.5 text-xs bg-muted hover:bg-muted/70 text-muted-foreground px-3 py-1.5 rounded-lg transition-colors">
                      <RotateCcw className="h-3 w-3" />Rollback
                    </button>
                  )}
                  <button onClick={() => checkUptime(site.id)} className="flex items-center gap-1.5 text-xs bg-muted hover:bg-muted/70 text-muted-foreground px-3 py-1.5 rounded-lg transition-colors">
                    <Timer className="h-3 w-3" />Ping
                  </button>
                  {site.sslInstalled && (
                    <button onClick={() => handleSslRenewal(site.id)} disabled={sslRenewalLoading.has(site.id)} className="flex items-center gap-1.5 text-xs bg-emerald-900/30 hover:bg-emerald-900/50 text-emerald-400 border border-emerald-800/50 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50">
                      <Timer className="h-3 w-3" />Auto-Renew
                    </button>
                  )}
                  {site.webhookToken && (
                    <button onClick={() => toggleWebhook(site.id)} className="flex items-center gap-1.5 text-xs bg-violet-900/30 hover:bg-violet-900/50 text-violet-400 border border-violet-800/50 px-3 py-1.5 rounded-lg transition-colors">
                      Webhook
                    </button>
                  )}
                  <button onClick={() => editTarget === site.id ? setEditTarget(null) : openEdit(site)} className="p-1.5 text-muted-foreground hover:text-amber-400 transition-colors">
                    {editTarget === site.id ? <X className="h-4 w-4" /> : <Pencil className="h-4 w-4" />}
                  </button>
                  <button onClick={() => setDeleteTarget(site.id)} className="p-1.5 text-muted-foreground hover:text-red-400 transition-colors">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>

                {/* ── Mobile actions (Deploy + ⋮ menu) ── */}
                <div className="sm:hidden flex items-center gap-2">
                  <button onClick={() => handleDeploy(site.id)} disabled={deploySite.isPending} className="flex items-center gap-1.5 text-xs bg-blue-900/30 text-blue-400 border border-blue-800/50 px-3 py-1.5 rounded-lg disabled:opacity-50">
                    <Rocket className="h-3 w-3" />Deploy
                  </button>
                  <button onClick={() => editTarget === site.id ? setEditTarget(null) : openEdit(site)} className="p-1.5 text-muted-foreground hover:text-amber-400 transition-colors">
                    {editTarget === site.id ? <X className="h-4 w-4" /> : <Pencil className="h-4 w-4" />}
                  </button>
                  <button onClick={() => setDeleteTarget(site.id)} className="p-1.5 text-muted-foreground hover:text-red-400 transition-colors">
                    <Trash2 className="h-4 w-4" />
                  </button>
                  <div className="relative">
                    <button
                      onClick={() => setMobileMenuOpen(mobileMenuOpen === site.id ? null : site.id)}
                      className="p-1.5 text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <MoreVertical className="h-4 w-4" />
                    </button>
                    {mobileMenuOpen === site.id && (
                      <>
                        <div className="fixed inset-0 z-10" onClick={() => setMobileMenuOpen(null)} />
                        <div className="absolute right-0 bottom-full mb-1 z-20 w-44 bg-card border border-border rounded-xl shadow-xl overflow-hidden">
                          {site.status === "active" && (
                            <button onClick={() => { handleSsl(site.id); setMobileMenuOpen(null); }} className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-emerald-400 hover:bg-muted transition-colors text-left">
                              <ShieldCheck className="h-4 w-4" />{site.sslInstalled ? "Renew SSL" : "SSL"}
                            </button>
                          )}
                          <button onClick={() => { setNginxModal({ siteId: site.id, domain: site.domain }); setMobileMenuOpen(null); }} className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm hover:bg-muted transition-colors text-left">
                            <FileCode className="h-4 w-4" />Nginx Config
                          </button>
                          {site.status === "active" && (
                            <button onClick={() => { setSiteLogsTarget({ id: site.id, domain: site.domain }); setMobileMenuOpen(null); }} className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-purple-400 hover:bg-muted transition-colors text-left">
                              <ScrollText className="h-4 w-4" />Nginx Logs
                            </button>
                          )}
                          {isNodeOrPy && site.status === "active" && (
                            <>
                              <button onClick={() => { handlePm2Action(site.id, "restart", site.name); setMobileMenuOpen(null); }} disabled={pm2Loading} className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-amber-400 hover:bg-muted transition-colors text-left disabled:opacity-50">
                                <RefreshCw className="h-4 w-4" />Restart PM2
                              </button>
                              <button onClick={() => { handlePm2Action(site.id, "stop", site.name); setMobileMenuOpen(null); }} disabled={pm2Loading} className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm hover:bg-muted transition-colors text-left disabled:opacity-50">
                                <Square className="h-4 w-4" />Stop PM2
                              </button>
                              <button onClick={() => { handlePm2Action(site.id, "logs", site.name); setMobileMenuOpen(null); }} disabled={pm2Loading} className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm hover:bg-muted transition-colors text-left disabled:opacity-50">
                                <ScrollText className="h-4 w-4" />PM2 Logs
                              </button>
                              <button onClick={() => { handleCleanPm2Logs(site.id, true); setMobileMenuOpen(null); }} className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-red-400 hover:bg-muted transition-colors text-left">
                                <Trash className="h-4 w-4" />Clean Logs
                              </button>
                            </>
                          )}
                          {site.repoUrl && (
                            <button onClick={() => { handleRollbackOpen(site.id, site.name); setMobileMenuOpen(null); }} className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm hover:bg-muted transition-colors text-left">
                              <RotateCcw className="h-4 w-4" />Rollback
                            </button>
                          )}
                          <button onClick={() => { checkUptime(site.id); setMobileMenuOpen(null); }} className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm hover:bg-muted transition-colors text-left">
                            <Timer className="h-4 w-4" />Ping
                          </button>
                          {site.sslInstalled && (
                            <button onClick={() => { handleSslRenewal(site.id); setMobileMenuOpen(null); }} disabled={sslRenewalLoading.has(site.id)} className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-emerald-400 hover:bg-muted transition-colors text-left disabled:opacity-50">
                              <Timer className="h-4 w-4" />Auto-Renew
                            </button>
                          )}
                          {site.webhookToken && (
                            <button onClick={() => { toggleWebhook(site.id); setMobileMenuOpen(null); }} className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-violet-400 hover:bg-muted transition-colors text-left">
                              <Globe className="h-4 w-4" />Webhook
                            </button>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </div>

              {editTarget === site.id && (
                <div className="mt-3 border-t border-border/50 pt-4 space-y-3">
                  <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Edit Site Settings</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-muted-foreground mb-1">Site Name</label>
                      <input name="name" value={editForm.name} onChange={handleEditChange} className="w-full rounded-lg bg-background border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
                    </div>
                    <div>
                      <label className="block text-xs text-muted-foreground mb-1">Domain</label>
                      <input name="domain" value={editForm.domain} onChange={handleEditChange} className="w-full rounded-lg bg-background border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
                    </div>
                    <div>
                      <label className="block text-xs text-muted-foreground mb-1">Repo URL</label>
                      <input name="repoUrl" value={editForm.repoUrl} onChange={handleEditChange} placeholder="https://github.com/user/repo" className="w-full rounded-lg bg-background border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
                    </div>
                    <div className="space-y-1.5">
                      <label className="block text-xs text-muted-foreground mb-1">Access Token</label>
                      {gitTokens.length > 0 && (
                        <select defaultValue="" onChange={(e) => { if (e.target.value) handleEditSelectSavedToken(Number(e.target.value)); }} className="w-full rounded-lg bg-background border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring">
                          <option value="">— Use saved token —</option>
                          {gitTokens.map((t) => <option key={t.id} value={t.id}>{t.label} ({t.host})</option>)}
                        </select>
                      )}
                      <input name="repoToken" type="password" value={editForm.repoToken} onChange={handleEditChange} placeholder="Leave blank to keep existing" className="w-full rounded-lg bg-background border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
                    </div>
                    <div>
                      <label className="block text-xs text-muted-foreground mb-1">Deploy Path</label>
                      <input name="deployPath" value={editForm.deployPath} onChange={handleEditChange} className="w-full rounded-lg bg-background border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
                    </div>
                    <div>
                      <label className="block text-xs text-muted-foreground mb-1">
                        Serve From <span className="opacity-60">(subfolder nginx serves, e.g. <code>dist</code> or <code>artifacts/vps-manager/dist/public</code>)</span>
                      </label>
                      <input name="webRoot" value={editForm.webRoot} onChange={handleEditChange} placeholder="Leave blank to use Deploy Path" className="w-full rounded-lg bg-background border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
                    </div>
                    <div>
                      <label className="block text-xs text-muted-foreground mb-1">Build Command</label>
                      <input name="buildCommand" value={editForm.buildCommand} onChange={handleEditChange} placeholder="npm run build" className="w-full rounded-lg bg-background border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
                    </div>
                    <div>
                      <label className="block text-xs text-muted-foreground mb-1">Site Type</label>
                      <select name="siteType" value={editForm.siteType} onChange={handleEditChange} className="w-full rounded-lg bg-background border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring">
                        <option value="static">Static</option>
                        <option value="nodejs">Node.js</option>
                        <option value="php">PHP</option>
                        <option value="python">Python</option>
                      </select>
                    </div>
                    {cfAccounts && cfAccounts.length > 0 && (
                      <div>
                        <label className="block text-xs text-muted-foreground mb-1">Cloudflare Account <span className="opacity-60">(for DNS)</span></label>
                        <select name="cloudflareConfigId" value={editForm.cloudflareConfigId} onChange={handleEditChange} className="w-full rounded-lg bg-background border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring">
                          <option value={0}>— Auto-detect from all accounts —</option>
                          {cfAccounts.map((a) => <option key={a.id} value={a.id}>{a.label} ({a.email})</option>)}
                        </select>
                      </div>
                    )}
                    {(editForm.siteType === "nodejs" || editForm.siteType === "python") && (<>
                      <div>
                        <label className="block text-xs text-muted-foreground mb-1">
                          App Port <span className="opacity-60">(port your app listens on)</span>
                        </label>
                        <input name="port" type="number" value={editForm.port} onChange={handleEditChange} placeholder="3000" className="w-full rounded-lg bg-background border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
                      </div>
                      <div>
                        <label className="block text-xs text-muted-foreground mb-1">
                          Start Command <span className="opacity-60">(pm2 start command)</span>
                        </label>
                        <input name="startCommand" value={editForm.startCommand} onChange={handleEditChange} placeholder={editForm.siteType === "python" ? "gunicorn app:app" : "npm run start"} className="w-full rounded-lg bg-background border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
                      </div>
                    </>)}
                    <div className="flex items-center gap-2 pt-4">
                      <input name="autoSync" type="checkbox" checked={editForm.autoSync} onChange={handleEditChange} id={`autoSync-${site.id}`} className="rounded" />
                      <label htmlFor={`autoSync-${site.id}`} className="text-sm">Enable auto-sync</label>
                    {(editForm.siteType === "nodejs" || editForm.siteType === "python") && (
                      <div className="mt-3">
                        <label className="block text-xs text-muted-foreground mb-1">Auto-clear logs when size exceeds (MB)</label>
                        <input
                          name="logSizeLimitMb"
                          type="number"
                          min={1}
                          max={500}
                          value={editForm.logSizeLimitMb}
                          onChange={handleEditChange}
                          className="w-full rounded-lg bg-background border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                        />
                        <p className="text-xs text-muted-foreground mt-1">Logs are truncated in-place every 10 min if over this limit — site stays up</p>
                      </div>
                    )}
                    </div>
                  </div>
                  <div className="flex gap-2 pt-1">
                    <button onClick={() => handleEditSaveAndRedeploy(true)} disabled={updateSite.isPending} className="flex items-center gap-1.5 bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-50">
                      <Rocket className="h-3.5 w-3.5" />
                      Save & Redeploy
                    </button>
                    <button onClick={() => handleEditSaveAndRedeploy(false)} disabled={updateSite.isPending} className="bg-muted text-foreground px-4 py-2 rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-50">
                      Save Only
                    </button>
                    <button onClick={() => setEditTarget(null)} className="text-muted-foreground px-4 py-2 rounded-lg text-sm hover:text-foreground">
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {webhookVisible.has(site.id) && site.webhookToken && (
                <div className="bg-muted/30 rounded-lg px-4 py-3 mt-2 border border-border/50">
                  <p className="text-xs text-muted-foreground mb-2 font-medium uppercase tracking-wider">Auto-Deploy Webhook</p>
                  <p className="text-xs text-muted-foreground mb-2">Send a POST request to this URL from GitHub/GitLab to trigger a deploy automatically.</p>
                  <div className="flex items-center gap-2 bg-background rounded-lg px-3 py-2 border border-border font-mono text-xs text-muted-foreground">
                    <span className="flex-1 truncate">{getWebhookUrl(site.webhookToken)}</span>
                    <CopyButton text={getWebhookUrl(site.webhookToken)} />
                  </div>
                </div>
              )}
            </div>
            );
          })}
        </div>
      )}

      {rollbackModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="bg-card border border-border rounded-xl w-full max-w-lg shadow-2xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <h3 className="font-semibold">Rollback — {rollbackModal.name}</h3>
              <button onClick={() => setRollbackModal(null)} className="text-muted-foreground hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="p-5 space-y-3">
              <p className="text-sm text-muted-foreground">Select a commit to roll back to. This will reset the code and restart the app.</p>
              {rollbackModal.commits.length === 0 ? (
                <p className="text-sm text-muted-foreground">No commits found (no git repo at deploy path).</p>
              ) : (
                <div className="space-y-1.5">
                  {rollbackModal.commits.map((c) => (
                    <button
                      key={c.sha}
                      disabled={rollbackLoading}
                      onClick={() => confirmRollback(c.sha)}
                      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg bg-background hover:bg-muted/50 border border-border text-left transition-colors disabled:opacity-50"
                    >
                      <span className="font-mono text-xs text-amber-400 shrink-0">{c.sha.slice(0, 8)}</span>
                      <span className="text-sm flex-1 truncate">{c.subject}</span>
                      <span className="text-xs text-muted-foreground shrink-0">{c.date}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {pm2LogsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="bg-card border border-border rounded-xl w-full max-w-2xl shadow-2xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <h3 className="font-semibold">PM2 Logs — {pm2LogsModal.name}</h3>
              <button onClick={() => setPm2LogsModal(null)} className="text-muted-foreground hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="p-4">
              <pre className="font-mono text-xs text-muted-foreground bg-black/40 rounded-lg p-4 max-h-96 overflow-y-auto whitespace-pre-wrap break-all">
                {pm2LogsModal.output || "(no output)"}
              </pre>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
        title="Remove Site"
        description="This will permanently remove this site from the manager. Files on the VPS will not be deleted."
        confirmLabel="Remove Site"
        onConfirm={confirmDelete}
      />

      {logModal && (
        <LogModal
          open={!!logModal}
          onOpenChange={(open) => { if (!open) setLogModal(null); }}
          title={logModal.title}
          success={logModal.success}
          output={logModal.output}
        />
      )}

      {nginxModal && (
        <NginxConfigModal
          open={!!nginxModal}
          onOpenChange={(open) => { if (!open) setNginxModal(null); }}
          siteId={nginxModal.siteId}
          domain={nginxModal.domain}
        />
      )}

      {liveDeployTarget && (
        <LiveLogModal
          siteId={liveDeployTarget.id}
          siteName={liveDeployTarget.name}
          onClose={() => setLiveDeployTarget(null)}
        />
      )}

      {siteLogsTarget && (
        <SiteLogsModal
          siteId={siteLogsTarget.id}
          domain={siteLogsTarget.domain}
          onClose={() => setSiteLogsTarget(null)}
        />
      )}
    </div>
  );
}
