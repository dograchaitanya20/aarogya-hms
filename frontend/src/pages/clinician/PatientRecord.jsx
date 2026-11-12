import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CheckCircle2, Plus, ShieldAlert, Trash2 } from 'lucide-react';
import { api, fieldErrors } from '../../lib/api.js';
import { useAuth } from '../../lib/auth.jsx';
import { ageFromDob, fmtDate, fmtDateTime, istDate } from '../../lib/format.js';
import { useToast } from '../../components/Toasts.jsx';
import { AreaField, Button, Card, ErrorNote, Spinner, StatusPill, Tabs, TextField, SelectField } from '../../components/ui.jsx';

const NOTE_BLANK = { chiefComplaint: '', symptoms: '', clinicalExamination: '', assessmentNotes: '', plan: '', diagnosisNotes: '' };
const RX_ITEM = () => ({ id: Math.random().toString(36).slice(2), medicineName: '', dosage: '', frequency: '', durationDays: '' });

function NoteForm({ encounterId, onSaved }) {
  const toast = useToast();
  const [form, setForm] = useState(NOTE_BLANK);
  const [error, setError] = useState(null);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const errs = fieldErrors(error);
  const save = useMutation({
    mutationFn: () => {
      const body = Object.fromEntries(Object.entries(form).filter(([, v]) => v.trim()));
      return api(`/clinical/encounters/${encounterId}/notes`, { method: 'POST', body });
    },
    onSuccess: () => { toast.success('Note saved.'); setForm(NOTE_BLANK); setError(null); onSaved(); },
    onError: setError,
  });
  return (
    <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); save.mutate(); }} noValidate>
      <AreaField label="Chief complaint" rows={2} value={form.chiefComplaint} onChange={set('chiefComplaint')} error={errs.chiefComplaint} required />
      <AreaField label="Symptoms" rows={2} value={form.symptoms} onChange={set('symptoms')} />
      <AreaField label="Examination findings" rows={2} value={form.clinicalExamination} onChange={set('clinicalExamination')} hint="Vitals and findings, as free text." />
      <AreaField label="Assessment" rows={2} value={form.assessmentNotes} onChange={set('assessmentNotes')} />
      <AreaField label="Plan" rows={2} value={form.plan} onChange={set('plan')} />
      <AreaField label="Diagnosis" rows={2} value={form.diagnosisNotes} onChange={set('diagnosisNotes')} error={errs.diagnosisNotes} hint="Your own clinical judgment. The system never suggests a diagnosis." required />
      {error && error.code !== 'VALIDATION_ERROR' && <ErrorNote error={error} />}
      <Button type="submit" loading={save.isPending}>Save note</Button>
    </form>
  );
}

function PrescriptionForm({ encounterId, onSaved }) {
  const toast = useToast();
  const [items, setItems] = useState([RX_ITEM()]);
  const [instructions, setInstructions] = useState('');
  const [error, setError] = useState(null);
  const setItem = (id, k, v) => setItems((l) => l.map((i) => (i.id === id ? { ...i, [k]: v } : i)));
  const valid = items.every((i) => i.medicineName.trim() && i.dosage.trim() && i.frequency.trim() && Number.isInteger(Number(i.durationDays)) && Number(i.durationDays) >= 1);
  const save = useMutation({
    mutationFn: () => api(`/clinical/encounters/${encounterId}/prescriptions`, {
      method: 'POST',
      body: { ...(instructions.trim() && { instructions: instructions.trim() }), items: items.map((i) => ({ medicineName: i.medicineName.trim(), dosage: i.dosage.trim(), frequency: i.frequency.trim(), durationDays: Number(i.durationDays) })) },
    }),
    onSuccess: () => { toast.success('Prescription saved.'); setItems([RX_ITEM()]); setInstructions(''); setError(null); onSaved(); },
    onError: setError,
  });
  return (
    <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); save.mutate(); }} noValidate>
      <p className="text-xs text-ink/60">Prescribing is your decision. The system does not check interactions or suggest doses.</p>
      <div className="space-y-3">
        {items.map((it, idx) => (
          <div key={it.id} className="grid grid-cols-2 gap-2 rounded-md border p-3 sm:grid-cols-[1.6fr_1fr_1fr_5.5rem_auto]">
            <TextField className="col-span-2 sm:col-span-1" aria-label={`Medicine ${idx + 1}`} placeholder="Medicine" value={it.medicineName} onChange={(e) => setItem(it.id, 'medicineName', e.target.value)} />
            <TextField aria-label={`Dosage ${idx + 1}`} placeholder="Dosage" value={it.dosage} onChange={(e) => setItem(it.id, 'dosage', e.target.value)} />
            <TextField aria-label={`Frequency ${idx + 1}`} placeholder="Frequency" value={it.frequency} onChange={(e) => setItem(it.id, 'frequency', e.target.value)} />
            <TextField aria-label={`Days ${idx + 1}`} placeholder="Days" inputMode="numeric" value={it.durationDays} onChange={(e) => setItem(it.id, 'durationDays', e.target.value)} />
            <Button variant="ghost" size="sm" disabled={items.length === 1} onClick={() => setItems((l) => l.filter((x) => x.id !== it.id))} aria-label={`Remove medicine ${idx + 1}`}><Trash2 className="h-4 w-4" aria-hidden="true" /></Button>
          </div>
        ))}
      </div>
      <Button variant="secondary" size="sm" onClick={() => setItems((l) => [...l, RX_ITEM()])}><Plus className="h-4 w-4" aria-hidden="true" />Add medicine</Button>
      <AreaField label="Instructions" rows={2} value={instructions} onChange={(e) => setInstructions(e.target.value)} />
      {error && <ErrorNote error={error} />}
      <Button type="submit" loading={save.isPending} disabled={!valid}>Save prescription</Button>
    </form>
  );
}

