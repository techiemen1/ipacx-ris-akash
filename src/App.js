import React, { Suspense, lazy } from "react";
import { BrowserRouter as Router, Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "react-hot-toast";

// Pages & Components
const Login = lazy(() => import("./components/Login/login"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const Scheduling = lazy(() => import("./pages/Scheduling"));
const PACSpage = lazy(() => import("./pages/PACSpage"));
const AddPatient = lazy(() => import("./pages/AddPatient"));
const PatientList = lazy(() => import("./pages/PatientList"));
const _CreateReport = lazy(() => import("./pages/CreateReport"));
const ReportingPage = lazy(() => import("./pages/ReportingPage"));
const ReportPanelPage = lazy(() => import("./pages/ReportPanel"));
const _ReportPanelV2Page = lazy(() => import("./pages/ReportPanelV2"));
const MWLS = lazy(() => import("./pages/MWLS"));
const TemplateManagement = lazy(() => import("./pages/adminsettings/TemplateManagement"));
const UserManagement = lazy(() => import("./pages/adminsettings/UserManagement"));
const MwlsManagement = lazy(() => import("./pages/adminsettings/MwlsManagement"));
const Billing = lazy(() => import("./pages/Billing"));
const PriceManagement = lazy(() => import("./pages/adminsettings/PriceManagement"));
const ClinicManagement = lazy(() => import("./pages/adminsettings/ClinicManagement"));
const HospitalManagement = lazy(() => import("./pages/adminsettings/HospitalManagement"));
const BackupManagement = lazy(() => import("./pages/adminsettings/BackupManagement"));
const DoctorPortal = lazy(() => import("./pages/DoctorPortal"));

import ProtectedRoute from "./components/ProtectedRoute";
// import MainLayout from "./layout/MainLayout";
const _AddNewReportPage = lazy(() => import("./pages/AddNewReportPage"));
const ReportedBy = lazy(() => import("./pages/adminsettings/ReportedBy"));
const AuditLogs = lazy(() => import("./pages/adminsettings/AuditLogs"));
const MobileLiteViewer = lazy(() => import("./pages/MobileLiteViewer"));


// Context
import { StudiesProvider } from "./context/StudiesContext";
import { PatientProvider } from "./context/PatientContext";
import { ClinicProvider } from "./context/ClinicContext";
import { useAuth } from "./context/AuthContext";
import ErrorBoundary from "./components/ErrorBoundary";

function App() {
  const { user } = useAuth();

  return (
    <ErrorBoundary>
      <Router>
        <Toaster position="top-right" />
        <ClinicProvider>
          <PatientProvider>
            <StudiesProvider>
            <Suspense fallback={<div className="route-loading">Loading...</div>}>
              <Routes>
                {/* Public/Login route */}
                <Route path="/" element={<Login />} />

                {/* Protected routes */}
                <Route
                  path="/dashboard"
                  element={
                    <ProtectedRoute>
                      <Dashboard />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/doctor-portal"
                  element={
                    <ProtectedRoute>
                      <DoctorPortal />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/scheduling"
                  element={
                    <ProtectedRoute>
                      <Scheduling />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/pacspage"
                  element={
                    <ProtectedRoute>
                      <PACSpage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/patient-list"
                  element={
                    <ProtectedRoute>
                      <PatientList />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/billing"
                  element={
                    <ProtectedRoute>
                      <Billing />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/add-patient"
                  element={
                    <ProtectedRoute>
                      <AddPatient />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/create-report"
                  element={
                    <ProtectedRoute>
                      <ReportPanelPage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/reporting"
                  element={
                    <ProtectedRoute>
                      <ReportingPage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/report-editor"
                  element={
                    <ProtectedRoute>
                      <ReportPanelPage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/report-editor/:studyUID"
                  element={
                    <ProtectedRoute>
                      <ReportPanelPage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/mwls"
                  element={
                    <ProtectedRoute>
                      <MWLS />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/report-panel"
                  element={
                    <ProtectedRoute>
                      <ReportPanelPage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/report-panel-v2"
                  element={
                    <ProtectedRoute>
                      <ReportPanelPage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/secure-report-sheet"
                  element={<ReportPanelPage />}
                />
                <Route
                  path="/add-new-report"
                  element={
                    <ProtectedRoute>
                      <ReportPanelPage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/lite"
                  element={
                    <ProtectedRoute>
                      <MobileLiteViewer />
                    </ProtectedRoute>
                  }
                />
                {/* Admin routes */}
                <Route
                  path="/admin/clinics"
                  element={
                    <ProtectedRoute roles={["ADMIN"]}>
                      <ClinicManagement />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/admin/hospitals"
                  element={
                    <ProtectedRoute roles={["ADMIN"]}>
                      <HospitalManagement />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/admin/backups"
                  element={
                    <ProtectedRoute roles={["ADMIN"]}>
                      <BackupManagement />
                    </ProtectedRoute>
                  }
                />

                <Route
                  path="/admin/templates"
                  element={
                    <ProtectedRoute roles={["ADMIN"]}>
                      <TemplateManagement />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/admin/user-management"
                  element={
                    <ProtectedRoute roles={["ADMIN"]}>
                      <UserManagement />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/admin/reportedby"
                  element={
                    <ProtectedRoute roles={["ADMIN"]}>
                      <ReportedBy />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/admin/mwls-management"
                  element={
                    <ProtectedRoute roles={["ADMIN"]}>
                      <MwlsManagement />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/admin/audit-logs"
                  element={
                    <ProtectedRoute roles={["ADMIN"]}>
                      <AuditLogs />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/admin/prices"
                  element={
                    <ProtectedRoute roles={["ADMIN"]}>
                      <PriceManagement />
                    </ProtectedRoute>
                  }
                />

                {/* Redirect unknown routes */}
                <Route path="*" element={<Navigate to={user ? "/dashboard" : "/"} replace />} />
              </Routes>
            </Suspense>
          </StudiesProvider>
        </PatientProvider>
      </ClinicProvider>
    </Router>
  </ErrorBoundary>
);
}

export default App;

