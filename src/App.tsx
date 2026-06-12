import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import Index from "./pages/Index.tsx";
import NotFound from "./pages/NotFound.tsx";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
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
import LeadPerformance from "./pages/LeadPerformance";
import { AuthProvider } from "./contexts/AuthContext";
import { PreviewModeProvider } from "./contexts/PreviewModeContext";
import { PropertyProvider } from "./contexts/PropertyContext";
import { DateRangeProvider } from "./contexts/DateRangeContext";
import { AppShell } from "./components/layout/AppShell";
import { RequireAuth } from "./components/RequireAuth";

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
                <Routes>
                  <Route path="/" element={<Index />} />
                  <Route path="/login" element={<Login />} />
                  <Route path="/report/:token" element={<PublicReport />} />
                  <Route
                    path="/admin/client-reports"
                    element={<RequireAuth requireRealRole="internal"><AdminClientReports /></RequireAuth>}
                  />
                  <Route
                    path="/admin/client-reports/:propertyId"
                    element={<RequireAuth requireRealRole="internal"><AdminClientReports /></RequireAuth>}
                  />

                  <Route element={<RequireAuth><AppShell /></RequireAuth>}>
                    <Route path="/dashboard" element={<Dashboard />} />
                    <Route path="/calls" element={<CallTracking />} />
                    <Route path="/keywords" element={<Keywords />} />
                    <Route path="/properties/:slug" element={<PropertyPage />} />
                    <Route path="/assistant" element={<Assistant />} />
                    <Route path="/reports" element={<Reports />} />
                    <Route path="/budget" element={<RequireAuth requireRealRole="internal"><BudgetPacing /></RequireAuth>} />
                    <Route path="/lead-performance" element={<LeadPerformance />} />
                    <Route
                      path="/admin/properties"
                      element={<RequireAuth requireRealRole="internal"><AdminProperties /></RequireAuth>}
                    />
                    <Route
                      path="/admin/pipeline-mapping"
                      element={<RequireAuth requireRealRole="internal"><AdminPipelineMapping /></RequireAuth>}
                    />
                    <Route
                      path="/admin/sla-settings"
                      element={<RequireAuth requireRealRole="internal"><AdminSlaSettings /></RequireAuth>}
                    />
                    <Route
                      path="/admin/users"
                      element={<RequireAuth requireRealRole="internal"><AdminUsers /></RequireAuth>}
                    />
                    <Route
                      path="/admin/settings"
                      element={<RequireAuth requireRealRole="internal"><AdminSettings /></RequireAuth>}
                    />
                  </Route>

                  <Route path="*" element={<NotFound />} />
                </Routes>
              </PropertyProvider>
            </DateRangeProvider>
          </PreviewModeProvider>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
