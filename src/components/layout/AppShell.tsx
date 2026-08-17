import { Outlet } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";
import { DashboardProvider } from "@/contexts/DashboardContext";
import { BobCommandBar } from "@/components/bob/BobCommandBar";
import { BobDrawer } from "@/components/bob/BobDrawer";
import { BobLauncher } from "@/components/bob/BobLauncher";
import { BobProvider } from "@/contexts/BobContext";
import { BobIntroProvider } from "@/contexts/BobIntroContext";
import { BobIntroDialog } from "@/components/bob/BobIntroDialog";
import { TourProvider } from "@/contexts/TourContext";
import { TourOverlay } from "@/components/tour/TourOverlay";

export function AppShell() {
  return (
    <DashboardProvider>
      <TourProvider>
      <BobProvider>
      <BobIntroProvider>
      <div className="h-screen flex bg-background overflow-hidden">
        <Sidebar />
        <div className="flex-1 flex flex-col min-w-0 h-screen overflow-y-auto">
          <TopBar />
          <main id="dashboard-canvas" data-tour="page-root" className="flex-1 min-w-0 px-4 pt-4 pb-24 sm:px-6 sm:py-6 space-y-6 animate-fade-in">
            <Outlet />
          </main>
        </div>
        <BobCommandBar />
        <BobLauncher />
        <BobDrawer />
        <BobIntroDialog />
      </div>
      <TourOverlay />
      </BobIntroProvider>
      </BobProvider>
      </TourProvider>
    </DashboardProvider>
  );
}