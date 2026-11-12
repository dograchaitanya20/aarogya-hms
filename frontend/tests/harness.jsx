import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { inject } from 'vitest';
import App from '../src/App.jsx';
import { AuthProvider } from '../src/lib/auth.jsx';
import { ToastProvider } from '../src/components/Toasts.jsx';

const realFetch = globalThis.fetch;

// A tiny cookie jar. Node's fetch does not keep cookies like a browser does, so this stands in for the
// browser: the httpOnly session cookie set by /auth/login is sent back on every later request.
function makeJar() {
  let cookie = '';
  return {
    get: () => cookie,
    clear: () => { cookie = ''; },
    async fetch(url, init = {}) {
      const base = inject('apiUrl');
      const headers = { ...(init.headers || {}) };
      if (cookie) headers.Cookie = cookie;
      const res = await realFetch(new URL(url, base), { ...init, headers });
      // Opt-in request trace for debugging: E2E_TRACE=1 npx vitest run ...
      if (process.env.E2E_TRACE) console.log(`TRACE ${(init.method || 'GET').padEnd(5)} ${res.status} ${String(url).slice(0, 110)}`);
      const set = res.headers.getSetCookie?.() || [];
      for (const c of set) {
        const [pair] = c.split(';');
        const [name, value] = pair.split('=');
        if (/expires=Thu, 01 Jan 1970/i.test(c) || value === '') cookie = '';
        else cookie = `${name}=${value}`;
      }
      return res;
    },
  };
}

// The jar the rendered app uses (the "browser")
export const browser = makeJar();

export function installBrowserFetch() {
  globalThis.fetch = (url, init) => (String(url).startsWith('/api/') ? browser.fetch(url, init) : realFetch(url, init));
}

// Arrangement helper: acts as another signed-in user (its own jar) to set data up and to verify results
export async function apiAs(email, password = 'Password123!') {
  const jar = makeJar();
  const login = await jar.fetch('/api/v1/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
  if (!login.ok) throw new Error(`apiAs(${email}) login failed: ${login.status}`);
  const call = async (method, path, body, key) => {
    const res = await jar.fetch(`/api/v1${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(key && { 'Idempotency-Key': key }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
  return { call, user: (await login.json()).user };
}

// Signs the "browser" in without going through the UI (for tests about what happens after sign-in)
export async function browserSignIn(email, password = 'Password123!') {
  const res = await browser.fetch('/api/v1/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
  if (!res.ok) throw new Error(`browserSignIn(${email}) failed: ${res.status}`);
}

export function renderApp(route = '/') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 0 } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[route]}>
        <ToastProvider>
          <AuthProvider>
            <App />
          </AuthProvider>
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

// "9:15 am" the way the slot board labels a time, from an ISO instant
export function boardLabel(iso) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit', hour12: false }).formatToParts(new Date(iso));
  const h = Number(parts.find((p) => p.type === 'hour').value);
  const m = parts.find((p) => p.type === 'minute').value;
  return `${h % 12 || 12}:${m} ${h >= 12 ? 'pm' : 'am'}`;
}

// First hospital-local date (from tomorrow, within 14 days) on which the doctor has open slots
export async function nextWorkingDay(call, doctorId) {
  for (let i = 1; i <= 14; i += 1) {
    const date = new Date(Date.now() + i * 86400000 + 5.5 * 3600000).toISOString().slice(0, 10);
    const res = await call('GET', `/doctors/${doctorId}/slots?date=${date}`);
    if (res.body?.data?.length >= 4) return { date, slots: res.body.data, offset: i };
  }
  throw new Error('No working day with open slots in the next 14 days');
}
