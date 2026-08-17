import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useBob } from "@/contexts/BobContext";
import { useBobIntro } from "@/contexts/BobIntroContext";
import { useScope } from "@/contexts/ScopeContext";
import { BobFace } from "./BobFace";
import { buildQuickPrompts } from "./quickPrompts";

export function BobIntroDialog() {
  const { open, dismiss } = useBobIntro();
  const { openBob } = useBob();
  const { mode, activeProperty, label: scopeLabel } = useScope();

  const place = mode === "property" ? activeProperty?.name ?? scopeLabel : "all locations";
  const examples = buildQuickPrompts({ placeLabel: place, count: 3 });

  const launch = (prompt?: string) => {
    dismiss();
    openBob(prompt);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) dismiss(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader className="items-center text-center">
          <div className="mb-1">
            <BobFace scale={0.8} mood="happy" />
          </div>
          <DialogTitle className="text-xl">Meet Bob, your marketing assistant</DialogTitle>
          <DialogDescription>
            Bob is here so you never have to decode a dashboard on your own.
          </DialogDescription>
        </DialogHeader>

        <ul className="space-y-2 text-sm text-muted-foreground">
          <li className="flex gap-2">
            <span aria-hidden className="text-foreground">•</span>
            Ask him anything in normal words — no marketing jargon needed.
          </li>
          <li className="flex gap-2">
            <span aria-hidden className="text-foreground">•</span>
            He reads your real numbers straight off this dashboard, so his answers match your cards.
          </li>
          <li className="flex gap-2">
            <span aria-hidden className="text-foreground">•</span>
            He follows the location and date range you picked at the top of the page.
          </li>
          <li className="flex gap-2">
            <span aria-hidden className="text-foreground">•</span>
            He lives behind the round face in the bottom-right corner of every page.
          </li>
        </ul>

        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Try one of these
          </p>
          <div className="flex flex-wrap gap-2">
            {examples.map((q) => (
              <button
                key={q.id}
                type="button"
                onClick={() => launch(q.question)}
                className="rounded-full border bg-muted/40 px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted"
              >
                {q.label}
              </button>
            ))}
          </div>
        </div>

        <p className="text-xs text-muted-foreground">
          Bob sticks to leads, ads and verified sales. Anything outside that, ask the admin team.
        </p>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={dismiss}>Got it</Button>
          <Button onClick={() => launch()}>Try Bob</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default BobIntroDialog;
