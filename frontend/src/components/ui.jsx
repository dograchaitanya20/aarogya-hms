import { forwardRef, useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, ChevronLeft, ChevronRight, Inbox, Loader2, Search, X } from 'lucide-react';
import { STATUS_LABEL } from '../lib/format.js';
import { explain } from '../lib/api.js';

export const cn = (...parts) => parts.filter(Boolean).join(' ');

/* ---------- Buttons ---------- */
const VARIANT = {
  primary: 'bg-primary text-on-primary hover:opacity-90',
  secondary: 'border bg-surface text-ink hover:bg-mint/70',
  ghost: 'text-ink hover:bg-ink/5',
  // coral fill always carries dark text: light-on-coral fails contrast
  danger: 'bg-coral text-[#0F1F1C] hover:brightness-95',
};
const SIZE = { sm: 'px-3 py-1.5 text-xs', md: 'px-4 py-2 text-sm', lg: 'px-5 py-2.5 text-base' };

export const Button = forwardRef(function Button(
  { variant = 'primary', size = 'md', loading = false, className, children, disabled, type = 'button', ...rest },
  ref
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-md font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        VARIANT[variant],
        SIZE[size],
        className
      )}
      {...rest}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
      {children}
    </button>
  );
});

// A link that looks like a button: one anchor element, never a <button> nested inside an <a>
export function ButtonLink({ to, variant = 'primary', size = 'md', className, children, ...rest }) {
  return (
    <Link to={to} className={cn('inline-flex items-center justify-center gap-2 rounded-md font-semibold transition-colors', VARIANT[variant], SIZE[size], className)} {...rest}>
      {children}
    </Link>
  );
}

/* ---------- Form fields ---------- */
const CONTROL =
  'w-full rounded-md border bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink/40 disabled:opacity-60 aria-[invalid=true]:border-coral aria-[invalid=true]:ring-1 aria-[invalid=true]:ring-coral';

