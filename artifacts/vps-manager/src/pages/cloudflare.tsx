import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListCloudflareConfigs,
  useCreateCloudflareConfig,
  useDeleteCloudflareConfig,
  useGetCloudflareZones,
  useCreateDnsRecord,
  getListCloudflareConfigsQueryKey,
} from "@workspace/api-client-react";
import { Cloud, Plus, Trash2, ChevronDown, ChevronRight, Globe } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

function ZoneManager({ configId, serverIp }: { configId: number; serverIp?: string }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [dnsForm, setDnsForm] = useState({ zoneId: "", domain: "", ip: serverIp ?? "", proxied: true });
  const { data: zones, isLoading } = useGetCloudflareZones(configId, { query: { enabled: expanded } });
  const createDns = useCreateDnsRecord();

  function handleDns(e: React.FormEvent) {
    e.preventDefault();
    createDns.mutate(
      { params: { id: configId }, data: dnsForm },
      {
        onSuccess: (result) => {
          toast({
            title: result.success ? "DNS record created" : "DNS creation failed",
            description: result.output,
            variant: result.success ? "default" : "destructive",
          });
          queryClient.invalidateQueries({ queryKey: getListCloudflareConfigsQueryKey() });
        },
        onError: () => toast({ title: "DNS creation failed", variant: "destructive" }),
      }
    );
  }

  return (
    <div className="mt-3 border border-border/50 rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-4 py-3 bg-muted/30 hover:bg-muted/50 text-sm transition-colors"
      >
        {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        Manage DNS Records
        {isLoading && <span className="text-muted-foreground ml-2">Loading zones...</span>}
      </button>
      {expanded && (
        <div className="p-4 space-y-4">
          {zones && zones.length > 0 && (
            <div>
              <p className="text-xs text-muted-foreground mb-2 font-medium uppercase tracking-wider">Your Zones</p>
              <div className="space-y-1">
                {zones.map((zone) => (
                  <div key={zone.id} className="flex items-center justify-between text-sm px-3 py-2 bg-muted/30 rounded-lg">
                    <span className="flex items-center gap-2">
                      <Globe className="h-3 w-3 text-muted-foreground" />
                      {zone.name}
                    </span>
                    <button
                      onClick={() => setDnsForm((f) => ({ ...f, zoneId: zone.id, domain: zone.name }))}
                      className="text-xs text-blue-400 hover:text-blue-300"
                    >
                      Use
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
          <form onSubmit={handleDns} className="space-y-3">
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Create DNS A Record</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-muted-foreground mb-1">Zone ID</label>
                <input value={dnsForm.zoneId} onChange={(e) => setDnsForm((f) => ({ ...f, zoneId: e.target.value }))} placeholder="abc123..." required className="w-full rounded-lg bg-background border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
              </div>
              <div>
                <label className="block text-xs text-muted-foreground mb-1">Domain / Subdomain</label>
                <input value={dnsForm.domain} onChange={(e) => setDnsForm((f) => ({ ...f, domain: e.target.value }))} placeholder="mysite.com" required className="w-full rounded-lg bg-background border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
              </div>
              <div>
                <label className="block text-xs text-muted-foreground mb-1">Server IP</label>
                <input value={dnsForm.ip} onChange={(e) => setDnsForm((f) => ({ ...f, ip: e.target.value }))} placeholder="1.2.3.4" required className="w-full rounded-lg bg-background border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
              </div>
              <div className="flex items-end pb-2">
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="checkbox" checked={dnsForm.proxied} onChange={(e) => setDnsForm((f) => ({ ...f, proxied: e.target.checked }))} />
                  Proxied through Cloudflare
                </label>
              </div>
            </div>
            <button type="submit" disabled={createDns.isPending} className="bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-50">
              {createDns.isPending ? "Creating..." : "Create Record"}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

export default function CloudflarePage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: configs, isLoading } = useListCloudflareConfigs();
  const createConfig = useCreateCloudflareConfig();
  const deleteConfig = useDeleteCloudflareConfig();

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ label: "", email: "", apiToken: "", zoneId: "" });

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const { name, value } = e.target;
    setForm((f) => ({ ...f, [name]: value }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    createConfig.mutate(
      { data: { ...form, zoneId: form.zoneId || null } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListCloudflareConfigsQueryKey() });
          setShowForm(false);
          setForm({ label: "", email: "", apiToken: "", zoneId: "" });
          toast({ title: "Cloudflare account added" });
        },
        onError: () => toast({ title: "Failed to add Cloudflare account", variant: "destructive" }),
      }
    );
  }

  function handleDelete(id: number) {
    if (!confirm("Remove this Cloudflare account?")) return;
    deleteConfig.mutate(
      { params: { id } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListCloudflareConfigsQueryKey() });
          toast({ title: "Cloudflare account removed" });
        },
        onError: () => toast({ title: "Failed to remove", variant: "destructive" }),
      }
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Cloudflare</h1>
          <p className="text-muted-foreground mt-1">Manage DNS records and SSL via Cloudflare.</p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm font-medium hover:opacity-90"
        >
          <Plus className="h-4 w-4" />
          Add Account
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className="rounded-xl border border-border bg-card p-6 space-y-4">
          <h2 className="text-lg font-semibold">New Cloudflare Account</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-muted-foreground mb-1">Label</label>
              <input name="label" value={form.label} onChange={handleChange} placeholder="My Cloudflare Account" required className="w-full rounded-lg bg-background border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
            </div>
            <div>
              <label className="block text-sm text-muted-foreground mb-1">Email</label>
              <input name="email" type="email" value={form.email} onChange={handleChange} placeholder="me@example.com" required className="w-full rounded-lg bg-background border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
            </div>
            <div className="col-span-2">
              <label className="block text-sm text-muted-foreground mb-1">API Token</label>
              <input name="apiToken" type="password" value={form.apiToken} onChange={handleChange} placeholder="Cloudflare API Token" required className="w-full rounded-lg bg-background border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
            </div>
            <div className="col-span-2">
              <label className="block text-sm text-muted-foreground mb-1">Zone ID (optional)</label>
              <input name="zoneId" value={form.zoneId} onChange={handleChange} placeholder="Optional default zone ID" className="w-full rounded-lg bg-background border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
            </div>
          </div>
          <div className="flex gap-3 pt-2">
            <button type="submit" disabled={createConfig.isPending} className="bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-50">
              {createConfig.isPending ? "Adding..." : "Add Account"}
            </button>
            <button type="button" onClick={() => setShowForm(false)} className="bg-muted text-foreground px-4 py-2 rounded-lg text-sm font-medium hover:opacity-90">
              Cancel
            </button>
          </div>
        </form>
      )}

      {isLoading ? (
        <div className="text-muted-foreground text-sm">Loading...</div>
      ) : !configs || configs.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-12 text-center">
          <Cloud className="h-10 w-10 text-muted-foreground mx-auto mb-4" />
          <p className="text-muted-foreground">No Cloudflare accounts yet. Add one to manage DNS and SSL.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {configs.map((config) => (
            <div key={config.id} className="rounded-xl border border-border bg-card p-6">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-semibold">{config.label}</div>
                  <div className="text-sm text-muted-foreground">{config.email}</div>
                  {config.zoneId && <div className="text-xs text-muted-foreground mt-1 font-mono">Zone: {config.zoneId}</div>}
                </div>
                <button
                  onClick={() => handleDelete(config.id)}
                  className="p-2 text-muted-foreground hover:text-red-400 transition-colors"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
              <ZoneManager configId={config.id} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
