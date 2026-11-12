import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, ClipboardList, PlayCircle, CheckCircle2, FileText } from 'lucide-react';
import { api } from '../../lib/api.js';
import { addDays, fmtDate, fmtTime, istDate, istDayRange } from '../../lib/format.js';
import { useToast } from '../../components/Toasts.jsx';
import { Button, ButtonLink, Card, Empty, ErrorNote, PageHeader, StatusPill, TableSkeleton } from '../../components/ui.jsx';

export default function Queue() {
  const toast = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [date, setDate] = useState(istDate());
  const { from, to } = istDayRange(date);

  const list = useQuery({
    queryKey: ['queue', date],
    queryFn: () => api('/appointments', { query: { from, to, pageSize: 100 } }),
    refetchInterval: 15_000,
  });
  const rows = [...(list.data?.data || [])].sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const count = (s) => rows.filter((r) => r.status === s).length;

  const change = useMutation({
    mutationFn: ({ appt, next }) => api(`/appointments/${appt.id}/status`, { method: 'PATCH', body: { status: next, expectedVersion: appt.version } }),
    onSuccess: (_, { appt, next }) => {
      queryClient.invalidateQueries({ queryKey: ['queue'] });
      queryClient.invalidateQueries({ queryKey: ['records'] });
      if (next === 'in_consultation') {
        toast.success(`Consultation started with ${appt.patient_name}.`);
        navigate(`/patients/${appt.patient_id}/record`);
      } else {
        toast.success('Consultation completed.');
      }
    },
    onError: (e) => {
      toast.error(e);
      queryClient.invalidateQueries({ queryKey: ['queue'] });
    },
  });

  const isToday = date === istDate();
  const busyId = change.isPending ? change.variables?.appt.id : null;

  return (
    <>
      <PageHeader title={isToday ? 'Today’s queue' : fmtDate(from)} subtitle="Patients booked with you. Start a consultation once the patient has been checked in at the front desk." actions={
        <div className="flex items-center gap-1">
          <Button size="sm" variant="secondary" onClick={() => setDate(addDays(date, -1))} aria-label="Previous day"><ChevronLeft className="h-4 w-4" aria-hidden="true" /></Button>
          <Button size="sm" variant="secondary" disabled={isToday} onClick={() => setDate(istDate())}>Today</Button>
          <Button size="sm" variant="secondary" onClick={() => setDate(addDays(date, 1))} aria-label="Next day"><ChevronRight className="h-4 w-4" aria-hidden="true" /></Button>
        </div>
      } />

      {rows.length > 0 && (
        <p className="mb-6 max-w-2xl font-display text-2xl leading-snug">
          <span className="num">{rows.length}</span> {rows.length === 1 ? 'patient' : 'patients'} booked. <span className="num">{count('checked_in')}</span> waiting, <span className="num">{count('in_consultation')}</span> with you, <span className="num">{count('completed')}</span> done.
        </p>
      )}

      <Card>
        {list.error ? <div className="p-4"><ErrorNote error={list.error} onRetry={list.refetch} /></div> : list.isLoading ? <TableSkeleton cols={4} /> : rows.length === 0 ? (
          <Empty icon={ClipboardList} title="Nobody is booked for this day">Pick another day, or check back after the front desk books visits.</Empty>
        ) : (
          <ol className="divide-y">
            {rows.map((a) => (
              <li key={a.id} className="flex flex-col gap-3 px-4 py-4 sm:grid sm:grid-cols-[5.5rem_1fr_auto] sm:items-center sm:gap-4">
                <div className="flex items-center justify-between sm:block">
                  <span className="num text-lg font-semibold">{fmtTime(a.starts_at)}</span>
                  <div className="sm:hidden">
                    <StatusPill status={a.status} />
                  </div>
                </div>
                <div className="min-w-0">
                  <p className="truncate font-semibold">{a.patient_name} <span className="num text-xs font-normal text-ink/55">{a.mrn}</span></p>
                  <p className="truncate text-sm text-ink/65">{a.reason_for_visit || 'No reason recorded'}</p>
                </div>
                <div className="flex flex-wrap items-center justify-end gap-2 border-t border-ink/10 pt-2 sm:border-0 sm:pt-0">
                  <div className="hidden sm:block">
                    <StatusPill status={a.status} />
                  </div>
                  {a.status === 'checked_in' && <Button size="sm" loading={busyId === a.id} onClick={() => change.mutate({ appt: a, next: 'in_consultation' })}><PlayCircle className="h-4 w-4" aria-hidden="true" />Start consultation</Button>}
                  {a.status === 'in_consultation' && (
                    <>
                      <ButtonLink to={`/patients/${a.patient_id}/record`} size="sm" variant="secondary"><FileText className="h-4 w-4" aria-hidden="true" />Open record</ButtonLink>
                      <Button size="sm" loading={busyId === a.id} onClick={() => change.mutate({ appt: a, next: 'completed' })}><CheckCircle2 className="h-4 w-4" aria-hidden="true" />Complete</Button>
                    </>
                  )}
                  {a.status === 'completed' && <Link className="link text-sm" to={`/patients/${a.patient_id}/record`}>View record</Link>}
                  {a.status === 'scheduled' && <span className="text-xs text-ink/55">Waiting for check-in</span>}
                </div>
              </li>
            ))}
          </ol>
        )}
      </Card>
    </>
  );
}
