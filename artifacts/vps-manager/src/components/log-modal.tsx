import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CheckCircle2, XCircle } from "lucide-react";

interface LogModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  success: boolean;
  output: string;
}

export function LogModal({ open, onOpenChange, title, success, output }: LogModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card border-border max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {success
              ? <CheckCircle2 className="h-5 w-5 text-emerald-400" />
              : <XCircle className="h-5 w-5 text-red-400" />}
            {title}
          </DialogTitle>
        </DialogHeader>
        <div className="mt-2">
          <pre className="bg-background rounded-lg p-4 text-xs text-muted-foreground font-mono overflow-auto max-h-80 whitespace-pre-wrap break-all border border-border">
            {output || "(no output)"}
          </pre>
        </div>
      </DialogContent>
    </Dialog>
  );
}