function FieldShell({ label, hint, error, className, children }) {
  const id = useId();
  const describedBy = error ? `${id}-err` : hint ? `${id}-hint` : undefined;
  return (
    <div className={cn('space-y-1', className)}>
      {label && (
        <label htmlFor={id} className="block text-sm font-medium">
          {label}
        </label>
      )}
      {children({ id, 'aria-invalid': error ? 'true' : undefined, 'aria-describedby': describedBy })}
      {error ? (
        <p id={`${id}-err`} className="text-xs text-coral-ink">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-xs text-ink/60">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function TextField({ label, hint, error, className, inputClassName, ...rest }) {
  return (
    <FieldShell label={label} hint={hint} error={error} className={className}>
      {(a11y) => <input {...a11y} className={cn(CONTROL, inputClassName)} {...rest} />}
    </FieldShell>
  );
}

export function SelectField({ label, hint, error, className, children, ...rest }) {
  return (
    <FieldShell label={label} hint={hint} error={error} className={className}>
      {(a11y) => (
        <select {...a11y} className={CONTROL} {...rest}>
          {children}
        </select>
      )}
    </FieldShell>
  );
}

export function AreaField({ label, hint, error, className, rows = 3, ...rest }) {
  return (
    <FieldShell label={label} hint={hint} error={error} className={className}>
      {(a11y) => <textarea {...a11y} rows={rows} className={CONTROL} {...rest} />}
    </FieldShell>
  );
}

export function SearchBox({ value, onChange, placeholder = 'Search', className }) {
  return (
    <label className={cn('relative block', className)}>
      <span className="sr-only">{placeholder}</span>
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink/50" aria-hidden="true" />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={cn(CONTROL, 'pl-9')}
      />
    </label>
  );
}

/* ---------- Modal / side panel ---------- */
const FOCUSABLE = 'a[href],button:not([disabled]),textarea,input,select,[tabindex]:not([tabindex="-1"])';

export function Modal({ open, onClose, title, children, footer, width = 'max-w-lg', side = false }) {
  const panelRef = useRef(null);
  const returnTo = useRef(null);
  // Parents usually pass a fresh inline onClose on every render. Keeping the latest one in a ref means
  // the effect below depends only on `open`; otherwise every parent re-render (typing in a form the
  // parent owns, a background refetch) would re-run it and yank focus out of the field being typed in.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return undefined;
    returnTo.current = document.activeElement;
    const t = setTimeout(() => {
      const panel = panelRef.current;
      // If the user has already clicked or tabbed into the dialog, leave their focus alone
      if (!panel || panel.contains(document.activeElement)) return;
      // Prefer the first form field over the Close button
      (panel.querySelector('input, select, textarea') || panel.querySelector(FOCUSABLE) || panel).focus();
    }, 30);
    const onKey = (e) => {
      if (e.key === 'Escape') onCloseRef.current();
      if (e.key === 'Tab' && panelRef.current) {
        const items = [...panelRef.current.querySelectorAll(FOCUSABLE)];
        if (items.length === 0) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      clearTimeout(t);
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
      returnTo.current?.focus?.();
    };
  }, [open]);

  const titleId = useId();
  return (
    <AnimatePresence>
      {open && (
        <div className={cn('fixed inset-0 z-50 flex', side ? 'justify-end' : 'items-center justify-center p-4')}>
          <motion.div
            className="absolute inset-0 bg-ink/45"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            aria-hidden="true"
          />
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            tabIndex={-1}
            initial={side ? { x: 48, opacity: 0 } : { y: 14, opacity: 0, scale: 0.98 }}
            animate={side ? { x: 0, opacity: 1 } : { y: 0, opacity: 1, scale: 1 }}
            exit={side ? { x: 48, opacity: 0 } : { y: 8, opacity: 0 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            className={cn(
              'relative flex max-h-full w-full flex-col bg-surface shadow-lift',
              side ? 'h-full max-w-2xl border-l' : cn('rounded-lg border', width)
            )}
          >
            <div className="flex items-start justify-between gap-4 border-b px-5 py-4">
              <h2 id={titleId} className="text-xl font-semibold">
                {title}
              </h2>
              <button onClick={onClose} className="rounded-md p-1 text-ink/60 hover:bg-ink/5" aria-label="Close">
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
            {footer && <div className="flex flex-wrap justify-end gap-2 border-t px-5 py-3">{footer}</div>}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

/* ---------- Status ---------- */
const TONE = {
  scheduled: 'bg-ink/10 text-ink',
  checked_in: 'bg-mint text-mint-ink',
  in_consultation: 'bg-primary text-on-primary',
  in_progress: 'bg-primary text-on-primary',
  completed: 'bg-mint text-mint-ink',
  paid: 'bg-mint text-mint-ink',
  success: 'bg-mint text-mint-ink',
  partial: 'bg-coral/25 text-coral-ink',
  unpaid: 'bg-ink/10 text-ink',
  cancelled: 'bg-coral/25 text-coral-ink',
  no_show: 'bg-coral/25 text-coral-ink',
  declined: 'bg-coral/25 text-coral-ink',
  failed: 'bg-coral/25 text-coral-ink',
};

export function StatusPill({ status }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold', TONE[status] || 'bg-ink/10')}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
      {STATUS_LABEL[status] || status}
    </span>
  );
}

/* ---------- Layout bits ---------- */
export function PageHeader({ title, subtitle, actions }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-3xl font-semibold leading-tight">{title}</h1>
        {subtitle && <p className="mt-1 max-w-prose text-sm text-ink/65">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Empty({ title, children, action, icon: Icon = Inbox }) {
  return (
    <div className="flex flex-col items-center gap-3 px-4 py-14 text-center">
      <span className="grid h-12 w-12 place-items-center rounded-full bg-mint text-mint-ink">
        <Icon className="h-6 w-6" aria-hidden="true" />
      </span>
      <p className="font-display text-lg font-semibold">{title}</p>
      {children && <p className="max-w-sm text-sm text-ink/65">{children}</p>}
      {action}
    </div>
  );
}

export function ErrorNote({ error, onRetry }) {
  if (!error) return null;
  return (
    <div role="alert" className="flex items-start gap-3 rounded-md border border-coral bg-coral/10 px-4 py-3 text-sm">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-coral-ink" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p>{explain(error)}</p>
        {error.requestId && <p className="num mt-1 text-xs text-ink/55">Reference {error.requestId}</p>}
      </div>
      {onRetry && (
        <Button size="sm" variant="secondary" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

export function Spinner({ label = 'Loading' }) {
  return (
    <div className="flex items-center justify-center gap-2 py-10 text-sm text-ink/60" role="status">
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> {label}
    </div>
  );
}

export function TableSkeleton({ rows = 6, cols = 5 }) {
  return (
    <div className="space-y-2 p-3" aria-hidden="true">
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="grid gap-3" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
          {Array.from({ length: cols }, (_, c) => (
            <div key={c} className="h-5 animate-pulse rounded bg-ink/10" />
          ))}
        </div>
      ))}
    </div>
  );
}

export function Pager({ page, pageSize, total, onPage }) {
  if (!total) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  const last = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="flex items-center justify-between gap-3 px-3 py-3 text-sm text-ink/70">
      <span>
        <span className="num">
          {from}–{to}
        </span>{' '}
        of <span className="num">{total}</span>
      </span>
      <div className="flex items-center gap-1">
        <Button size="sm" variant="ghost" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page">
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        </Button>
        <span className="num px-1">
          {page}/{last}
        </span>
        <Button size="sm" variant="ghost" disabled={page >= last} onClick={() => onPage(page + 1)} aria-label="Next page">
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}

export function Tabs({ tabs, value, onChange, label = 'Sections' }) {
  return (
    <div role="tablist" aria-label={label} className="mb-5 flex gap-1 overflow-x-auto border-b">
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={value === t.id}
          onClick={() => onChange(t.id)}
          className={cn(
            '-mb-px whitespace-nowrap border-b-2 px-4 py-2 text-sm font-semibold transition-colors',
            value === t.id ? 'border-primary text-ink' : 'border-transparent text-ink/55 hover:text-ink'
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function Initials({ name, className }) {
  const letters = String(name || '?')
    .replace(/^Dr\.?\s+/i, '')
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
  return (
    <span className={cn('grid h-8 w-8 shrink-0 place-items-center rounded-full bg-mint text-xs font-bold text-mint-ink', className)} aria-hidden="true">
      {letters}
    </span>
  );
}

export const Card = ({ className, children }) => <div className={cn('rounded-lg border bg-surface', className)}>{children}</div>;

// Debounce hook used by every search box
export function useDebounced(value, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}
