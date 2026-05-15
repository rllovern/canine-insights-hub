import { ReactNode } from "react";
import logoUrl from "@/assets/ridgeside-logo-full.webp";
import logoUrlWhite from "@/assets/ridgeside-logo-full-white.png";

export function AuthShell({ children, title, subtitle }: { children: ReactNode; title: string; subtitle?: string }) {
  return (
    <div className="grid min-h-screen w-full bg-background lg:grid-cols-2">
      {/* Left: brand panel */}
      <div className="relative hidden flex-col justify-between overflow-hidden bg-sidebar p-12 text-sidebar-foreground lg:flex">
        <div
          className="pointer-events-none absolute inset-0 opacity-40"
          style={{
            background:
              "radial-gradient(1200px 600px at -10% -20%, hsl(var(--accent) / 0.25), transparent 60%), radial-gradient(900px 500px at 110% 120%, hsl(var(--gold) / 0.18), transparent 60%)",
          }}
        />
          <div className="relative">
            <img
              src={logoUrlWhite}
              alt="Ridgeside K9 — Professional Dog Training"
              className="h-40 w-auto object-contain"
            />
          </div>
          <div className="relative max-w-lg">
            <h2 className="font-serif text-4xl font-semibold leading-tight tracking-tight xl:text-5xl">
              Building bonds, not barriers — training that lasts a lifetime.
            </h2>
            <p className="mt-4 text-base text-sidebar-foreground/70">
              The unified analytics dashboard for every Ridgeside K9 location.
            </p>
          </div>
          <div className="relative text-xs text-sidebar-foreground/50">
            © {new Date().getFullYear()} Ridgeside K9
          </div>
      </div>

      {/* Right: auth form */}
      <div className="flex items-center justify-center p-6 sm:p-12">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex justify-center lg:hidden">
            <img src={logoUrl} alt="Ridgeside K9" className="h-20 w-auto object-contain" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
          <div className="mt-8">{children}</div>
        </div>
      </div>
    </div>
  );
}