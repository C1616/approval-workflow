import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { NavBar } from "./components/NavBar";
import { LoginPage } from "./pages/LoginPage";
import { MyApplicationsPage } from "./pages/MyApplicationsPage";
import { ApplicationFormPage } from "./pages/ApplicationFormPage";
import { ApplicationDetailPage } from "./pages/ApplicationDetailPage";
import { ReviewerQueuePage } from "./pages/ReviewerQueuePage";

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <div style={{ padding: 32 }}>Loading...</div>;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function HomeRedirect() {
  const { user } = useAuth();
  if (user?.role === "REVIEWER") return <Navigate to="/queue" replace />;
  return <MyApplicationsPage />;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/*"
        element={
          <RequireAuth>
            <NavBar />
            <Routes>
              <Route path="/" element={<HomeRedirect />} />
              <Route path="/applications/new" element={<ApplicationFormPage mode="create" />} />
              <Route path="/applications/:id" element={<ApplicationDetailPage />} />
              <Route path="/applications/:id/edit" element={<ApplicationFormPage mode="edit" />} />
              <Route path="/queue" element={<ReviewerQueuePage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </RequireAuth>
        }
      />
    </Routes>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </AuthProvider>
  );
}
