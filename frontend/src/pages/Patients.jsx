import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, UserPlus, Users } from 'lucide-react';
import { api, fieldErrors } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { ageFromDob, dobText } from '../lib/format.js';
import { useToast } from '../components/Toasts.jsx';
import { AreaField, Button, Card, Empty, ErrorNote, Initials, Modal, PageHeader, Pager, SearchBox, SelectField, TableSkeleton, TextField, useDebounced } from '../components/ui.jsx';

const BLOOD = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
const BLANK = { fullName: '', dateOfBirth: '', gender: '', phone: '', email: '', address: '', emergencyContactName: '', emergencyContactPhone: '', bloodGroup: '', allergies: '' };

function fromRow(p) {
  return {
    fullName: p.full_name || '',
    dateOfBirth: dobText(p.date_of_birth),
    gender: p.gender || '',
    phone: p.phone || '',
    email: p.email || '',
    address: p.address || '',
    emergencyContactName: p.emergency_contact_name || '',
    emergencyContactPhone: p.emergency_contact_phone || '',
    bloodGroup: p.blood_group || '',
    allergies: p.allergies || '',
  };
}

function PatientForm({ open, onClose, patient }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const editing = Boolean(patient);
  const [form, setForm] = useState(BLANK);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (open) {
      setForm(patient ? fromRow(patient) : BLANK);
      setError(null);
    }
  }, [open, patient]);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const errs = fieldErrors(error);

  const save = useMutation({
    mutationFn: () => {
      if (!editing) {
        const body = { ...form };
        for (const k of ['email', 'address', 'emergencyContactName', 'emergencyContactPhone', 'bloodGroup', 'allergies']) if (!body[k]) delete body[k];
        return api('/patients', { method: 'POST', body });
      }
      // Send only what changed; date of birth and gender are not editable through the API
      const original = fromRow(patient);
      const body = {};
      for (const k of Object.keys(form)) {
        if (k === 'dateOfBirth' || k === 'gender') continue;
        if (form[k] !== original[k] && !(k === 'bloodGroup' && !form[k])) body[k] = form[k];
      }
      if (Object.keys(body).length === 0) return Promise.resolve(null);
      return api(`/patients/${patient.id}`, { method: 'PUT', body });
    },
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['patients'] });
      toast.success(editing ? (res ? 'Patient details saved.' : 'Nothing changed.') : `Registered ${res.data.full_name} (${res.data.mrn}).`);
      onClose();
    },
    onError: setError,
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? 'Edit patient' : 'Register patient'}
      width="max-w-2xl"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button loading={save.isPending} onClick={() => save.mutate()}>{editing ? 'Save changes' : 'Register patient'}</Button>
        </>
      }
    >
      <form onSubmit={(e) => { e.preventDefault(); save.mutate(); }} className="grid gap-4 sm:grid-cols-2" noValidate>
        <TextField className="sm:col-span-2" label="Full name" value={form.fullName} onChange={set('fullName')} error={errs.fullName} required />
        <TextField label="Date of birth" type="date" max={new Date().toISOString().slice(0, 10)} value={form.dateOfBirth} onChange={set('dateOfBirth')} error={errs.dateOfBirth} disabled={editing} hint={editing ? 'Cannot be changed here' : undefined} required />
        <SelectField label="Gender" value={form.gender} onChange={set('gender')} error={errs.gender} disabled={editing} required>
          <option value="">Select</option>
          <option value="female">Female</option>
          <option value="male">Male</option>
          <option value="other">Other</option>
        </SelectField>
        <TextField label="Phone" type="tel" value={form.phone} onChange={set('phone')} error={errs.phone} required />
        <TextField label="Email" type="email" value={form.email} onChange={set('email')} error={errs.email} />
        <TextField className="sm:col-span-2" label="Address" value={form.address} onChange={set('address')} error={errs.address} />
        <TextField label="Emergency contact name" value={form.emergencyContactName} onChange={set('emergencyContactName')} error={errs.emergencyContactName} />
        <TextField label="Emergency contact phone" type="tel" value={form.emergencyContactPhone} onChange={set('emergencyContactPhone')} error={errs.emergencyContactPhone} />
        <SelectField label="Blood group" value={form.bloodGroup} onChange={set('bloodGroup')} error={errs.bloodGroup}>
          <option value="">Not recorded</option>
          {BLOOD.map((b) => <option key={b}>{b}</option>)}
        </SelectField>
        <AreaField className="sm:col-span-2" label="Allergies" hint="Shown to clinicians at the top of the record." rows={2} value={form.allergies} onChange={set('allergies')} error={errs.allergies} />
        {error && error.code !== 'VALIDATION_ERROR' && <div className="sm:col-span-2"><ErrorNote error={error} /></div>}
        <button type="submit" className="hidden" />
      </form>
    </Modal>
  );
}

