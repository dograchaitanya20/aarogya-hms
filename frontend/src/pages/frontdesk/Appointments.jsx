import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, CalendarPlus, CheckCheck, ReceiptText, UserX, XCircle } from 'lucide-react';
import { api } from '../../lib/api.js';
import { addDays, fmtDate, fmtTime, istDate, istDayRange } from '../../lib/format.js';
import { useToast } from '../../components/Toasts.jsx';
import SlotBoard from '../../components/SlotBoard.jsx';
import { AreaField, Button, ButtonLink, Card, Empty, ErrorNote, Modal, PageHeader, Pager, SearchBox, SelectField, StatusPill, TableSkeleton, TextField, useDebounced } from '../../components/ui.jsx';

function CancelModal({ appt, onClose, onDone }) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState(null);
  const toast = useToast();
  const cancel = useMutation({
    mutationFn: () => api(`/appointments/${appt.id}/status`, { method: 'PATCH', body: { status: 'cancelled', cancellationReason: reason.trim(), expectedVersion: appt.version } }),
    onSuccess: () => { toast.success('Appointment cancelled. The time is open again.'); onDone(); },
    onError: (e) => { setError(e); if (e.code === 'STALE_VERSION' || e.code === 'INVALID_TRANSITION') onDone(true); },
  });
  return (
    <Modal open={Boolean(appt)} onClose={onClose} title="Cancel this appointment?" footer={<><Button variant="ghost" onClick={onClose}>Keep appointment</Button><Button variant="danger" loading={cancel.isPending} disabled={reason.trim().length < 3} onClick={() => cancel.mutate()}>Cancel appointment</Button></>}>
      {appt && <p className="mb-4 text-sm">{appt.patient_name} with {appt.doctor_name}, {fmtDate(appt.starts_at)} at {fmtTime(appt.starts_at)}.</p>}
      <AreaField label="Reason for cancelling" hint="Recorded in the activity log." value={reason} onChange={(e) => setReason(e.target.value)} />
      {error && <div className="mt-3"><ErrorNote error={error} /></div>}
    </Modal>
  );
}

function RescheduleModal({ appt, onClose, onDone }) {
  const toast = useToast();
  const [date, setDate] = useState(istDate());
  const [slot, setSlot] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => { if (appt) { setDate(istDate()); setSlot(null); setError(null); } }, [appt]);

  const move = useMutation({
    mutationFn: () => api(`/appointments/${appt.id}/reschedule`, { method: 'PATCH', body: { startsAt: slot.startsAt, endsAt: slot.endsAt, expectedVersion: appt.version } }),
    onSuccess: () => { toast.success(`Moved to ${fmtDate(slot.startsAt)} at ${fmtTime(slot.startsAt)}.`); onDone(); },
    onError: (e) => { setError(e); setSlot(null); if (e.code === 'STALE_VERSION') onDone(true); },
  });

  return (
    <Modal open={Boolean(appt)} onClose={onClose} title="Reschedule appointment" width="max-w-3xl" footer={<><Button variant="ghost" onClick={onClose}>Close</Button><Button loading={move.isPending} disabled={!slot} onClick={() => move.mutate()}>Move appointment</Button></>}>
      {appt && (
        <>
          <p className="mb-4 text-sm">{appt.patient_name} with {appt.doctor_name}. Currently {fmtDate(appt.starts_at)} at {fmtTime(appt.starts_at)}.</p>
          <div className="mb-4 flex items-end gap-2">
            <TextField label="New date" type="date" min={istDate()} value={date} onChange={(e) => { setDate(e.target.value); setSlot(null); }} />
          </div>
          <SlotBoard doctorId={appt.doctor_id} date={date} selected={slot?.startsAt} onSelect={setSlot} ignoreAppointmentId={appt.id} />
          {error && <div className="mt-3"><ErrorNote error={error} /></div>}
        </>
      )}
    </Modal>
  );
}

