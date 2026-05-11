import { ReactNode } from "react";
import { Property } from "@/lib/types";
import ridgesideLogo from "@/assets/ridgeside-ashtabula-logo.webp";

export function PublicShell({
  property,
  toolbar,
  children,
}: {
  property: Property;
  toolbar?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-screen w-full flex-col bg-background">
      <header className="border-b border-border bg-card/40">
        <div className="flex w-full flex-col items-center gap-3 px-4 py-4 sm:px-6 md:grid md:grid-cols-3 md:items-center md:gap-4">
          <div className="flex w-full items-center justify-center md:justify-start">
            <img
              src={ridgesideLogo}
              alt={property.name}
              className="h-12 w-auto max-w-full object-contain sm:h-14"
            />
          </div>
          <div className="flex flex-col items-center text-center">
            <span className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">Performance Report</span>
            <h1 className="text-base font-semibold tracking-tight sm:text-lg">{property.name}</h1>
          </div>
          <div className="flex w-full flex-wrap items-center justify-center gap-2 md:justify-end">{toolbar}</div>
        </div>
      </header>
      <main className="w-full flex-1 overflow-x-hidden px-4 py-6 sm:px-6">{children}</main>
      <footer className="border-t border-border py-4 text-center text-[11px] text-muted-foreground">
        Powered by Ridgeside Canine Dashboard
      </footer>
    </div>
  );
}