function ReportForm({ patientId, encounterId, onSaved }) {
  const toast = useToast();
  const [form, setForm] = useState({ testName: '', category: 'pathology', fileName: '', reportDate: istDate(), status: 'completed', notes: '' });
  const [error, setError] = useState(null);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const errs = fieldErrors(error);
  const save = useMutation({
    mutationFn: () => api('/clinical/diagnostic-reports', { method: 'POST', body: { patientId, encounterId, ...form, ...(form.notes.trim() ? {} : { notes: undefined }) } }),
    onSuccess: () => { toast.success('Report saved.'); setForm((f) => ({ ...f, testName: '', fileName: '', notes: '' })); setError(null); onSaved(); },
    onError: setError,
  });
  return (
    <form className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); save.mutate(); }} noValidate>
      <p className="text-xs text-ink/60 sm:col-span-2">Records the report’s details only. Files are not stored in this demo.</p>
      <TextField label="Test name" value={form.testName} onChange={set('testName')} error={errs.testName} required />
      <SelectField label="Category" value={form.category} onChange={set('category')}><option value="pathology">Pathology</option><option value="radiology">Radiology</option><option value="cardiology">Cardiology</option><option value="other">Other</option></SelectField>
      <TextField label="File name" value={form.fileName} onChange={set('fileName')} error={errs.fileName} required />
      <TextField label="Report date" type="date" value={form.reportDate} onChange={set('reportDate')} error={errs.reportDate} />
      <SelectField label="Status" value={form.status} onChange={set('status')}><option value="completed">Completed</option><option value="pending">Pending</option></SelectField>
      <AreaField className="sm:col-span-2" label="Notes" rows={2} value={form.notes} onChange={set('notes')} />
      {error && error.code !== 'VALIDATION_ERROR' && <div className="sm:col-span-2"><ErrorNote error={error} /></div>}
      <div className="sm:col-span-2"><Button type="submit" loading={save.isPending} disabled={!form.testName.trim() || !form.fileName.trim()}>Save report</Button></div>
    </form>
  );
}

const NOTE_FIELDS = [['chief_complaint', 'Chief complaint'], ['symptoms', 'Symptoms'], ['clinical_examination', 'Examination'], ['assessment_notes', 'Assessment'], ['plan', 'Plan'], ['diagnosis_notes', 'Diagnosis']];

function History({ records }) {
  const { encounters, notes, prescriptions, reports } = records;
  if (encounters.length === 0 && reports.length === 0) return <p className="py-8 text-center text-sm text-ink/60">No consultations recorded yet.</p>;
  return (
    <ol className="space-y-6">
      {encounters.map((e) => (
        <li key={e.id} className="rounded-lg border bg-surface">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
            <p className="font-semibold">{fmtDateTime(e.started_at)} <span className="font-normal text-ink/65">with {e.doctor_name}</span></p>
            <StatusPill status={e.status} />
          </div>
          <div className="space-y-4 px-4 py-4 text-sm">
            {notes.filter((n) => n.encounter_id === e.id).map((n) => (
              <dl key={n.id} className="grid gap-x-4 gap-y-1 sm:grid-cols-[9rem_1fr]">
                {NOTE_FIELDS.filter(([k]) => n[k]).map(([k, label]) => (<div key={k} className="contents"><dt className="text-ink/60">{label}</dt><dd>{n[k]}</dd></div>))}
              </dl>
            ))}
            {prescriptions.filter((p) => p.encounter_id === e.id).map((p) => (
              <div key={p.id}>
                <p className="mb-1 font-semibold">Prescription</p>
                <ul className="divide-y rounded-md border">
                  {p.items.map((i) => <li key={i.id} className="flex flex-wrap justify-between gap-2 px-3 py-1.5"><span className="font-medium">{i.medicine_name} <span className="font-normal text-ink/65">{i.dosage}, {i.frequency}</span></span><span className="num text-xs text-ink/60">{i.duration_days} days</span></li>)}
                </ul>
                {p.instructions && <p className="mt-1 text-ink/70">{p.instructions}</p>}
              </div>
            ))}
            {reports.filter((r) => r.encounter_id === e.id).map((r) => <p key={r.id}><span className="font-semibold">{r.test_name}</span> <span className="capitalize text-ink/65">({r.category}, {r.status})</span> <span className="num text-xs text-ink/55">{r.file_name}</span></p>)}
          </div>
        </li>
      ))}
    </ol>
  );
}

