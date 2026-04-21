import { useState, useEffect } from "react";
import { Bell, Save, HardDrive, Cpu } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface SettingsData {
  alertWebhookUrl: string | null;
  diskAlertThreshold: number;
  ramAlertThreshold: number;
}

export default function SettingsPage() {
  const { toast } = useToast();
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");
  const [data, setData] = useState<SettingsData | null>(null);
  const [webhookUrl, setWebhookUrl] = useState("");
  const [diskThreshold, setDiskThreshold] = useState(85);
  const [ramThreshold, setRamThreshold] = useState(90);
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${base}/api/settings`)
      .then((r) => r.json())
      .then((d: SettingsData) => {
        setData(d);
        setWebhookUrl(d.alertWebhookUrl ?? "");
        setDiskThreshold(d.diskAlertThreshold ?? 85);
        setRamThreshold(d.ramAlertThreshold ?? 90);
      })
      .catch(() => {});
  }, []);

  async function save(fields: Partial<SettingsData>, key: string) {
    setSaving(key);
    try {
      const r = await fetch(`${base}/api/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fields),
      });
      const d = await r.json() as SettingsData;
      setData(d);
      toast({ title: "Settings saved" });
    } catch {
      toast({ title: "Failed to save", variant: "destructive" });
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground mt-1 text-sm">Configure global VPS Manager settings.</p>
      </div>

      {/* Alert Webhook */}
      <div className="rounded-xl border border-border bg-card p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Bell className="h-4 w-4 text-muted-foreground" />
          <h2 className="font-semibold">Alert Webhook</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          Receive alerts for deploy failures, SSL expiry, and resource warnings via a POST request (e.g. Slack / Discord webhook).
        </p>
        <div className="flex gap-2">
          <input
            value={webhookUrl}
            onChange={(e) => setWebhookUrl(e.target.value)}
            placeholder="https://hooks.slack.com/services/..."
            className="flex-1 rounded-lg bg-background border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <button
            onClick={() => save({ alertWebhookUrl: webhookUrl || null }, "webhook")}
            disabled={saving === "webhook"}
            className="flex items-center gap-1.5 bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-50"
          >
            <Save className="h-3.5 w-3.5" />
            Save
          </button>
        </div>
        {webhookUrl && (
          <button
            onClick={() => { setWebhookUrl(""); save({ alertWebhookUrl: null }, "webhook"); }}
            className="text-xs text-muted-foreground hover:text-red-400"
          >
            Clear webhook URL
          </button>
        )}
      </div>

      {/* Resource Alert Thresholds */}
      <div className="rounded-xl border border-border bg-card p-5 space-y-5">
        <div className="flex items-center gap-2">
          <HardDrive className="h-4 w-4 text-muted-foreground" />
          <h2 className="font-semibold">Resource Alert Thresholds</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          The monitor checks disk and RAM on all servers every 30 minutes and sends an alert webhook when usage exceeds these thresholds.
        </p>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <label className="text-sm font-medium flex items-center gap-1.5">
              <HardDrive className="h-3.5 w-3.5 text-muted-foreground" />
              Disk usage alert
            </label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={50}
                max={99}
                value={diskThreshold}
                onChange={(e) => setDiskThreshold(Number(e.target.value))}
                className="w-20 rounded-lg bg-background border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
              <span className="text-sm text-muted-foreground">%</span>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium flex items-center gap-1.5">
              <Cpu className="h-3.5 w-3.5 text-muted-foreground" />
              RAM usage alert
            </label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={50}
                max={99}
                value={ramThreshold}
                onChange={(e) => setRamThreshold(Number(e.target.value))}
                className="w-20 rounded-lg bg-background border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
              <span className="text-sm text-muted-foreground">%</span>
            </div>
          </div>
        </div>

        <button
          onClick={() => save({ diskAlertThreshold: diskThreshold, ramAlertThreshold: ramThreshold }, "thresholds")}
          disabled={saving === "thresholds"}
          className="flex items-center gap-1.5 bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-50"
        >
          <Save className="h-3.5 w-3.5" />
          {saving === "thresholds" ? "Saving…" : "Save Thresholds"}
        </button>
      </div>
    </div>
  );
}
