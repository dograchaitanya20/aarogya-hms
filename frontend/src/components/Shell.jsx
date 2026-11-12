import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Building2, CalendarDays, CalendarPlus, LayoutDashboard, LogOut, Menu, Moon, ReceiptText, ScrollText, Stethoscope, Sun, Users, X } from 'lucide-react';
import { useAuth } from '../lib/auth.jsx';
import { ROLE_LABEL } from '../lib/format.js';
import { Wordmark, DemoNotice } from './Art.jsx';
import { Initials, cn } from './ui.jsx';

const NAV = {
  front_desk: [
    { to: '/appointments', label: 'Appointments', icon: CalendarDays },
    { to: '/book', label: 'Book a visit', icon: CalendarPlus },
    { to: '/patients', label: 'Patients', icon: Users },
    { to: '/billing', label: 'Billing', icon: ReceiptText },
  ],
  clinician: [
    { to: '/queue', label: 'Today’s queue', icon: Stethoscope },
    { to: '/patients', label: 'My patients', icon: Users },
  ],
  admin: [
    { to: '/dashboard', label: 'Overview', icon: LayoutDashboard },
    { to: '/directory', label: 'Directory', icon: Building2 },
    { to: '/patients', label: 'Patients', icon: Users },
    { to: '/billing', label: 'Billing', icon: ReceiptText },
    { to: '/audit', label: 'Activity log', icon: ScrollText },
  ],
};

function useTheme() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));
  const toggle = () => {
    const next = !dark;
    document.documentElement.classList.toggle('dark', next);
    try {
      localStorage.setItem('aarogya-theme', next ? 'dark' : 'light');
    } catch {
      /* private mode: the theme just will not persist */
    }
    setDark(next);
  };
  return { dark, toggle };
}

function NavList({ items, onNavigate }) {
  return (
    <nav aria-label="Main" className="flex flex-col gap-1">
      {items.map(({ to, label, icon: Icon }) => (
        <NavLink
          key={to}
          to={to}
          onClick={onNavigate}
          className={({ isActive }) =>
            cn(
              'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-semibold transition-colors',
              isActive ? 'bg-primary text-on-primary' : 'text-ink/75 hover:bg-ink/5 hover:text-ink'
            )
          }
        >
          <Icon className="h-4 w-4" aria-hidden="true" />
          {label}
        </NavLink>
      ))}
    </nav>
  );
}

export default function Shell() {
  const { user, logout } = useAuth();
  const { dark, toggle } = useTheme();
  const location = useLocation();
  const [menu, setMenu] = useState(false);
  const items = NAV[user.role] || [];

  useEffect(() => setMenu(false), [location.pathname]);

  const account = (
    <div className="space-y-3 border-t pt-4">
      <div className="flex items-center gap-3">
        <Initials name={user.fullName} />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{user.fullName}</p>
          <p className="text-xs text-ink/60">{ROLE_LABEL[user.role]}</p>
        </div>
      </div>
      <div className="flex gap-2">
        <button
          onClick={toggle}
          className="inline-flex flex-1 items-center justify-center gap-2 rounded-md border px-3 py-1.5 text-xs font-semibold hover:bg-ink/5"
          aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
        >
          {dark ? <Sun className="h-4 w-4" aria-hidden="true" /> : <Moon className="h-4 w-4" aria-hidden="true" />}
          {dark ? 'Light' : 'Dark'}
        </button>
        <button onClick={logout} className="inline-flex flex-1 items-center justify-center gap-2 rounded-md border px-3 py-1.5 text-xs font-semibold hover:bg-ink/5">
          <LogOut className="h-4 w-4" aria-hidden="true" /> Sign out
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[16rem_1fr]">
      {/* desktop sidebar */}
      <aside className="hidden border-r bg-surface lg:sticky lg:top-0 lg:flex lg:h-screen lg:flex-col lg:justify-between lg:p-5">
        <div className="space-y-8">
          <Wordmark />
          <NavList items={items} />
        </div>
        {account}
      </aside>

      {/* mobile top bar */}
      <header className="sticky top-0 z-30 flex items-center justify-between border-b bg-surface px-4 py-3 lg:hidden">
        <Wordmark />
        <button onClick={() => setMenu((m) => !m)} className="rounded-md p-2 hover:bg-ink/5" aria-label={menu ? 'Close menu' : 'Open menu'} aria-expanded={menu}>
          {menu ? <X className="h-5 w-5" aria-hidden="true" /> : <Menu className="h-5 w-5" aria-hidden="true" />}
        </button>
      </header>
      {menu && (
        <div className="space-y-6 border-b bg-surface px-4 py-4 lg:hidden">
          <NavList items={items} onNavigate={() => setMenu(false)} />
          {account}
        </div>
      )}

      <div className="flex min-w-0 flex-col">
        <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-8">
          <motion.div key={location.pathname} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.16 }}>
            <Outlet />
          </motion.div>
        </main>
        <footer className="border-t bg-surface px-4 py-3 sm:px-8">
          <DemoNotice />
        </footer>
      </div>
    </div>
  );
}
