import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./contexts/AuthContext";

// Temporary stubs — replaced one at a time with real ported pages.
function Stub({ name }: { name: string }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-white dark:bg-gray-900">
      <h1 className="text-2xl font-bold text-brand-600">{name} (not built yet)</h1>
    </div>
  );
}

function LandingPage() { return <Stub name="Landing Page" />; }
function LoginPage() { return <Stub name="Login Page" />; }
function CandidateDashboard() { return <Stub name="Candidate Dashboard" />; }
function UpcomingInterviews() { return <Stub name="Upcoming Interviews" />; }
function CompletedInterviews() { return <Stub name="Completed Interviews (Candidate)" />; }
function InterviewerDashboard() { return <Stub name="Interviewer Dashboard" />; }
function ScheduleInterview() { return <Stub name="Schedule Interview" />; }
function PositionsList() { return <Stub name="Positions List" />; }
function QuestionsBank() { return <Stub name="Questions Bank" />; }
function CandidatesList() { return <Stub name="Candidates List" />; }
function CompletedList() { return <Stub name="Completed List (Interviewer)" />; }
function InterviewRoomPage() { return <Stub name="Interview Room" />; }
function ReportPage() { return <Stub name="Report Page" />; }

function ProtectedRoute({
  children,
  allowedRole,
}: {
  children: React.ReactNode;
  allowedRole?: "INTERVIEWER" | "CANDIDATE";
}) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-white dark:bg-gray-900">
        <p className="text-gray-500">Loading...</p>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (allowedRole && user.role !== allowedRole) {
    return <Navigate to={user.role === "INTERVIEWER" ? "/interviewer/dashboard" : "/candidate/dashboard"} replace />;
  }

  return <>{children}</>;
}

function DashboardRedirect() {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user) return <Navigate to="/login" replace />;
  return <Navigate to={user.role === "INTERVIEWER" ? "/interviewer/dashboard" : "/candidate/dashboard"} replace />;
}

function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/dashboard" element={<DashboardRedirect />} />

      <Route
        path="/candidate/dashboard"
        element={
          <ProtectedRoute allowedRole="CANDIDATE">
            <CandidateDashboard />
          </ProtectedRoute>
        }
      />
      <Route
        path="/candidate/upcoming"
        element={
          <ProtectedRoute allowedRole="CANDIDATE">
            <UpcomingInterviews />
          </ProtectedRoute>
        }
      />
      <Route
        path="/candidate/completed"
        element={
          <ProtectedRoute allowedRole="CANDIDATE">
            <CompletedInterviews />
          </ProtectedRoute>
        }
      />

      <Route
        path="/interviewer/dashboard"
        element={
          <ProtectedRoute allowedRole="INTERVIEWER">
            <InterviewerDashboard />
          </ProtectedRoute>
        }
      />
      <Route
        path="/interviewer/schedule"
        element={
          <ProtectedRoute allowedRole="INTERVIEWER">
            <ScheduleInterview />
          </ProtectedRoute>
        }
      />
      <Route
        path="/interviewer/positions"
        element={
          <ProtectedRoute allowedRole="INTERVIEWER">
            <PositionsList />
          </ProtectedRoute>
        }
      />
      <Route
        path="/interviewer/questions"
        element={
          <ProtectedRoute allowedRole="INTERVIEWER">
            <QuestionsBank />
          </ProtectedRoute>
        }
      />
      <Route
        path="/interviewer/candidates"
        element={
          <ProtectedRoute allowedRole="INTERVIEWER">
            <CandidatesList />
          </ProtectedRoute>
        }
      />
      <Route
        path="/interviewer/completed"
        element={
          <ProtectedRoute allowedRole="INTERVIEWER">
            <CompletedList />
          </ProtectedRoute>
        }
      />

      <Route
        path="/interview/:id"
        element={
          <ProtectedRoute>
            <InterviewRoomPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/report/:id"
        element={
          <ProtectedRoute>
            <ReportPage />
          </ProtectedRoute>
        }
      />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default App;