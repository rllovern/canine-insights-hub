import { AlertTriangle, Info, OctagonAlert } from "lucide-react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useNotices, type Announcement, type Severity } from "@/contexts/NoticeContext";

const SEVERITY: Record<Severity, { Icon: typeof Info; cls: string; label: string }> = {
  info: { Icon: Info, cls: "text-primary", label: "Notice" },
  warning: { Icon: AlertTriangle, cls: "text-amber-600", label: "Important" },
  critical: { Icon: OctagonAlert, cls: "text-destructive", label: "Urgent" },
};

/** Shared body so the admin preview matches what an owner actually sees. */
export function AnnouncementBody({ announcement }: { announcement: Pick<Announcement, "title" | "body" | "severity"> }) {
  const { Icon, cls, label } = SEVERITY[announcement.severity] ?? SEVERITY.info;
  return (
    <div className="space-y-2">
      <div className={`flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide ${cls}`}>
        <Icon className="h-3.5 w-3.5" /> {label}
      </div>
      <div className="text-base font-semibold">{announcement.title}</div>
      <p className="text-[13px] text-muted-foreground whitespace-pre-wrap">{announcement.body}</p>
    </div>
  );
}

export function AnnouncementDialog() {
  const { currentAnnouncement, dismissAnnouncement } = useNotices();
  if (!currentAnnouncement) return null;

  return (
    <Dialog open onOpenChange={(o) => { if (!o) void dismissAnnouncement(currentAnnouncement); }}>
      <DialogContent className="max-w-md">
        <DialogHeader className="sr-only">
          <DialogTitle>{currentAnnouncement.title}</DialogTitle>
        </DialogHeader>
        <AnnouncementBody announcement={currentAnnouncement} />
        <DialogFooter>
          <Button onClick={() => void dismissAnnouncement(currentAnnouncement)}>Got it</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
