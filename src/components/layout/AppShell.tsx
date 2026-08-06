import { Outlet } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";
import { DashboardProvider } from "@/contexts/DashboardContext";
import { JarvisCommandBar } from "@/components/jarvis/JarvisCommandBar";
import { TourProvider } from "@/contexts/TourContext";
import { TourOverlay } from "@/components/tour/TourOverlay";

export function AppShell() {
  return (
    <DashboardProvider>
      <TourProvider>
      <div className="h-screen flex bg-background overflow-hidden">
        <Sidebar />
        <div className="flex-1 flex flex-col min-w-0 h-screen overflow-y-auto">
          <TopBar />
          <main id="dashboard-canvas" data-tour="page-root" className="flex-1 min-w-0 px-4 pt-4 pb-24 sm:px-6 sm:py-6 space-y-6 animate-fade-in">
            <Outlet />
          </main>
        </div>
        <JarvisCommandBar />
      </div>
      <TourOverlay />
      </TourProvider>
    </DashboardProvider>
  );
}