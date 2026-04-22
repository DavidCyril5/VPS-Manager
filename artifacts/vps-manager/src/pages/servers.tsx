import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListServers,
  useCreateServer,
  useDeleteServer,
  useTestServerConnection,
  useInstallNginx,
  getListServersQueryKey,
} from "@workspace/api-client-react";
import { Server, Plus, Trash2, Wifi, Settings2, CheckCircle2, XCircle, WifiOff, Pencil, X, ShieldCheck } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { LogModal } from "@/components/log-modal";

const statusIcon: Record<string, React.ReactNode> = {
  connected: <CheckCircle2 className="h-4 w-4 text-emerald-400" />,
  disconnected: <XCircle className="h-4 w-4 text-red-400" />,
  unknown: <WifiOff className="h-4 w-4 text-muted-foreground" />,
};

export default function Servers() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: servers, isLoading } = useListServers({ query: { refetchInterval: 30000 } });
  const createServer = useCreateServer();
  const deleteServer = useDeleteServer();
  const testConn = useTestServerConnection();
  const installNginx = useInstallNginx();

  const [showForm, setShowForm] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<number | null>(null);
  const [logModal, setLogModal] = useState<{ title: string; success: boolean; output: string } | null>(null);
  const [editTarget, setEditTarget] = useState<number | null>(null);
  const [editForm, setEditForm] = useState({ name: "", host: "", port: 22, username: "", password: "", privateKey: "" });
  const [editSaving, setEditSaving] = useState(false);
  const [watchdogLoading, setWatchdogLoading] = useState<number | null>(null);
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");
  const [form, setForm] = useState({
    name: "",
    host: "",
    port: 22,
    username: "root",
    password: "",
    privateKey: "",
  });

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const { name, value } = e.target;
    setForm((f) => ({ ...f, [name]: name === "port" ? Number(value) : value }));
  }

  function handleEditChange(e: React.ChangeEvent<HTMLInputElement>) {
    const { name, value } = e.target;
    setEditForm((f) => ({ ...f, [name]: name === "port" ? Number(value) : value }));
  }

  function openEdit(server: { id: number; name: string; host: string; port: number; username: string; status: string }) {
    setEditTarget(server.id);
    setEditForm({ name: server.name, host: server.host, port: server.port, username: server.username, password: "", privateKey: "" });
  }

  async function handleEditSave() {
    if (!editTarget) return;
    setEditSaving(true);
    try {
      const body: Record<string, unknown> = { ...editForm };
      if (!body.password) delete body.password;
      if (!body.privateKey) delete body.privateKey;
      const r = await fetch(`${base}/api/servers/${editTarget}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("vpm-token") ?? ""}` },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error("Failed");
      queryClient.invalidateQueries({ queryKey: getListServersQueryKey() });
      setEditTarget(null);
      toast({ title: "Server updated" });
    } catch {
      toast({ title: "Failed to update server", variant: "destructive" });
    } finally {
      setEditSaving(false);
    }
  }

  async function handleSetupWatchdog(id: number) {
    setWatchdogLoading(id);
    try {
      const r = await fetch(`${base}/api/servers/${id}/setup-watchdog`, {
        method: "POST",
        headers: { Authorization: `Bearer ${localStorage.getItem("vpm-token") ?? ""}` },
      });
      const d = await r.json() as { success: boolean; output: string };
      setLogModal({
        title: d.success ? "Watchdog Installed" : "Watchdog Setup Failed",
        success: d.success,
        output: d.output,
      });
      if (d.success) toast({ title: "Watchdog active — sites will auto-restart every minute if crashed" });
      else toast({ title: "Watchdog setup failed", variant: "destructive" });
    } catch {
      toast({ title: "Failed to connect to server", variant: "destructive" });
    } finally {
      setWatchdogLoading(null);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    createServer.mutate(
      { data: { ...form, privateKey: form.privateKey || null } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListServersQueryKey() });
          setShowForm(false);
          setForm({ name: "", host: "", port: 22, username: "root", password: "", privateKey: "" });
          toast({ title: "Server added successfully" });
        },
        onError: () => toast({ title: "Failed to add server", variant: "destructive" }),
      }
    );
  }

  function handleDelete(id: number) {
    setDeleteTarget(id);
  }

  function confirmDelete() {
    if (!deleteTarget) return;
    deleteServer.mutate(
      { id: deleteTarget },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListServersQueryKey() });
          toast({ title: "Server removed" });
        },
        onError: () => toast({ title: "Failed to remove server", variant: "destructive" }),
      }
    );
    setDeleteTarget(null);
  }

  function handleTest(id: number) {
    testConn.mutate(
      { id },
      {
        onSuccess: (result) => {
          queryClient.invalidateQueries({ queryKey: getListServersQueryKey() });
          setLogModal({
            title: result.success ? "Connection Successful" : "Connection Failed",
            success: result.success,
            output: result.output ?? result.message,
          });
        },
        onError: () => toast({ title: "Test failed", variant: "destructive" }),
      }
    );
  }

  function handleInstallNginx(id: number) {
    toast({ title: "Installing Nginx...", description: "This may take a minute." });
    installNginx.mutate(
      { id },
      {
        onSuccess: (result) => {
          queryClient.invalidateQueries({ queryKey: getListServersQueryKey() });
          setLogModal({
            title: result.success ? "Nginx Installed" : "Nginx Install Failed",
            success: result.success,
            output: result.output,
          });
        },
        onError: () => toast({ title: "Install failed", variant: "destructive" }),
      }
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Servers</h1>
          <p className="text-muted-foreground mt-1 text-sm sm:text-base">Manage your VPS servers.</p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-2 bg-primary text-primary-foreground px-3 py-2 sm:px-4 rounded-lg text-sm font-medium hover:opacity-90 transition-opacity shrink-0"
        >
          <Plus className="h-4 w-4" />
          <span className="hidden sm:inline">Add Server</span>
          <span className="sm:hidden">Add</span>
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className="rounded-xl border border-border bg-card p-6 space-y-4">
          <h2 className="text-lg font-semibold">New Server</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-muted-foreground mb-1">Name</label>
              <input name="name" value={form.name} onChange={handleChange} placeholder="My VPS" required className="w-full rounded-lg bg-background border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
            </div>
            <div>
              <label className="block text-sm text-muted-foreground mb-1">Host / IP</label>
              <input name="host" value={form.host} onChange={handleChange} placeholder="114.29.239.118" required className="w-full rounded-lg bg-background border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
            </div>
            <div>
              <label className="block text-sm text-muted-foreground mb-1">Port</label>
              <input name="port" type="number" value={form.port} onChange={handleChange} required className="w-full rounded-lg bg-background border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
            </div>
            <div>
              <label className="block text-sm text-muted-foreground mb-1">Username</label>
              <input name="username" value={form.username} onChange={handleChange} required className="w-full rounded-lg bg-background border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
            </div>
            <div>
              <label className="block text-sm text-muted-foreground mb-1">Password</label>
              <input name="password" type="password" value={form.password} onChange={handleChange} className="w-full rounded-lg bg-background border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
            </div>
            <div>
              <label className="block text-sm text-muted-foreground mb-1">Private Key (optional)</label>
              <input name="privateKey" value={form.privateKey} onChange={handleChange} placeholder="Paste SSH private key..." className="w-full rounded-lg bg-background border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
            </div>
          </div>
          <div className="flex gap-3 pt-2">
            <button type="submit" disabled={createServer.isPending} className="bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-50">
              {createServer.isPending ? "Adding..." : "Add Server"}
            </button>
            <button type="button" onClick={() => setShowForm(false)} className="bg-muted text-foreground px-4 py-2 rounded-lg text-sm font-medium hover:opacity-90">
              Cancel
            </button>
          </div>
        </form>
      )}

      {isLoading ? (
        <div className="text-muted-foreground text-sm">Loading...</div>
      ) : !servers || servers.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-12 text-center">
          <Server className="h-10 w-10 text-muted-foreground mx-auto mb-4" />
          <p className="font-medium text-muted-foreground">No servers yet</p>
          <p className="text-sm text-muted-foreground mt-1">Add your first VPS to get started.</p>
          <button onClick={() => setShowForm(true)} className="mt-4 bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm font-medium hover:opacity-90">
            Add Server
          </button>
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-card divide-y divide-border">
          {servers.map((server) => (
            <div key={server.id} className="px-4 py-3 sm:px-6 sm:py-4 space-y-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <div className="shrink-0">
                  {statusIcon[server.status] ?? statusIcon["unknown"]}
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold">{server.name}</span>
                    {server.nginxInstalled && (
                      <span className="text-xs bg-emerald-900/40 text-emerald-400 border border-emerald-800/50 px-2 py-0.5 rounded-full">Nginx</span>
                    )}
                    <span className={`text-xs px-2 py-0.5 rounded-full border capitalize ${
                      server.status === "connected"
                        ? "bg-emerald-900/20 text-emerald-400 border-emerald-800/50"
                        : server.status === "disconnected"
                        ? "bg-red-900/20 text-red-400 border-red-800/50"
                        : "bg-muted/30 text-muted-foreground border-border"
                    }`}>
                      {server.status}
                    </span>
                  </div>
                  <div className="text-sm text-muted-foreground truncate">
                    {server.username}@{server.host}:{server.port}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  onClick={() => handleTest(server.id)}
                  disabled={testConn.isPending}
                  className="flex items-center gap-1.5 text-xs bg-muted hover:bg-muted/70 text-foreground px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
                >
                  <Wifi className="h-3 w-3" />
                  Test
                </button>
                {!server.nginxInstalled && (
                  <button
                    onClick={() => handleInstallNginx(server.id)}
                    disabled={installNginx.isPending}
                    className="flex items-center gap-1.5 text-xs bg-muted hover:bg-muted/70 text-foreground px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
                  >
                    <Settings2 className="h-3 w-3" />
                    Install Nginx
                  </button>
                )}
                <button
                  onClick={() => handleSetupWatchdog(server.id)}
                  disabled={watchdogLoading === server.id}
                  className="flex items-center gap-1.5 text-xs bg-emerald-900/40 hover:bg-emerald-900/60 text-emerald-300 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
                  title="Install a cron-based watchdog that restarts crashed apps every minute, and configure PM2 to survive reboots"
                >
                  <ShieldCheck className="h-3 w-3" />
                  {watchdogLoading === server.id ? "Installing…" : "Watchdog"}
                </button>
                <Link href={`/servers/${server.id}`} className="flex items-center gap-1.5 text-xs bg-muted hover:bg-muted/70 text-foreground px-3 py-1.5 rounded-lg transition-colors">
                  <Settings2 className="h-3 w-3" />
                  Details
                </Link>
                <button
                  onClick={() => editTarget === server.id ? setEditTarget(null) : openEdit(server)}
                  className="p-1.5 text-muted-foreground hover:text-amber-400 transition-colors"
                  title="Edit server credentials"
                >
                  {editTarget === server.id ? <X className="h-4 w-4" /> : <Pencil className="h-4 w-4" />}
                </button>
                <button
                  onClick={() => handleDelete(server.id)}
                  className="p-1.5 text-muted-foreground hover:text-red-400 transition-colors"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
              </div>
              {editTarget === server.id && (
                <div className="border-t border-border/50 pt-4 pb-1 px-1 mt-1 space-y-3">
                  <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Edit Server Credentials</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-muted-foreground mb-1">Name</label>
                      <input name="name" value={editForm.name} onChange={handleEditChange} className="w-full rounded-lg bg-background border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
                    </div>
                    <div>
                      <label className="block text-xs text-muted-foreground mb-1">Host / IP</label>
                      <input name="host" value={editForm.host} onChange={handleEditChange} className="w-full rounded-lg bg-background border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
                    </div>
                    <div>
                      <label className="block text-xs text-muted-foreground mb-1">Port</label>
                      <input name="port" type="number" value={editForm.port} onChange={handleEditChange} className="w-full rounded-lg bg-background border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
                    </div>
                    <div>
                      <label className="block text-xs text-muted-foreground mb-1">Username</label>
                      <input name="username" value={editForm.username} onChange={handleEditChange} className="w-full rounded-lg bg-background border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
                    </div>
                    <div>
                      <label className="block text-xs text-muted-foreground mb-1">Password <span className="opacity-60">(leave blank to keep existing)</span></label>
                      <input name="password" type="password" value={editForm.password} onChange={handleEditChange} placeholder="New password..." className="w-full rounded-lg bg-background border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
                    </div>
                    <div>
                      <label className="block text-xs text-muted-foreground mb-1">Private Key <span className="opacity-60">(leave blank to keep existing)</span></label>
                      <input name="privateKey" value={editForm.privateKey} onChange={handleEditChange} placeholder="Paste SSH key..." className="w-full rounded-lg bg-background border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={handleEditSave} disabled={editSaving} className="bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-50">
                      {editSaving ? "Saving..." : "Save"}
                    </button>
                    <button onClick={() => setEditTarget(null)} className="bg-muted text-foreground px-4 py-2 rounded-lg text-sm hover:opacity-90">
                      Cancel
                    </button>
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
        title="Remove Server"
        description="This will permanently remove this server from the manager. Sites on this server will also be removed."
        confirmLabel="Remove Server"
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
    </div>
  );
}
