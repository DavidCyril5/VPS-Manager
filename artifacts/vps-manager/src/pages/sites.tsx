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
  getListSitesQueryKey,
} from "@workspace/api-client-react";
import { Globe, Plus, Trash2, Rocket, ShieldCheck, ExternalLink, Copy, Check, FileCode, Clock, Key, Save, Pencil, X, Search, BookOpen, Lock, Unlock } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { LogModal } from "@/components/log-modal";
import { NginxConfigModal } from "@/components/nginx-config-modal";
import { LiveLogModal } from "@/components/live-log-modal";

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
  const [showForm, setShowForm] = useState(false);
  const [editTarget, setEditTarget] = useState<number | null>(null);
  const [editForm, setEditForm] = useState({
    name: "", domain: "", repoUrl: "", repoToken: "",
    deployPath: "", webRoot: "", buildCommand: "", siteType: "static", autoSync: false,
  });
  const [deleteTarget, setDeleteTarget] = useState<number | null>(null);
  const [logModal, setLogModal] = useState<{ title: string; success: boolean; output: string } | null>(null);
  const [liveDeployTarget, setLiveDeployTarget] = useState<{ id: number; name: string } | null>(null);
  const [nginxModal, setNginxModal] = useState<{ siteId: number; domain: string } | null>(null);
  const [webhookVisible, setWebhookVisible] = useState<Set<number>>(new Set());
  const [saveTokenLabel, setSaveTokenLabel] = useState("");
  const [showSaveToken, setShowSaveToken] = useState(false);
  const [showManageTokens, setShowManageTokens] = useState(false);

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
    siteType: "static" as const,
    autoSync: false,
  });

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
    setEditTarget(site.id);
    setEditForm({
      name: site.name ?? "",
      domain: site.domain ?? "",
      repoUrl: (site as unknown as Record<string, string>).repoUrl ?? "",
      repoToken: "",
      deployPath: (site as unknown as Record<string, string>).deployPath ?? "",
      webRoot: (site as unknown as Record<string, string>).webRoot ?? "",
      buildCommand: (site as unknown as Record<string, string>).buildCommand ?? "",
      siteType: site.siteType ?? "static",
      autoSync: (site as unknown as Record<string, boolean>).autoSync ?? false,
    });
  }

  function handleEditChange(e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) {
    const { name, value, type } = e.target;
    setEditForm((f) => ({
      ...f,
      [name]: type === "checkbox" ? (e.target as HTMLInputElement).checked : value,
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
      const updated = { ...f, [name]: checked !== undefined ? checked : name === "serverId" ? Number(value) : value };
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
    const base = window.location.origin + import.meta.env.BASE_URL.replace(/\/$/, "");
    return `${base}/api/webhook/${token}`;
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
      ) : (
        <div className="rounded-xl border border-border bg-card divide-y divide-border">
          {sites.map((site) => (
            <div key={site.id} className="px-6 py-4 space-y-2">
              <div className="flex items-center gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 mb-1 flex-wrap">
                    <span className="font-semibold">{site.name}</span>
                    <span className={`text-xs border px-2 py-0.5 rounded-full capitalize ${statusColors[site.status] ?? statusColors.stopped}`}>
                      {site.status}
                    </span>
                    {site.sslInstalled && (
                      <span className="text-xs bg-emerald-900/40 text-emerald-400 border border-emerald-800/50 px-2 py-0.5 rounded-full">SSL</span>
                    )}
                    {site.sslExpiresAt && <SslExpiryBadge expiresAt={site.sslExpiresAt} />}
                    {site.autoSync && (
                      <span className="text-xs bg-blue-900/40 text-blue-400 border border-blue-800/50 px-2 py-0.5 rounded-full">Auto-sync</span>
                    )}
                    <span className="text-xs bg-muted px-1.5 py-0.5 rounded">{site.siteType}</span>
                  </div>
                  <div className="text-sm text-muted-foreground flex items-center gap-2">
                    <ExternalLink className="h-3 w-3" />
                    <a href={`http://${site.domain}`} target="_blank" rel="noreferrer" className="hover:text-foreground transition-colors">
                      {site.domain}
                    </a>
                    {site.lastDeployedAt && <span className="text-xs">· Last deployed {new Date(site.lastDeployedAt).toLocaleDateString()}</span>}
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button
                    onClick={() => handleDeploy(site.id)}
                    disabled={deploySite.isPending}
                    className="flex items-center gap-1.5 text-xs bg-blue-900/30 hover:bg-blue-900/50 text-blue-400 border border-blue-800/50 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
                  >
                    <Rocket className="h-3 w-3" />
                    Deploy
                  </button>
                  {site.status === "active" && (
                    <button
                      onClick={() => handleSsl(site.id)}
                      disabled={installSsl.isPending}
                      className="flex items-center gap-1.5 text-xs bg-emerald-900/30 hover:bg-emerald-900/50 text-emerald-400 border border-emerald-800/50 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
                      title={site.sslInstalled ? "Reinstall / renew SSL certificate" : "Install SSL certificate"}
                    >
                      <ShieldCheck className="h-3 w-3" />
                      {site.sslInstalled ? "Renew SSL" : "SSL"}
                    </button>
                  )}
                  <button
                    onClick={() => setNginxModal({ siteId: site.id, domain: site.domain })}
                    className="flex items-center gap-1.5 text-xs bg-muted hover:bg-muted/70 text-foreground px-3 py-1.5 rounded-lg transition-colors"
                    title="View/Edit Nginx Config"
                  >
                    <FileCode className="h-3 w-3" />
                    Nginx
                  </button>
                  {site.webhookToken && (
                    <button
                      onClick={() => toggleWebhook(site.id)}
                      className="flex items-center gap-1.5 text-xs bg-violet-900/30 hover:bg-violet-900/50 text-violet-400 border border-violet-800/50 px-3 py-1.5 rounded-lg transition-colors"
                      title="Webhook URL"
                    >
                      Webhook
                    </button>
                  )}
                  <button
                    onClick={() => editTarget === site.id ? setEditTarget(null) : openEdit(site)}
                    className="p-1.5 text-muted-foreground hover:text-amber-400 transition-colors"
                    title="Edit site settings"
                  >
                    {editTarget === site.id ? <X className="h-4 w-4" /> : <Pencil className="h-4 w-4" />}
                  </button>
                  <button
                    onClick={() => setDeleteTarget(site.id)}
                    className="p-1.5 text-muted-foreground hover:text-red-400 transition-colors"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>

              {editTarget === site.id && (
                <div className="mt-3 border-t border-border/50 pt-4 space-y-3">
                  <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Edit Site Settings</p>
                  <div className="grid grid-cols-2 gap-3">
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
                    <div className="flex items-center gap-2 pt-4">
                      <input name="autoSync" type="checkbox" checked={editForm.autoSync} onChange={handleEditChange} id={`autoSync-${site.id}`} className="rounded" />
                      <label htmlFor={`autoSync-${site.id}`} className="text-sm">Enable auto-sync</label>
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
          ))}
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
    </div>
  );
}
