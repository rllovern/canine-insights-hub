import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface BackendUnavailableProps {
  onRetry: () => void;
  retrying?: boolean;
}

/**
 * Shown instead of an indefinite "Loading…" when the backend does not answer
 * within the auth gate's timeout. The session is left untouched so the user is
 * not signed out by a temporary outage.
 */
export function BackendUnavailable({ onRetry, retrying }: BackendUnavailableProps) {
  return (
    <div className="grid min-h-screen place-items-center px-6">
      <div className="w-full max-w-md space-y-4 rounded-lg border border-border bg-card p-6 text-center">
        <div className="mx-auto grid size-11 place-items-center rounded-full bg-muted">
          <AlertTriangle className="size-5 text-muted-foreground" aria-hidden />
        </div>
        <div className="space-y-1.5">
          <h1 className="text-base font-semibold text-foreground">Can’t reach the backend</h1>
          <p className="text-sm text-muted-foreground">
            The dashboard couldn’t load your account because the server didn’t respond. This is
            usually temporary — you’re still signed in.
          </p>
        </div>
        <Button onClick={onRetry} disabled={retrying} className="w-full">
          <RefreshCw className={`size-4 ${retrying ? "animate-spin" : ""}`} aria-hidden />
          {retrying ? "Retrying…" : "Retry"}
        </Button>
      </div>
    </div>
  );
}