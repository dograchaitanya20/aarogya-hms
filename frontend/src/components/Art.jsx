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

/* ---------- Original Empty State Illustrations ---------- */

export function EmptyAppointmentsArt({ className = 'h-32 w-32' }) {
  return (
    <svg viewBox="0 0 160 160" fill="none" className={className} aria-hidden="true">
      <circle cx="80" cy="80" r="70" fill="rgb(var(--mint) / 0.35)" />
      <rect x="36" y="32" width="88" height="102" rx="10" fill="rgb(var(--surface))" stroke="rgb(var(--primary))" strokeWidth="2.5" />
      <rect x="36" y="32" width="88" height="26" rx="10" fill="rgb(var(--primary))" />
      <rect x="36" y="48" width="88" height="10" fill="rgb(var(--primary))" />
      <rect x="54" y="24" width="6" height="14" rx="3" fill="rgb(var(--coral))" />
      <rect x="100" y="24" width="6" height="14" rx="3" fill="rgb(var(--coral))" />
      <rect x="48" y="68" width="16" height="14" rx="3" fill="rgb(var(--mint))" stroke="rgb(var(--primary) / 0.4)" strokeWidth="1.2" />
      <rect x="72" y="68" width="16" height="14" rx="3" fill="rgb(var(--mint))" stroke="rgb(var(--primary) / 0.4)" strokeWidth="1.2" />
      <rect x="96" y="68" width="16" height="14" rx="3" fill="rgb(var(--mint))" stroke="rgb(var(--primary) / 0.4)" strokeWidth="1.2" />
      <rect x="48" y="88" width="16" height="14" rx="3" fill="rgb(var(--paper))" stroke="rgb(var(--ink) / 0.15)" strokeWidth="1.2" />
      <rect x="72" y="88" width="16" height="14" rx="3" fill="rgb(var(--paper))" stroke="rgb(var(--ink) / 0.15)" strokeWidth="1.2" />
      <circle cx="106" cy="106" r="24" fill="rgb(var(--surface))" stroke="rgb(var(--coral))" strokeWidth="2.5" />
      <circle cx="106" cy="106" r="2.5" fill="rgb(var(--ink))" />
      <path d="M106 94v12l8 5" stroke="rgb(var(--ink))" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M48 116h14l3-5 5 10 4-5h12" stroke="rgb(var(--primary))" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function EmptyPatientsArt({ className = 'h-32 w-32' }) {
  return (
    <svg viewBox="0 0 160 160" fill="none" className={className} aria-hidden="true">
      <circle cx="80" cy="80" r="70" fill="rgb(var(--mint) / 0.35)" />
      <rect x="30" y="44" width="94" height="88" rx="8" fill="rgb(var(--mint))" stroke="rgb(var(--primary) / 0.5)" strokeWidth="2" />
      <rect x="42" y="30" width="84" height="96" rx="8" fill="rgb(var(--surface))" stroke="rgb(var(--primary))" strokeWidth="2.5" />
      <circle cx="62" cy="54" r="14" fill="rgb(var(--mint))" stroke="rgb(var(--primary) / 0.6)" strokeWidth="1.5" />
      <circle cx="62" cy="50" r="5" fill="rgb(var(--primary))" />
      <path d="M53 62c0-5 4-8 9-8s9 3 9 8" fill="rgb(var(--primary))" />
      <rect x="82" y="46" width="34" height="5" rx="2.5" fill="rgb(var(--primary))" />
      <rect x="82" y="56" width="24" height="4" rx="2" fill="rgb(var(--ink) / 0.3)" />
      <path d="M50 78h68" stroke="rgb(var(--ink) / 0.12)" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M50 90h54" stroke="rgb(var(--ink) / 0.12)" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M50 102h62" stroke="rgb(var(--ink) / 0.12)" strokeWidth="1.5" strokeLinecap="round" />
      <g transform="translate(100, 94)">
        <circle cx="16" cy="16" r="18" fill="rgb(var(--surface))" stroke="rgb(var(--coral))" strokeWidth="2.5" />
        <rect x="13.5" y="7" width="5" height="18" rx="2" fill="rgb(var(--coral))" />
        <rect x="7" y="13.5" width="18" height="5" rx="2" fill="rgb(var(--coral))" />
      </g>
    </svg>
  );
}

export function EmptyBillingArt({ className = 'h-32 w-32' }) {
  return (
    <svg viewBox="0 0 160 160" fill="none" className={className} aria-hidden="true">
      <circle cx="80" cy="80" r="70" fill="rgb(var(--mint) / 0.35)" />
      <path
        d="M44 26h72a6 6 0 016 6v96l-7-5-7 5-7-5-7 5-7-5-7 5-7-5-7 5-7-5-7 5-8-5V32a6 6 0 016-6z"
        fill="rgb(var(--surface))"
        stroke="rgb(var(--primary))"
        strokeWidth="2.5"
      />
      <rect x="54" y="38" width="52" height="6" rx="3" fill="rgb(var(--primary))" />
      <rect x="54" y="48" width="32" height="4" rx="2" fill="rgb(var(--ink) / 0.35)" />
      <path d="M52 60h56" stroke="rgb(var(--ink) / 0.25)" strokeWidth="1.5" strokeDasharray="3 3" />
      <rect x="54" y="70" width="38" height="4" rx="2" fill="rgb(var(--ink) / 0.25)" />
      <rect x="98" y="70" width="12" height="4" rx="2" fill="rgb(var(--primary))" />
      <rect x="54" y="80" width="32" height="4" rx="2" fill="rgb(var(--ink) / 0.25)" />
      <rect x="98" y="80" width="12" height="4" rx="2" fill="rgb(var(--primary))" />
      <rect x="54" y="90" width="42" height="4" rx="2" fill="rgb(var(--ink) / 0.25)" />
      <rect x="98" y="90" width="12" height="4" rx="2" fill="rgb(var(--primary))" />
      <path d="M52 100h58" stroke="rgb(var(--primary))" strokeWidth="1.5" />
      <g transform="translate(94, 90)">
        <circle cx="16" cy="16" r="18" fill="rgb(var(--surface))" stroke="rgb(var(--coral))" strokeWidth="2.5" />
        <circle cx="16" cy="16" r="14" fill="rgb(var(--coral) / 0.15)" />
        <text x="16" y="22" textAnchor="middle" fill="rgb(var(--coral-ink))" fontSize="16" fontWeight="bold" fontFamily="sans-serif">₹</text>
      </g>
    </svg>
  );
}
