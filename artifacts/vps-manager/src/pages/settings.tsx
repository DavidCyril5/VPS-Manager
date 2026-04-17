import { useState, useEffect } from "react";
import { Settings, Bell, Lock, Save } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface SettingsData {
  alertWebhookUrl: string | null;
  hasAdminPassword: boolean;
}

export default function SettingsPage() {
  const { toast } = useToast();
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");
  const [data, setData] = useState<SettingsData | null>(null);
  const [webhookUrl, setWebhookUrl] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch(`${base}/api/settings`, { headers: { Authorization: `Bearer ${localStorage.getItem("vpm-token") ?? ""}` } })
      .then((r) => r.json())
      .then((d: SettingsData) => {
        setData(d);
        setWebhookUrl(d.alertWebhookUrl ?? "");
      })
      .catch(() => {});
  }, []);

  async function saveWebhook() {
    setSaving(true);
    try {
      const r = await fetch(`${base}/api/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("vpm-token") ?? ""}` },
        body: JSON.stringify({ alertWebhookUrl: webhookUrl || null }),
      });
      const d = await r.json() as SettingsData;
      setData(d);
      toast({ title: "Webhook URL saved" });
    } catch {
      toast({ title: "Failed to save", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function savePassword() {
    if (!newPassword) return;
    if (newPassword !== confirmPassword) { toast({ title: "Passwords don't match", variant: "destructive" }); return; }
    if (newPassword.length < 8) { toast({ title: "Password must be at least 8 characters", variant: "destructive" }); return; }
    setSaving(true);
    try {
      await fetch(`${base}/api/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("vpm-token") ?? ""}` },
        body: JSON.stringify({ adminPassword: newPassword }),
      });
      setNewPassword("");
      setConfirmPassword("");
      toast({ title: "Password updated" });
    } catch {
      toast({ title: "Failed to update password", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground mt-1 text-sm">Configure global VPS Manager settings.</p>
      </div>

      <div className="rounded-xl border border-border bg-card p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Bell className="h-4 w-4 text-muted-foreground" />
          <h2 className="font-semibold">Deploy Failure Alerts</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          When a deployment fails, a POST request with JSON details is sent to this URL (e.g. a Slack/Discord webhook).
        </p>
        <div className="flex gap-2">
          <input
            value={webhookUrl}
            onChange={(e) => setWebhookUrl(e.target.value)}
            placeholder="https://hooks.slack.com/services/..."
            className="flex-1 rounded-lg bg-background border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <button
            onClick={saveWebhook}
            disabled={saving}
            className="flex items-center gap-1.5 bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-50"
          >
            <Save className="h-3.5 w-3.5" />
            Save
          </button>
        </div>
        {webhookUrl && (
          <button
            onClick={() => { setWebhookUrl(""); saveWebhook(); }}
            className="text-xs text-muted-foreground hover:text-red-400"
          >
            Clear webhook URL
          </button>
        )}
      </div>

      <div className="rounded-xl border border-border bg-card p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Lock className="h-4 w-4 text-muted-foreground" />
          <h2 className="font-semibold">Admin Password</h2>
          {data?.hasAdminPassword && (
            <span className="text-xs bg-emerald-900/40 text-emerald-400 border border-emerald-800/50 px-2 py-0.5 rounded-full">Set</span>
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          Set or change the admin password. The <code className="text-xs bg-muted px-1 py-0.5 rounded">ADMIN_PASSWORD</code> environment variable must also be set to enable login protection.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-muted-foreground mb-1">New Password</label>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Min. 8 characters"
              className="w-full rounded-lg bg-background border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <div>
            <label className="block text-xs text-muted-foreground mb-1">Confirm Password</label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Repeat password"
              className="w-full rounded-lg bg-background border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
        </div>
        <button
          onClick={savePassword}
          disabled={saving || !newPassword}
          className="flex items-center gap-1.5 bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-50"
        >
          <Save className="h-3.5 w-3.5" />
          Update Password
        </button>
      </div>
    </div>
  );
}
