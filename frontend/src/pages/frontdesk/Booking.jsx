import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarCheck, ChevronLeft, ChevronRight } from 'lucide-react';
import { api, explain, newIdempotencyKey } from '../../lib/api.js';
import { addDays, fmtDate, fmtTime, istDate, rupees, toNumber } from '../../lib/format.js';
import { useToast } from '../../components/Toasts.jsx';
import SlotBoard from '../../components/SlotBoard.jsx';
import PatientPicker from '../../components/PatientPicker.jsx';
import { AreaField, Button, Card, ErrorNote, PageHeader, SelectField, TextField } from '../../components/ui.jsx';

export default function Booking() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [deptId, setDeptId] = useState('');
  const [doctorId, setDoctorId] = useState('');
  const [date, setDate] = useState(istDate());
  const [slot, setSlot] = useState(null);
  const [patient, setPatient] = useState(null);
  const [reason, setReason] = useState('');
  const [conflictAt, setConflictAt] = useState(null);
  const [error, setError] = useState(null);
  const [booked, setBooked] = useState(null);

  // One Idempotency-Key per booking attempt. A network error or 5xx keeps the key, so pressing the
  // button again can never create a second appointment. A rejected request (4xx) is stored by the
  // server under its key, so the next attempt needs a fresh key.
  const keyRef = useRef(null);

  const departments = useQuery({ queryKey: ['departments'], queryFn: () => api('/directory/departments') });
  const doctors = useQuery({ queryKey: ['doctors'], queryFn: () => api('/directory/doctors', { query: { pageSize: 100 } }) });
  const list = (doctors.data?.data || []).filter((d) => !deptId || d.department_id === deptId);
  const doctor = (doctors.data?.data || []).find((d) => d.id === doctorId);

  const refreshBoard = () => {
    queryClient.invalidateQueries({ queryKey: ['open-slots'] });
    queryClient.invalidateQueries({ queryKey: ['booked'] });
    queryClient.invalidateQueries({ queryKey: ['appointments'] });
  };

  const book = useMutation({
    mutationFn: () => {
      if (!keyRef.current) keyRef.current = newIdempotencyKey();
      return api('/appointments', {
        method: 'POST',
        idempotencyKey: keyRef.current,
        body: { patientId: patient.id, doctorId, startsAt: slot.startsAt, endsAt: slot.endsAt, ...(reason.trim() && { reasonForVisit: reason.trim() }) },
      });
    },
    onSuccess: (res) => {
      keyRef.current = null;
      setBooked({ ...res.data, patient_name: patient.full_name, doctor_name: doctor?.doctor_name });
      setSlot(null);
      setPatient(null);
      setReason('');
      setError(null);
      setConflictAt(null);
      refreshBoard();
    },
    onError: (err) => {
      if (err.status > 0 && err.status < 500 && err.code !== 'IDEMPOTENCY_IN_PROGRESS') keyRef.current = null;
      if (err.code === 'SLOT_TAKEN') {
        // Someone else got there first: mark the cell, reload the board, ask for another pick
        setConflictAt(slot.startsAt);
        setSlot(null);
        refreshBoard();
        toast.error(err);
        setError(null);
      } else {
        setError(err);
      }
    },
  });

  const ready = Boolean(slot && patient && doctorId);
  const pickSlot = (cell) => {
    setSlot(cell);
    setConflictAt(null);
    setError(null);
    setBooked(null);
  };

  return (
    <>
      <PageHeader title="Book a visit" subtitle="Pick a doctor and a day, choose an open time, then find the patient." />
      {booked && (
        <div role="status" className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-primary/40 bg-mint px-4 py-3 text-mint-ink">
          <p className="flex items-center gap-2 text-sm font-semibold">
            <CalendarCheck className="h-5 w-5" aria-hidden="true" />
            Booked {booked.patient_name} with {booked.doctor_name}, {fmtDate(booked.starts_at)} at {fmtTime(booked.starts_at)}.
            <span className="num font-normal">{booked.appointment_number}</span>
          </p>
          <Link className="link text-sm" to="/appointments">See today’s appointments</Link>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[21rem_1fr]">
        <Card className="space-y-4 p-4 lg:sticky lg:top-6 lg:self-start">
          <SelectField label="Department" value={deptId} onChange={(e) => { setDeptId(e.target.value); setDoctorId(''); setSlot(null); }}>
            <option value="">All departments</option>
            {(departments.data?.data || []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </SelectField>
          <SelectField label="Doctor" value={doctorId} onChange={(e) => { setDoctorId(e.target.value); setSlot(null); setConflictAt(null); }}>
            <option value="">Choose a doctor</option>
            {list.map((d) => <option key={d.id} value={d.id}>{d.doctor_name}, {d.specialization}</option>)}
          </SelectField>
          {doctor && <p className="rounded-md bg-mint/60 px-3 py-2 text-xs text-mint-ink">{doctor.department_name}{doctor.room_number ? `, ${doctor.room_number}` : ''}. Consultation <span className="num">{rupees(toNumber(doctor.consultation_fee_paise))}</span></p>}

          <div>
            <span className="mb-1 block text-sm font-medium">Day</span>
            <div className="flex items-center gap-1">
              <Button size="sm" variant="secondary" disabled={date <= istDate()} onClick={() => { setDate(addDays(date, -1)); setSlot(null); }} aria-label="Previous day"><ChevronLeft className="h-4 w-4" aria-hidden="true" /></Button>
              <TextField className="flex-1" type="date" aria-label="Day" min={istDate()} value={date} onChange={(e) => { if (e.target.value) { setDate(e.target.value); setSlot(null); } }} />
              <Button size="sm" variant="secondary" onClick={() => { setDate(addDays(date, 1)); setSlot(null); }} aria-label="Next day"><ChevronRight className="h-4 w-4" aria-hidden="true" /></Button>
            </div>
          </div>

          <PatientPicker value={patient} onChange={(p) => { setPatient(p); setError(null); }} error={error?.code === 'PATIENT_DOUBLE_BOOKED' ? explain(error) : undefined} />
          <AreaField label="Reason for visit" hint="Optional" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />

          {error && error.code !== 'PATIENT_DOUBLE_BOOKED' && <ErrorNote error={error} />}
          <div className="border-t pt-4">
            <p className="mb-3 text-sm" aria-live="polite">
              {slot ? <>Booking <span className="num font-semibold">{fmtTime(slot.startsAt)}</span> on {fmtDate(slot.startsAt)}.</> : 'No time chosen yet.'}
            </p>
            <Button className="w-full" size="lg" disabled={!ready} loading={book.isPending} onClick={() => book.mutate()}>Book appointment</Button>
          </div>
        </Card>

        <section aria-label="Doctor's day">
          <SlotBoard doctorId={doctorId} date={date} selected={slot?.startsAt} onSelect={pickSlot} conflictAt={conflictAt} />
          {conflictAt && <p role="alert" className="mt-3 text-sm text-coral-ink">That time was taken a moment ago. The board has been refreshed: choose another open time.</p>}
        </section>
      </div>
    </>
  );
}