export default function Patients() {
  const { user } = useAuth();
  const [q, setQ] = useState('');
  const dq = useDebounced(q.trim(), 300);
  const [page, setPage] = useState(1);
  const [form, setForm] = useState({ open: false, patient: null });
  useEffect(() => setPage(1), [dq]);

  const list = useQuery({
    queryKey: ['patients', dq, page],
    queryFn: () => api('/patients', { query: { q: dq, page, pageSize: 15 } }),
    placeholderData: keepPreviousData,
  });

  const canEdit = user.role === 'front_desk';
  const isClinician = user.role === 'clinician';
  const rows = list.data?.data || [];

  return (
    <>
      <PageHeader
        title={isClinician ? 'My patients' : 'Patients'}
        subtitle={isClinician ? 'Patients you have an appointment or consultation with. Opening a record is logged.' : 'Search by name, MRN or phone number.'}
        actions={canEdit && <Button onClick={() => setForm({ open: true, patient: null })}><UserPlus className="h-4 w-4" aria-hidden="true" />Register patient</Button>}
      />
      <Card>
        <div className="border-b p-3"><SearchBox value={q} onChange={setQ} placeholder="Search patients" className="max-w-sm" /></div>
        {list.error ? (
          <div className="p-4"><ErrorNote error={list.error} onRetry={list.refetch} /></div>
        ) : list.isLoading ? (
          <TableSkeleton cols={5} />
        ) : rows.length === 0 ? (
          <Empty icon={Users} title={dq ? `No patient matches “${dq}”` : 'No patients yet'} action={canEdit && !dq && <Button onClick={() => setForm({ open: true, patient: null })}><Plus className="h-4 w-4" aria-hidden="true" />Register the first patient</Button>}>
            {dq ? 'Check the spelling or try the MRN or phone number.' : isClinician ? 'Patients appear here once they are booked with you.' : undefined}
          </Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead><tr><th className="th">Patient</th><th className="th">Age and sex</th><th className="th">Phone</th><th className="th">Blood group</th><th className="th"><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.id} className="hover:bg-mint/30">
                    <td className="td"><div className="flex items-center gap-3"><Initials name={p.full_name} /><div><p className="font-semibold">{p.full_name}</p><p className="num text-xs text-ink/60">{p.mrn}</p></div></div></td>
                    <td className="td">{ageFromDob(p.date_of_birth)} yrs, <span className="capitalize">{p.gender}</span></td>
                    <td className="td num">{p.phone}</td>
                    <td className="td">{p.blood_group || <span className="text-ink/40">Not recorded</span>}</td>
                    <td className="td text-right">
                      {canEdit && <Button size="sm" variant="secondary" onClick={() => setForm({ open: true, patient: p })}><Pencil className="h-3.5 w-3.5" aria-hidden="true" />Edit</Button>}
                      {isClinician && <Link className="link text-sm font-semibold" to={`/patients/${p.id}/record`}>Open record</Link>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pager page={page} pageSize={list.data?.pageSize || 15} total={list.data?.total || 0} onPage={setPage} />
      </Card>
      <PatientForm open={form.open} patient={form.patient} onClose={() => setForm({ open: false, patient: null })} />
    </>
  );
}
