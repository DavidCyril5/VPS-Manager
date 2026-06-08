import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useGetNginxConfig, useUpdateNginxConfig } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { Save, RefreshCw } from "lucide-react";

interface NginxConfigModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  siteId: number;
  domain: string;
}

export function NginxConfigModal({ open, onOpenChange, siteId, domain }: NginxConfigModalProps) {
  const { toast } = useToast();
  const [editedConfig, setEditedConfig] = useState("");

  const { data, isLoading, refetch } = useGetNginxConfig(siteId, {
    query: { enabled: open && !!siteId },
  });

  const updateConfig = useUpdateNginxConfig();

  useEffect(() => {
    if (data?.config) {
      setEditedConfig(data.config);
    }
  }, [data?.config]);

  function handleSave() {
    updateConfig.mutate(
      { id: siteId, data: { config: editedConfig } },
      {
        onSuccess: (result) => {
          toast({
            title: result.success ? "Nginx config updated" : "Config update failed",
            description: result.success ? "Nginx reloaded successfully." : result.error ?? undefined,
            variant: result.success ? "default" : "destructive",
          });
          if (result.success) onOpenChange(false);
        },
        onError: () => toast({ title: "Failed to update config", variant: "destructive" }),
      }
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card border-border max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between">
            <span>Nginx Config — {domain}</span>
            <button
              onClick={() => refetch()}
              className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 mr-6"
            >
              <RefreshCw className="h-3 w-3" />
              Reload
            </button>
          </DialogTitle>
        </DialogHeader>
        {isLoading ? (
          <div className="text-muted-foreground text-sm py-4">Loading config...</div>
        ) : (
          <textarea
            value={editedConfig}
            onChange={(e) => setEditedConfig(e.target.value)}
            className="w-full h-80 bg-background border border-border rounded-lg p-4 text-xs font-mono text-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-none"
            spellCheck={false}
          />
        )}
        <DialogFooter>
          <button
            onClick={() => onOpenChange(false)}
            className="bg-muted text-foreground px-4 py-2 rounded-lg text-sm hover:bg-muted/70"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={updateConfig.isPending || isLoading}
            className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-50"
          >
            <Save className="h-4 w-4" />
            {updateConfig.isPending ? "Saving..." : "Save & Reload Nginx"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
