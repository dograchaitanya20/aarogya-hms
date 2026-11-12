import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Check } from 'lucide-react';
import { api } from '../lib/api.js';
import { hhmm, istDayRange } from '../lib/format.js';
import { ErrorNote, Spinner, cn } from './ui.jsx';

// A doctor's day as a rail of time cells. Open cells can be picked, booked cells are hatched and
// show who holds them. The board refreshes itself so a slot taken by someone else shows up as taken.

const ACTIVE = new Set(['scheduled', 'checked_in', 'in_consultation', 'completed']);

function weekdayOf(dateStr) {
  // Noon in India is 06:30 UTC on the same date, so the UTC weekday equals the hospital weekday
  return new Date(`${dateStr}T12:00:00+05:30`).getUTCDay();
}

function to12h(hhmmStr) {
  const [h, m] = hhmmStr.split(':').map(Number);
  const suffix = h >= 12 ? 'pm' : 'am';
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${suffix}`;
}

function buildCells(rules, date) {
  const cells = [];
  for (const rule of rules) {
    const [sh, sm] = hhmm(rule.start_time).split(':').map(Number);
    const [eh, em] = hhmm(rule.end_time).split(':').map(Number);
    const step = rule.slot_duration_minutes;
    for (let t = sh * 60 + sm; t + step <= eh * 60 + em; t += step) {
      const local = `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
      const startsAt = new Date(`${date}T${local}:00+05:30`);
      cells.push({ local, hour: Math.floor(t / 60), startsAt: startsAt.toISOString(), endsAt: new Date(startsAt.getTime() + step * 60000).toISOString() });
    }
  }
  return cells.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}

export default function SlotBoard({ doctorId, date, selected, onSelect, conflictAt, ignoreAppointmentId }) {
  const { from, to } = istDayRange(date);

  const rules = useQuery({
    queryKey: ['schedules', doctorId],
    queryFn: () => api(`/directory/doctors/${doctorId}/schedules`),
    enabled: Boolean(doctorId),
  });
  const open = useQuery({
    queryKey: ['open-slots', doctorId, date],
    queryFn: () => api(`/doctors/${doctorId}/slots`, { query: { date } }),
    enabled: Boolean(doctorId && date),
    refetchInterval: 15_000,
  });
  const booked = useQuery({
    queryKey: ['booked', doctorId, date],
    queryFn: () => api('/appointments', { query: { doctorId, from, to, pageSize: 100 } }),
    enabled: Boolean(doctorId && date),
    refetchInterval: 15_000,
  });

  const { hours, counts } = useMemo(() => {
    const weekday = weekdayOf(date);
    const dayRules = (rules.data?.data || []).filter((r) => r.day_of_week === weekday && r.is_active);
    const openSet = new Set((open.data?.data || []).map((s) => new Date(s.startsAt).toISOString()));
    const bookedMap = new Map();
    for (const a of booked.data?.data || []) {
      if (ACTIVE.has(a.status) && a.id !== ignoreAppointmentId) bookedMap.set(new Date(a.starts_at).toISOString(), a);
    }
    const cells = buildCells(dayRules, date).map((c) => ({
      ...c,
      state: openSet.has(c.startsAt) ? 'open' : bookedMap.has(c.startsAt) ? 'booked' : 'closed',
      holder: bookedMap.get(c.startsAt),
    }));
    const byHour = new Map();
    for (const c of cells) byHour.set(c.hour, [...(byHour.get(c.hour) || []), c]);
    return {
      hours: [...byHour.entries()],
      counts: { open: cells.filter((c) => c.state === 'open').length, total: cells.length },
    };
  }, [rules.data, open.data, booked.data, date, ignoreAppointmentId]);

  if (!doctorId) return <p className="py-10 text-center text-sm text-ink/60">Choose a doctor to see their day.</p>;
  if (rules.isLoading || open.isLoading || booked.isLoading) return <Spinner label="Loading the day" />;
  const error = rules.error || open.error || booked.error;
  if (error) return <ErrorNote error={error} onRetry={() => { rules.refetch(); open.refetch(); booked.refetch(); }} />;
  if (counts.total === 0) return <p className="py-10 text-center text-sm text-ink/60">This doctor does not see patients on this day.</p>;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs text-ink/65">
        <p>
          <span className="num font-semibold text-ink">{counts.open}</span> of <span className="num">{counts.total}</span> times open
        </p>
        <ul className="flex flex-wrap items-center gap-3" aria-label="Legend">
          <li className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm border border-primary bg-mint" /> Open</li>
          <li className="flex items-center gap-1.5"><span className="hatch h-3 w-3 rounded-sm border" /> Booked</li>
          <li className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm bg-coral" /> Your pick</li>
        </ul>
      </div>

      <ol className="divide-y rounded-lg border bg-surface" role="region" aria-label="Available time slots">
        {hours.map(([hour, cells]) => (
          <li key={hour} className="grid grid-cols-[3.75rem_1fr] sm:grid-cols-[4.5rem_1fr] items-stretch">
            <span className="num flex items-center border-r px-2 py-2.5 sm:px-3 sm:py-3 text-xs text-ink/55">{to12h(`${hour}:00`)}</span>
            <div className="flex flex-wrap gap-2 p-1.5 sm:p-2">
              {cells.map((c) => {
                const isSelected = selected === c.startsAt;
                const isConflict = conflictAt === c.startsAt;
                const label = `${to12h(c.local)}, ${isConflict ? 'just taken' : c.state === 'open' ? 'open' : c.state === 'booked' ? 'booked' : 'not available'}`;
                return (
                  <motion.button
                    key={c.startsAt}
                    type="button"
                    layout
                    tabIndex={c.state === 'open' && !isConflict ? 0 : -1}
                    animate={isConflict ? { x: [0, -5, 5, -3, 3, 0] } : { x: 0 }}
                    transition={{ duration: 0.35 }}
                    disabled={c.state !== 'open' || isConflict} /* a time we just learned is taken cannot be picked again, even before the board refreshes */
                    aria-pressed={isSelected}
                    aria-label={label}
                    title={c.holder ? `Booked: ${c.holder.patient_name}` : undefined}
                    onClick={() => onSelect?.(c)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onSelect?.(c);
                      }
                    }}
                    className={cn(
                      'num relative min-h-[2.5rem] sm:min-h-[2.25rem] min-w-[4.25rem] sm:min-w-[4.6rem] touch-manipulation select-none rounded-md border px-2 py-2 sm:px-2.5 text-xs sm:text-sm font-medium transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2',
                      isSelected && 'border-coral bg-coral font-semibold text-[#0F1F1C] shadow-sm',
                      !isSelected && c.state === 'open' && 'border-primary/60 bg-mint text-mint-ink hover:border-primary hover:bg-primary hover:text-on-primary active:scale-95',
                      c.state === 'booked' && 'hatch cursor-not-allowed text-ink/55 opacity-70',
                      c.state === 'closed' && 'cursor-not-allowed text-ink/30 line-through opacity-50',
                      isConflict && 'border-coral ring-2 ring-coral'
                    )}
                  >
                    {to12h(c.local).replace(' ', '')}
                    {isSelected && <Check className="absolute -right-1.5 -top-1.5 h-4 w-4 rounded-full bg-ink p-0.5 text-paper shadow-sm" aria-hidden="true" />}
                  </motion.button>
                );
              })}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
