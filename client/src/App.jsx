import { BrowserRouter, Navigate, Routes, Route } from 'react-router-dom';
import { lazy, Suspense, useState } from 'react';
import { AuthProvider } from './context/AuthContext';
import ProtectedRoute from './components/common/ProtectedRoute';
import SplashScreen from './components/common/SplashScreen';
import LoadingSpinner from './components/common/LoadingSpinner';
import useAuth from './hooks/useAuth';
import PrivacyConsentGate from './components/common/PrivacyConsentGate';
import AuthFlow from './pages/auth/AuthFlow';

const Login = lazy(() => import('./pages/auth/Login'));
const Register = lazy(() => import('./pages/auth/Register'));
const ForgotPassword = lazy(() => import('./pages/auth/ForgotPassword'));
const ResetPassword = lazy(() => import('./pages/auth/ResetPassword'));
const StudentDashboard = lazy(() => import('./pages/student/StudentDashboard'));
const CoordinatorDashboard = lazy(() => import('./pages/coordinator/CoordinatorDashboard'));
const SupervisorDashboard = lazy(() => import('./pages/supervisor/SupervisorDashboard'));

const ROLE_ROUTES = {
  student: '/student',
  coordinator: '/coordinator',
  supervisor: '/supervisor',
};

export { ROLE_ROUTES };

const AppEntry = () => {
  const { user, loading } = useAuth();
  if (loading) return <LoadingSpinner message="Preparing your workspace" />;
  return <Navigate to={user ? (ROLE_ROUTES[user.role] || '/login') : '/login'} replace />;
};

function App() {
  const [showSplash, setShowSplash] = useState(
    !sessionStorage.getItem('splashShown')
  );

  const handleSplashDone = () => {
    sessionStorage.setItem('splashShown', 'true');
    setShowSplash(false);
  };

  return (
    <>
      {showSplash && <SplashScreen key="splash" onDone={handleSplashDone} />}
      <AuthProvider key="auth-provider">
        <BrowserRouter>
          <PrivacyConsentGate><Suspense fallback={<LoadingSpinner />}>
          <Routes>
            <Route element={<AuthFlow />}>
              <Route path="/login" element={<Login />} />
              <Route path="/register" element={<Register />} />
              <Route path="/forgot-password" element={<ForgotPassword />} />
              <Route path="/reset-password" element={<ResetPassword />} />
            </Route>

            <Route element={<ProtectedRoute allowedRoles={['student']} />}>
              <Route path="/student/*" element={<StudentDashboard />} />
            </Route>

            <Route element={<ProtectedRoute allowedRoles={['coordinator']} />}>
              <Route path="/coordinator/*" element={<CoordinatorDashboard />} />
            </Route>

            <Route element={<ProtectedRoute allowedRoles={['supervisor']} />}>
              <Route path="/supervisor/*" element={<SupervisorDashboard />} />
            </Route>

            <Route path="/admin" element={<Navigate to="/coordinator" replace />} />
            <Route path="/admin/*" element={<Navigate to="/coordinator" replace />} />
            <Route path="/" element={<AppEntry />} />
            <Route path="*" element={<AppEntry />} />
          </Routes>
          </Suspense></PrivacyConsentGate>
        </BrowserRouter>
      </AuthProvider>
    </>
  );
}

export default App;