export default function Appointments() {
  const toast = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [date, setDate] = useState(istDate());
  const [anyDate, setAnyDate] = useState(false);
  const [status, setStatus] = useState('');
  const [doctorId, setDoctorId] = useState('');
  const [q, setQ] = useState('');
  const dq = useDebounced(q.trim(), 300);
  const [page, setPage] = useState(1);
  const [cancelFor, setCancelFor] = useState(null);
  const [moveFor, setMoveFor] = useState(null);
  useEffect(() => setPage(1), [date, anyDate, status, doctorId, dq]);

  const doctors = useQuery({ queryKey: ['doctors'], queryFn: () => api('/directory/doctors', { query: { pageSize: 100 } }) });
  const range = anyDate ? {} : istDayRange(date);
  const list = useQuery({
    queryKey: ['appointments', date, anyDate, status, doctorId, dq, page],
    queryFn: () => api('/appointments', { query: { ...range, status, doctorId, q: dq, page, pageSize: 15 } }),
    placeholderData: keepPreviousData,
    refetchInterval: 20_000,
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['appointments'] });
  const changeStatus = useMutation({
    mutationFn: ({ appt, next }) => api(`/appointments/${appt.id}/status`, { method: 'PATCH', body: { status: next, expectedVersion: appt.version } }),
    onSuccess: (_, { next }) => { toast.success(next === 'checked_in' ? 'Patient checked in.' : 'Marked as no show.'); refresh(); },
    onError: (e) => { toast.error(e); refresh(); },
  });

  const rows = list.data?.data || [];
  return (
    <>
      <PageHeader title="Appointments" subtitle="Check patients in, move visits and keep the day running." actions={<ButtonLink to="/book"><CalendarPlus className="h-4 w-4" aria-hidden="true" />Book a visit</ButtonLink>} />
      <Card>
        <div className="grid gap-3 border-b p-3 sm:grid-cols-2 lg:grid-cols-[auto_auto_1fr_1fr_1.2fr]">
          <div className="flex items-end gap-1">
            <Button size="sm" variant="secondary" disabled={anyDate} onClick={() => setDate(addDays(date, -1))} aria-label="Previous day">‹</Button>
            <TextField label="Day" type="date" value={date} disabled={anyDate} onChange={(e) => e.target.value && setDate(e.target.value)} />
            <Button size="sm" variant="secondary" disabled={anyDate} onClick={() => setDate(addDays(date, 1))} aria-label="Next day">›</Button>
          </div>
          <label className="flex items-end gap-2 pb-2 text-sm"><input type="checkbox" checked={anyDate} onChange={(e) => setAnyDate(e.target.checked)} className="h-4 w-4 accent-[rgb(var(--primary))]" />Any date</label>
          <SelectField label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            <option value="scheduled">Scheduled</option><option value="checked_in">Checked in</option><option value="in_consultation">In consultation</option>
            <option value="completed">Completed</option><option value="cancelled">Cancelled</option><option value="no_show">No show</option>
          </SelectField>
          <SelectField label="Doctor" value={doctorId} onChange={(e) => setDoctorId(e.target.value)}>
            <option value="">All doctors</option>
            {(doctors.data?.data || []).map((d) => <option key={d.id} value={d.id}>{d.doctor_name}</option>)}
          </SelectField>
          <div className="flex items-end"><SearchBox value={q} onChange={setQ} placeholder="Patient, MRN or visit number" className="w-full" /></div>
        </div>

        {list.error ? <div className="p-4"><ErrorNote error={list.error} onRetry={list.refetch} /></div> : list.isLoading ? <TableSkeleton cols={5} /> : rows.length === 0 ? (
          <Empty icon={CalendarClock} title="No appointments match" action={<ButtonLink to="/book" variant="secondary">Book a visit</ButtonLink>}>Try another day, or clear the filters.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead><tr><th className="th">Time</th><th className="th">Patient</th><th className="th">Doctor</th><th className="th">Status</th><th className="th"><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {rows.map((a) => (
                  <tr key={a.id} className="hover:bg-mint/30">
                    <td className="td"><p className="num font-semibold">{fmtTime(a.starts_at)}</p>{anyDate && <p className="text-xs text-ink/60">{fmtDate(a.starts_at)}</p>}</td>
                    <td className="td"><p className="font-semibold">{a.patient_name}</p><p className="num text-xs text-ink/60">{a.mrn} · {a.appointment_number}</p></td>
                    <td className="td"><p>{a.doctor_name}</p><p className="text-xs text-ink/60">{a.department_name}</p></td>
                    <td className="td"><StatusPill status={a.status} />{a.cancellation_reason && <p className="mt-1 max-w-[14rem] text-xs text-ink/60">{a.cancellation_reason}</p>}</td>
                    <td className="td">
                      <div className="flex flex-wrap justify-end gap-1.5">
                        {a.status === 'scheduled' && <Button size="sm" onClick={() => changeStatus.mutate({ appt: a, next: 'checked_in' })} loading={changeStatus.isPending && changeStatus.variables?.appt.id === a.id}><CheckCheck className="h-3.5 w-3.5" aria-hidden="true" />Check in</Button>}
                        {['scheduled', 'checked_in'].includes(a.status) && <Button size="sm" variant="secondary" onClick={() => setMoveFor(a)}><CalendarClock className="h-3.5 w-3.5" aria-hidden="true" />Reschedule</Button>}
                        {a.status === 'scheduled' && <Button size="sm" variant="ghost" onClick={() => changeStatus.mutate({ appt: a, next: 'no_show' })}><UserX className="h-3.5 w-3.5" aria-hidden="true" />No show</Button>}
                        {['scheduled', 'checked_in'].includes(a.status) && <Button size="sm" variant="ghost" onClick={() => setCancelFor(a)}><XCircle className="h-3.5 w-3.5" aria-hidden="true" />Cancel</Button>}
                        {a.status === 'completed' && <Button size="sm" variant="secondary" onClick={() => navigate('/billing', { state: { invoiceFor: a } })}><ReceiptText className="h-3.5 w-3.5" aria-hidden="true" />Invoice</Button>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pager page={page} pageSize={list.data?.pageSize || 15} total={list.data?.total || 0} onPage={setPage} />
      </Card>
      <CancelModal appt={cancelFor} onClose={() => setCancelFor(null)} onDone={(keepOpen) => { refresh(); if (!keepOpen) setCancelFor(null); }} />
      <RescheduleModal appt={moveFor} onClose={() => setMoveFor(null)} onDone={(keepOpen) => { refresh(); queryClient.invalidateQueries({ queryKey: ['open-slots'] }); queryClient.invalidateQueries({ queryKey: ['booked'] }); if (!keepOpen) setMoveFor(null); }} />
    </>
  );
}
