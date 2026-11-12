import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Button, ErrorNote, TextField } from '../components/ui.jsx';
import { DemoNotice, PulseLine, Wordmark } from '../components/Art.jsx';
import { HOME, useAuth } from '../lib/auth.jsx';
import { fieldErrors } from '../lib/api.js';

// Dummy accounts from the README. They only exist in the synthetic demo database.
const DEMO_PASSWORD = 'Password123!';
const DEMO_ACCOUNTS = [
  { role: 'Front desk', email: 'frontdesk1@aarogya.local', note: 'Books visits, registers patients, takes payments' },
  { role: 'Clinician', email: 'dr.bose@aarogya.local', note: 'Sees a queue, writes notes and prescriptions' },
  { role: 'Administrator', email: 'admin@aarogya.local', note: 'Reports, staff directory, activity log' },
];

export default function Login() {
  const { user, ready, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  if (ready && user) return <Navigate to={location.state?.from || HOME[user.role]} replace />;

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const u = await login(email.trim(), password);
      navigate(location.state?.from || HOME[u.role], { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const errs = fieldErrors(error);

  return (
    <div className="grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
      <section className="relative hidden overflow-hidden bg-primary p-12 text-on-primary lg:flex lg:flex-col lg:justify-between">
        <Wordmark inverse className="text-[#F7F5F0]" />
        <div className="relative z-10 max-w-md space-y-5">
          <h1 className="font-display text-5xl font-semibold leading-[1.05]">Every visit, record and bill in one place.</h1>
          <p className="text-base/7 text-on-primary/80">
            Front desk books a slot and nobody else can take it. Clinicians write their own notes. Admins see the numbers, never the notes.
          </p>
        </div>
        <PulseLine className="pointer-events-none absolute inset-x-0 bottom-24 h-40 w-full text-[#F7F5F0]/70" stroke="currentColor" />
        <p className="relative z-10 text-sm text-on-primary/70">Aarogya HMS</p>
      </section>

      <section className="flex flex-col justify-center px-6 py-10 sm:px-12">
        <div className="mx-auto w-full max-w-md">
          <Wordmark className="mb-8 lg:hidden" />
          <h2 className="text-3xl font-semibold">Sign in</h2>
          <p className="mt-1 text-sm text-ink/65">Use your hospital account.</p>

          <form onSubmit={submit} className="mt-6 space-y-4" noValidate>
            <TextField label="Email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} error={errs.email} required />
            <TextField label="Password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} error={errs.password} required />
            {error && error.code !== 'VALIDATION_ERROR' && (
              <ErrorNote error={error.code === 'UNAUTHORIZED' ? { ...error, code: 'LOGIN', message: 'Email or password is incorrect.' } : error} />
            )}
            <Button type="submit" size="lg" loading={busy} className="w-full">
              Sign in
            </Button>
          </form>

          <div className="mt-8 border-t pt-6">
            <h3 className="font-sans text-sm font-semibold">Demo accounts</h3>
            <p className="mt-1 text-xs text-ink/60">
              Pick a role to fill the form. Every demo account uses the password <span className="num rounded bg-ink/8 px-1">{DEMO_PASSWORD}</span>.
            </p>
            <ul className="mt-3 divide-y rounded-md border">
              {DEMO_ACCOUNTS.map((a) => (
                <li key={a.email}>
                  <button
                    type="button"
                    onClick={() => {
                      setEmail(a.email);
                      setPassword(DEMO_PASSWORD);
                      setError(null);
                    }}
                    className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left hover:bg-mint/60"
                  >
                    <span>
                      <span className="block text-sm font-semibold">{a.role}</span>
                      <span className="block text-xs text-ink/60">{a.note}</span>
                    </span>
                    <span className="num hidden text-xs text-ink/55 sm:block">{a.email}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
          <DemoNotice className="mt-8" />
        </div>
      </section>
    </div>
  );
}
