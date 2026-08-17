import { Sheet, SheetContent, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { useBob } from "@/contexts/BobContext";
import { BobChat } from "./BobChat";

export function BobDrawer() {
  const { open, setOpen } = useBob();

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-[460px] p-0 flex flex-col gap-0"
      >
        <SheetTitle className="sr-only">Bob, your marketing analyst</SheetTitle>
        <SheetDescription className="sr-only">
          Ask Bob about your ads, calls, leads and sales.
        </SheetDescription>
        <BobChat />
      </SheetContent>
    </Sheet>
  );
}

export default BobDrawer;
