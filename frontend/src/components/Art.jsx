import { motion } from 'framer-motion';
import { ShieldAlert } from 'lucide-react';
import { cn } from './ui.jsx';

// Heartbeat trace: the product's one signature drawing
const TRACE = 'M0 80 H150 L168 80 L182 50 L198 112 L216 12 L234 100 L248 80 H330 L346 80 L358 58 L372 104 L388 30 L404 96 L416 80 H600';

export function PulseLine({ className, stroke = 'currentColor', animate = true }) {
  return (
    <svg viewBox="0 0 600 120" fill="none" className={className} aria-hidden="true" preserveAspectRatio="none">
      <motion.path
        d={TRACE}
        stroke={stroke}
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={animate ? { pathLength: 0, opacity: 0.2 } : false}
        animate={{ pathLength: 1, opacity: 1 }}
        transition={{ duration: 1.8, ease: 'easeInOut' }}
      />
    </svg>
  );
}

export function Wordmark({ className, inverse = false }) {
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <svg viewBox="0 0 32 32" className="h-8 w-8" aria-hidden="true">
        <rect width="32" height="32" rx="8" fill={inverse ? '#F7F5F0' : 'rgb(var(--primary))'} />
        <path d="M4 17h6l3-7 5 13 3-6h7" fill="none" stroke={inverse ? '#0E5C5A' : 'rgb(var(--on-primary))'} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className="font-display text-2xl font-semibold tracking-tight">Aarogya</span>
    </span>
  );
}

// Shown on every screen: this is a demo with invented data
export function DemoNotice({ className }) {
  return (
    <p className={cn('flex items-center gap-2 text-xs font-medium text-ink/70', className)}>
      <ShieldAlert className="h-4 w-4 shrink-0 text-coral-ink" aria-hidden="true" />
      <span>Demo system — synthetic data only. Never enter real patient information.</span>
    </p>
  );
}