export default function PatientRecord() {
  const { id } = useParams();
  const { user } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState('note');

  const patient = useQuery({ queryKey: ['patient', id], queryFn: () => api(`/patients/${id}`) });
  const records = useQuery({ queryKey: ['records', id], queryFn: () => api(`/clinical/patients/${id}/records`) });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['records', id] });
  const active = (records.data?.data.encounters || []).find((e) => e.status === 'in_progress' && e.doctor_id === user.doctorId);

  const complete = useMutation({
    mutationFn: () => api(`/appointments/${active.appointment_id}/status`, { method: 'PATCH', body: { status: 'completed' } }),
    onSuccess: () => { toast.success('Consultation completed.'); refresh(); queryClient.invalidateQueries({ queryKey: ['queue'] }); },
    onError: toast.error,
  });

  const p = patient.data?.data;
  const error = patient.error || records.error;

  return (
    <>
      <Link to="/queue" className="link mb-4 inline-flex items-center gap-1 text-sm"><ArrowLeft className="h-4 w-4" aria-hidden="true" />Back to the queue</Link>
      {(patient.isLoading || records.isLoading) && <Spinner />}
      {error && <ErrorNote error={error} onRetry={() => { patient.refetch(); records.refetch(); }} />}
      {p && records.data && (
        <>
          <header className="mb-6">
            <h1 className="text-3xl font-semibold">{p.full_name}</h1>
            <p className="mt-1 text-sm text-ink/70"><span className="num">{p.mrn}</span> · {ageFromDob(p.date_of_birth)} yrs, <span className="capitalize">{p.gender}</span> · Blood group {p.blood_group || 'not recorded'} · <span className="num">{p.phone}</span></p>
            {p.allergies && (
              <p role="note" className="mt-3 flex items-start gap-2 rounded-md border-l-4 border-coral bg-coral/10 px-3 py-2 text-sm"><ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-coral-ink" aria-hidden="true" /><span><span className="font-semibold">Allergies.</span> {p.allergies}</span></p>
            )}
          </header>

          <div className="grid gap-8 lg:grid-cols-[1fr_1.1fr]">
            <section aria-label="Current consultation">
              <h2 className="mb-3 text-xl font-semibold">Current consultation</h2>
              {active ? (
                <Card className="p-4">
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm text-ink/70">Started {fmtDate(active.started_at)}, {fmtDateTime(active.started_at)}</p>
                    <Button size="sm" loading={complete.isPending} onClick={() => complete.mutate()}><CheckCircle2 className="h-4 w-4" aria-hidden="true" />Complete consultation</Button>
                  </div>
                  <Tabs label="Add to this consultation" value={tab} onChange={setTab} tabs={[{ id: 'note', label: 'Note' }, { id: 'rx', label: 'Prescription' }, { id: 'report', label: 'Report' }]} />
                  {tab === 'note' && <NoteForm encounterId={active.id} onSaved={refresh} />}
                  {tab === 'rx' && <PrescriptionForm encounterId={active.id} onSaved={refresh} />}
                  {tab === 'report' && <ReportForm patientId={id} encounterId={active.id} onSaved={refresh} />}
                </Card>
              ) : (
                <Card className="p-5 text-sm">
                  <p className="font-semibold">No consultation is open for this patient.</p>
                  <p className="mt-1 text-ink/65">Notes and prescriptions are added during a consultation. Start one from <Link to="/queue" className="link">today’s queue</Link> once the patient is checked in.</p>
                </Card>
              )}
            </section>

            <section aria-label="History">
              <h2 className="mb-3 text-xl font-semibold">History</h2>
              <History records={records.data.data} />
            </section>
          </div>
        </>
      )}
    </>
  );
}
