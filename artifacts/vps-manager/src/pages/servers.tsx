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
import { Server, Plus, Trash2, Wifi, WifiOff, Settings2, CheckCircle2, XCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";

const statusIcon: Record<string, React.ReactNode> = {
  connected: <CheckCircle2 className="h-4 w-4 text-emerald-400" />,
  disconnected: <XCircle className="h-4 w-4 text-red-400" />,
  unknown: <WifiOff className="h-4 w-4 text-muted-foreground" />,
};

export default function Servers() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: servers, isLoading } = useListServers();
  const createServer = useCreateServer();
  const deleteServer = useDeleteServer();
  const testConn = useTestServerConnection();
  const installNginx = useInstallNginx();

  const [showForm, setShowForm] = useState(false);
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
    if (!confirm("Remove this server?")) return;
    deleteServer.mutate(
      { params: { id } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListServersQueryKey() });
          toast({ title: "Server removed" });
        },
        onError: () => toast({ title: "Failed to remove server", variant: "destructive" }),
      }
    );
  }

  function handleTest(id: number) {
    testConn.mutate(
      { params: { id } },
      {
        onSuccess: (result) => {
          queryClient.invalidateQueries({ queryKey: getListServersQueryKey() });
          toast({
            title: result.success ? "Connection successful" : "Connection failed",
            description: result.message,
            variant: result.success ? "default" : "destructive",
          });
        },
        onError: () => toast({ title: "Test failed", variant: "destructive" }),
      }
    );
  }

  function handleInstallNginx(id: number) {
    toast({ title: "Installing Nginx...", description: "This may take a minute." });
    installNginx.mutate(
      { params: { id } },
      {
        onSuccess: (result) => {
          queryClient.invalidateQueries({ queryKey: getListServersQueryKey() });
          toast({
            title: result.success ? "Nginx installed" : "Nginx install failed",
            description: result.success ? undefined : result.error ?? undefined,
            variant: result.success ? "default" : "destructive",
          });
        },
        onError: () => toast({ title: "Install failed", variant: "destructive" }),
      }
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Servers</h1>
          <p className="text-muted-foreground mt-1">Manage your VPS servers.</p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm font-medium hover:opacity-90 transition-opacity"
        >
          <Plus className="h-4 w-4" />
          Add Server
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className="rounded-xl border border-border bg-card p-6 space-y-4">
          <h2 className="text-lg font-semibold">New Server</h2>
          <div className="grid grid-cols-2 gap-4">
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
          <p className="text-muted-foreground">No servers yet. Add your first VPS to get started.</p>
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-card divide-y divide-border">
          {servers.map((server) => (
            <div key={server.id} className="flex items-center gap-4 px-6 py-4">
              <div className="flex items-center gap-2">
                {statusIcon[server.status] ?? statusIcon["unknown"]}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-3">
                  <span className="font-semibold">{server.name}</span>
                  {server.nginxInstalled && (
                    <span className="text-xs bg-emerald-900/40 text-emerald-400 border border-emerald-800/50 px-2 py-0.5 rounded-full">Nginx</span>
                  )}
                </div>
                <div className="text-sm text-muted-foreground">
                  {server.username}@{server.host}:{server.port}
                </div>
              </div>
              <div className="flex items-center gap-2">
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
                <Link href={`/servers/${server.id}`} className="flex items-center gap-1.5 text-xs bg-muted hover:bg-muted/70 text-foreground px-3 py-1.5 rounded-lg transition-colors">
                  <Settings2 className="h-3 w-3" />
                  Details
                </Link>
                <button
                  onClick={() => handleDelete(server.id)}
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
