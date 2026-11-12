import { lazy, Suspense } from 'react';
import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { HOME, useAuth } from './lib/auth.jsx';
import { Spinner } from './components/ui.jsx';
import Shell from './components/Shell.jsx';
import Login from './pages/Login.jsx';
import { Forbidden, NotFound } from './pages/Misc.jsx';

// Route-level code splitting keeps the first load small
const Patients = lazy(() => import('./pages/Patients.jsx'));
const Appointments = lazy(() => import('./pages/frontdesk/Appointments.jsx'));
const Booking = lazy(() => import('./pages/frontdesk/Booking.jsx'));
const Billing = lazy(() => import('./pages/Billing.jsx'));
const Queue = lazy(() => import('./pages/clinician/Queue.jsx'));
const PatientRecord = lazy(() => import('./pages/clinician/PatientRecord.jsx'));
const Dashboard = lazy(() => import('./pages/admin/Dashboard.jsx'));
const Directory = lazy(() => import('./pages/admin/Directory.jsx'));
const Activity = lazy(() => import('./pages/admin/Activity.jsx'));

function RequireAuth() {
  const { user, ready } = useAuth();
  const location = useLocation();
  if (!ready) return <Spinner label="Checking your session" />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <Outlet />;
}

// Client-side guard for a friendlier screen. The API enforces the same rules with 403.
function RequireRole({ roles }) {
  const { user } = useAuth();
  return roles.includes(user.role) ? <Outlet /> : <Forbidden />;
}

function HomeRedirect() {
  const { user } = useAuth();
  return <Navigate to={HOME[user.role]} replace />;
}

export default function App() {
  return (
    <Suspense fallback={<Spinner />}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route element={<RequireAuth />}>
          <Route element={<Shell />}>
            <Route index element={<HomeRedirect />} />

            <Route element={<RequireRole roles={['front_desk']} />}>
              <Route path="appointments" element={<Appointments />} />
              <Route path="book" element={<Booking />} />
            </Route>

            <Route element={<RequireRole roles={['front_desk', 'clinician', 'admin']} />}>
              <Route path="patients" element={<Patients />} />
            </Route>

            <Route element={<RequireRole roles={['front_desk', 'admin']} />}>
              <Route path="billing" element={<Billing />} />
            </Route>

            <Route element={<RequireRole roles={['clinician']} />}>
              <Route path="queue" element={<Queue />} />
              <Route path="patients/:id/record" element={<PatientRecord />} />
            </Route>

            <Route element={<RequireRole roles={['admin']} />}>
              <Route path="dashboard" element={<Dashboard />} />
              <Route path="directory" element={<Directory />} />
              <Route path="audit" element={<Activity />} />
            </Route>

            <Route path="*" element={<NotFound />} />
          </Route>
        </Route>
      </Routes>
    </Suspense>
  );
}
