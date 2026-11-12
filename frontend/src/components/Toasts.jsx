import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { CheckCircle2, Info, XCircle } from 'lucide-react';
import { explain } from '../lib/api.js';

const ToastContext = createContext(null);
let nextId = 1;

export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);

  const dismiss = useCallback((id) => setItems((list) => list.filter((t) => t.id !== id)), []);
  const push = useCallback(
    (kind, message, ms) => {
      const id = nextId++;
      setItems((list) => [...list.slice(-3), { id, kind, message }]);
      setTimeout(() => dismiss(id), ms);
    },
    [dismiss]
  );

  const api = useMemo(
    () => ({
      success: (m) => push('success', m, 4500),
      info: (m) => push('info', m, 4500),
      // error() accepts an ApiError (turned into a plain-language sentence) or a string
      error: (e) => push('error', typeof e === 'string' ? e : explain(e), 8000),
    }),
    [push]
  );

  const ICON = { success: CheckCircle2, info: Info, error: XCircle };
  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[min(92vw,22rem)] flex-col gap-2" aria-live="polite" role="status">
        <AnimatePresence>
          {items.map((t) => {
            const Icon = ICON[t.kind];
            return (
              <motion.div
                key={t.id}
                layout
                initial={{ opacity: 0, x: 24 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 24 }}
                transition={{ duration: 0.18 }}
                className="pointer-events-auto flex items-start gap-3 rounded-md border bg-surface px-4 py-3 text-sm shadow-lift"
              >
                <Icon className={t.kind === 'error' ? 'mt-0.5 h-4 w-4 shrink-0 text-coral-ink' : 'mt-0.5 h-4 w-4 shrink-0 text-link'} aria-hidden="true" />
                <p className="flex-1">{t.message}</p>
                <button onClick={() => dismiss(t.id)} className="text-xs text-ink/55 hover:text-ink">
                  Dismiss
                </button>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}
