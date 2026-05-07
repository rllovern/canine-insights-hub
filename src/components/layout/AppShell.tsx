import { Outlet } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";
import { DashboardProvider } from "@/contexts/DashboardContext";

export function AppShell() {
  return (
    <DashboardProvider>
      <div className="min-h-screen flex overflow-x-hidden bg-background">
        <Sidebar />
        <div className="flex-1 flex flex-col min-w-0">
          <TopBar />
          <main id="dashboard-canvas" className="flex-1 min-w-0 px-4 pt-4 pb-24 sm:px-6 sm:py-6 space-y-6 animate-fade-in">
            <Outlet />
          </main>
        </div>
      </div>
    </DashboardProvider>
  );
}