import { ReactNode } from "react";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";
import { AIAssistant } from "@/components/ai/AIAssistant";
import { useAuth } from "@/contexts/AuthContext";
import { PublicShell } from "./PublicShell";

export function AppShell({ title, children }: { title: string; children: ReactNode }) {
  const { isPublicReport } = useAuth();

  if (isPublicReport) {
    return <PublicShell>{children}</PublicShell>;
  }

  return (
    <div className="min-h-screen flex overflow-x-hidden bg-background">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <TopBar title={title} />
        <main id="dashboard-canvas" className="flex-1 min-w-0 px-4 pt-4 pb-24 sm:px-6 sm:py-6 space-y-6 animate-fade-in">
          {children}
        </main>
      </div>
      <AIAssistant />
    </div>
  );
}
