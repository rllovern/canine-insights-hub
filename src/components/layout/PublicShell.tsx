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
        <div className="grid w-full grid-cols-3 items-center gap-4 px-6 py-4">
          <div className="flex items-center justify-start">
            <img
              src={ridgesideLogo}
              alt={property.name}
              className="h-14 w-auto object-contain"
            />
          </div>
          <div className="flex flex-col items-center text-center">
            <span className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">Performance Report</span>
            <h1 className="text-lg font-semibold tracking-tight">{property.name}</h1>
          </div>
          <div className="flex items-center justify-end">{toolbar}</div>
        </div>
      </header>
      <main className="w-full flex-1 px-6 py-6">{children}</main>
      <footer className="border-t border-border py-4 text-center text-[11px] text-muted-foreground">
        Powered by Ridgeside Canine Dashboard
      </footer>
    </div>
  );
}