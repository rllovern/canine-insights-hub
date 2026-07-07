import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import Index from "./pages/Index.tsx";
import NotFound from "./pages/NotFound.tsx";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Command from "./pages/Command";
import CallTracking from "./pages/CallTracking";
import Keywords from "./pages/Keywords";
import PropertyPage from "./pages/PropertyPage";
import PublicReport from "./pages/PublicReport";
import Reports from "./pages/Reports";
import Assistant from "./pages/Assistant";
import BudgetPacing from "./pages/BudgetPacing";
import AdminProperties from "./pages/admin/AdminProperties";
import AdminUsers from "./pages/admin/AdminUsers";
import AdminSettings from "./pages/admin/AdminSettings";
import AdminClientReports from "./pages/admin/AdminClientReports";
import AdminPipelineMapping from "./pages/admin/AdminPipelineMapping";
import AdminSlaSettings from "./pages/admin/AdminSlaSettings";
import AdminDataSources from "./pages/admin/AdminDataSources";
import LeadPerformance from "./pages/LeadPerformance";
import { AuthProvider } from "./contexts/AuthContext";
import { PreviewModeProvider } from "./contexts/PreviewModeContext";
import { PropertyProvider } from "./contexts/PropertyContext";
import { DateRangeProvider } from "./contexts/DateRangeContext";
import { ScopeProvider } from "./contexts/ScopeContext";
import { AppShell } from "./components/layout/AppShell";
import { RequireAuth } from "./components/RequireAuth";
import { ViewerBlock } from "./components/ViewerBlock";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <PreviewModeProvider>
            <DateRangeProvider>
              <PropertyProvider>
                <ScopeProvider>
                <Routes>
                  <Route path="/" element={<Index />} />
                  <Route path="/login" element={<Login />} />
                  <Route path="/report/:token" element={<PublicReport />} />
                  <Route
                    path="/admin/client-reports"
                    element={<RequireAuth requireStaff><AdminClientReports /></RequireAuth>}
                  />
                  <Route
                    path="/admin/client-reports/:propertyId"
                    element={<RequireAuth requireStaff><AdminClientReports /></RequireAuth>}
                  />

                  <Route element={<RequireAuth><AppShell /></RequireAuth>}>
                    <Route path="/command" element={<Command />} />
                    <Route path="/dashboard" element={<ViewerBlock><Dashboard /></ViewerBlock>} />
                    <Route path="/calls" element={<ViewerBlock><CallTracking /></ViewerBlock>} />
                    <Route path="/keywords" element={<ViewerBlock><Keywords /></ViewerBlock>} />
                    <Route path="/properties/:slug" element={<ViewerBlock><PropertyPage /></ViewerBlock>} />
                    <Route path="/assistant" element={<ViewerBlock><Assistant /></ViewerBlock>} />
                    <Route path="/reports" element={<ViewerBlock><Reports /></ViewerBlock>} />
                    <Route path="/budget" element={<BudgetPacing />} />
                    <Route path="/lead-performance" element={<ViewerBlock><LeadPerformance /></ViewerBlock>} />
                    <Route
                      path="/admin/properties"
                      element={<RequireAuth requireStaff><AdminProperties /></RequireAuth>}
                    />
                    <Route
                      path="/admin/pipeline-mapping"
                      element={<RequireAuth requireSuperAdmin><AdminPipelineMapping /></RequireAuth>}
                    />
                    <Route
                      path="/admin/sla-settings"
                      element={<RequireAuth requireSuperAdmin><AdminSlaSettings /></RequireAuth>}
                    />
                    <Route
                      path="/admin/data-sources"
                      element={<RequireAuth requireSuperAdmin><AdminDataSources /></RequireAuth>}
                    />
                    <Route
                      path="/admin/users"
                      element={<RequireAuth requireSuperAdmin><AdminUsers /></RequireAuth>}
                    />
                    <Route
                      path="/admin/settings"
                      element={<RequireAuth requireSuperAdmin><AdminSettings /></RequireAuth>}
                    />
                  </Route>

                  <Route path="*" element={<NotFound />} />
                </Routes>
                </ScopeProvider>
              </PropertyProvider>
            </DateRangeProvider>
          </PreviewModeProvider>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
