import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, Plus, Trash2, UserPlus } from 'lucide-react';
import { api, fieldErrors } from '../../lib/api.js';
import { useAuth } from '../../lib/auth.jsx';
import { WEEKDAYS, hhmm, rupees, rupeesToPaise, toNumber } from '../../lib/format.js';
import { useToast } from '../../components/Toasts.jsx';
import { AreaField, Button, Card, Empty, ErrorNote, Initials, Modal, PageHeader, Pager, SelectField, Spinner, Tabs, TableSkeleton, TextField } from '../../components/ui.jsx';

const SLOT_MINUTES = [10, 15, 20, 30, 45, 60];

/* ---------- Doctors ---------- */
function DoctorForm({ open, onClose, doctor, departments }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const editing = Boolean(doctor);
  const blank = { email: '', password: '', fullName: '', phone: '', departmentId: '', specialization: '', fee: '', roomNumber: '' };
  const [f, setF] = useState(blank);
  const [error, setError] = useState(null);
  useEffect(() => {
    if (open) {
      setError(null);
      setF(doctor ? { ...blank, departmentId: doctor.department_id, specialization: doctor.specialization, fee: (toNumber(doctor.consultation_fee_paise) / 100).toFixed(2), roomNumber: doctor.room_number || '' } : blank);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, doctor]);
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));
  const feePaise = rupeesToPaise(f.fee);
  const errs = fieldErrors(error);

  const save = useMutation({
    mutationFn: () => {
      if (feePaise === null) throw Object.assign(new Error('Fee'), { code: 'VALIDATION_ERROR', details: { consultationFeePaise: 'Enter the fee in rupees, up to 2 decimals' } });
      if (editing) return api(`/directory/doctors/${doctor.id}`, { method: 'PATCH', body: { specialization: f.specialization, consultationFeePaise: feePaise, departmentId: f.departmentId, roomNumber: f.roomNumber } });
      return api('/directory/doctors', { method: 'POST', body: { email: f.email, password: f.password, fullName: f.fullName, phone: f.phone, departmentId: f.departmentId, specialization: f.specialization, consultationFeePaise: feePaise, ...(f.roomNumber && { roomNumber: f.roomNumber }) } });
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['doctors'] }); queryClient.invalidateQueries({ queryKey: ['directory-doctors'] }); toast.success(editing ? 'Doctor updated.' : 'Doctor added. They can sign in now.'); onClose(); },
    onError: setError,
  });

  return (
    <Modal open={open} onClose={onClose} title={editing ? `Edit ${doctor.doctor_name}` : 'Add doctor'} width="max-w-2xl" footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button loading={save.isPending} onClick={() => save.mutate()}>{editing ? 'Save changes' : 'Add doctor'}</Button></>}>
      <form className="grid gap-4 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); save.mutate(); }} noValidate>
        {!editing && (
          <>
            <TextField className="sm:col-span-2" label="Full name" value={f.fullName} onChange={set('fullName')} error={errs.fullName} required />
            <TextField label="Email (their sign-in)" type="email" value={f.email} onChange={set('email')} error={errs.email} required />
            <TextField label="Phone" type="tel" value={f.phone} onChange={set('phone')} error={errs.phone} required />
            <TextField className="sm:col-span-2" label="Temporary password" type="password" autoComplete="new-password" hint="At least 8 characters." value={f.password} onChange={set('password')} error={errs.password} required />
          </>
        )}
        <SelectField label="Department" value={f.departmentId} onChange={set('departmentId')} error={errs.departmentId} required>
          <option value="">Select</option>
          {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </SelectField>
        <TextField label="Specialization" value={f.specialization} onChange={set('specialization')} error={errs.specialization} required />
        <TextField label="Consultation fee (₹)" inputMode="decimal" inputClassName="num" value={f.fee} onChange={set('fee')} error={errs.consultationFeePaise} required />
        <TextField label="Room" value={f.roomNumber} onChange={set('roomNumber')} />
        {error && error.code !== 'VALIDATION_ERROR' && <div className="sm:col-span-2"><ErrorNote error={error} /></div>}
        <button type="submit" className="hidden" />
      </form>
    </Modal>
  );
}

function ScheduleModal({ doctor, onClose }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [rule, setRule] = useState({ dayOfWeek: '1', startTime: '09:00', endTime: '13:00', slotDurationMinutes: '15' });
  const [error, setError] = useState(null);
  const rules = useQuery({ queryKey: ['rules', doctor?.id], queryFn: () => api(`/directory/doctors/${doctor.id}/schedules`), enabled: Boolean(doctor) });
  const refresh = () => { queryClient.invalidateQueries({ queryKey: ['rules', doctor.id] }); queryClient.invalidateQueries({ queryKey: ['schedules', doctor.id] }); queryClient.invalidateQueries({ queryKey: ['open-slots'] }); };

  const add = useMutation({
    mutationFn: () => api('/directory/schedules', { method: 'POST', body: { doctorId: doctor.id, dayOfWeek: Number(rule.dayOfWeek), startTime: rule.startTime, endTime: rule.endTime, slotDurationMinutes: Number(rule.slotDurationMinutes) } }),
    onSuccess: () => { toast.success('Working hours added.'); setError(null); refresh(); },
    onError: setError,
  });
  const remove = useMutation({
    mutationFn: (id) => api(`/directory/schedules/${id}`, { method: 'DELETE' }),
    onSuccess: () => { toast.success('Working hours removed.'); refresh(); },
    onError: toast.error,
  });
  const sorted = [...(rules.data?.data || [])].sort((a, b) => a.day_of_week - b.day_of_week || a.start_time.localeCompare(b.start_time));

  return (
    <Modal open={Boolean(doctor)} onClose={onClose} title={doctor ? `Working hours, ${doctor.doctor_name}` : ''} width="max-w-2xl" footer={<Button variant="secondary" onClick={onClose}>Done</Button>}>
      <p className="mb-4 text-sm text-ink/65">Times are hospital time (IST). Bookable slots are generated from these rules. Overlapping hours on the same day are rejected.</p>
      {rules.isLoading ? <Spinner /> : sorted.length === 0 ? <p className="mb-4 text-sm text-ink/60">No working hours yet, so this doctor cannot be booked.</p> : (
        <ul className="mb-6 divide-y rounded-md border">
          {sorted.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
              <span><span className="inline-block w-24 font-semibold">{WEEKDAYS[r.day_of_week]}</span><span className="num">{hhmm(r.start_time)} to {hhmm(r.end_time)}</span> <span className="text-ink/60">every {r.slot_duration_minutes} min</span></span>
              <Button size="sm" variant="ghost" onClick={() => remove.mutate(r.id)} aria-label={`Remove ${WEEKDAYS[r.day_of_week]} ${hhmm(r.start_time)}`}><Trash2 className="h-4 w-4" aria-hidden="true" /></Button>
            </li>
          ))}
        </ul>
      )}
      <h3 className="mb-2 font-sans text-sm font-semibold">Add working hours</h3>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SelectField label="Day" value={rule.dayOfWeek} onChange={(e) => setRule({ ...rule, dayOfWeek: e.target.value })}>{WEEKDAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}</SelectField>
        <TextField label="From" type="time" value={rule.startTime} onChange={(e) => setRule({ ...rule, startTime: e.target.value })} />
        <TextField label="To" type="time" value={rule.endTime} onChange={(e) => setRule({ ...rule, endTime: e.target.value })} />
        <SelectField label="Slot length" value={rule.slotDurationMinutes} onChange={(e) => setRule({ ...rule, slotDurationMinutes: e.target.value })}>{SLOT_MINUTES.map((m) => <option key={m} value={m}>{m} min</option>)}</SelectField>
      </div>
      {error && <div className="mt-3"><ErrorNote error={error} /></div>}
      <Button className="mt-3" size="sm" loading={add.isPending} onClick={() => add.mutate()}><Plus className="h-4 w-4" aria-hidden="true" />Add hours</Button>
    </Modal>
  );
}

function Doctors({ departments }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [active, setActive] = useState('true');
  const [form, setForm] = useState({ open: false, doctor: null });
  const [hoursFor, setHoursFor] = useState(null);
  const list = useQuery({ queryKey: ['directory-doctors', active], queryFn: () => api('/directory/doctors', { query: { isActive: active, pageSize: 100 } }) });
  const rows = list.data?.data || [];

  const toggle = useMutation({
    mutationFn: (d) => api(`/directory/doctors/${d.id}`, { method: 'PATCH', body: { isActive: !d.is_active } }),
    onSuccess: (_, d) => { toast.success(d.is_active ? `${d.doctor_name} deactivated. Their sign-in is disabled.` : `${d.doctor_name} reactivated.`); queryClient.invalidateQueries({ queryKey: ['directory-doctors'] }); queryClient.invalidateQueries({ queryKey: ['doctors'] }); },
    onError: toast.error,
  });

  return (
    <Card>
      <div className="flex flex-wrap items-end justify-between gap-3 border-b p-3">
        <SelectField label="Show" value={active} onChange={(e) => setActive(e.target.value)} className="w-44"><option value="true">Active doctors</option><option value="false">Deactivated doctors</option></SelectField>
        <Button onClick={() => setForm({ open: true, doctor: null })}><UserPlus className="h-4 w-4" aria-hidden="true" />Add doctor</Button>
      </div>
      {list.error ? <div className="p-4"><ErrorNote error={list.error} onRetry={list.refetch} /></div> : list.isLoading ? <TableSkeleton cols={5} /> : rows.length === 0 ? <Empty title="No doctors here" /> : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead><tr><th className="th">Doctor</th><th className="th">Department</th><th className="th">Room</th><th className="th text-right">Fee</th><th className="th"><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {rows.map((d) => (
                <tr key={d.id} className="hover:bg-mint/30">
                  <td className="td"><div className="flex items-center gap-3"><Initials name={d.doctor_name} /><div><p className="font-semibold">{d.doctor_name}</p><p className="num text-xs text-ink/60">{d.email}</p></div></div></td>
                  <td className="td"><p>{d.department_name}</p><p className="text-xs text-ink/60">{d.specialization}</p></td>
                  <td className="td">{d.room_number || <span className="text-ink/40">None</span>}</td>
                  <td className="td num text-right">{rupees(toNumber(d.consultation_fee_paise))}</td>
                  <td className="td"><div className="flex flex-wrap justify-end gap-1.5">
                    {d.is_active && <Button size="sm" variant="secondary" onClick={() => setHoursFor(d)}><CalendarClock className="h-3.5 w-3.5" aria-hidden="true" />Hours</Button>}
                    {d.is_active && <Button size="sm" variant="secondary" onClick={() => setForm({ open: true, doctor: d })}>Edit</Button>}
                    <Button size="sm" variant={d.is_active ? 'ghost' : 'secondary'} loading={toggle.isPending && toggle.variables?.id === d.id} onClick={() => toggle.mutate(d)}>{d.is_active ? 'Deactivate' : 'Reactivate'}</Button>
                  </div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <DoctorForm open={form.open} doctor={form.doctor} departments={departments} onClose={() => setForm({ open: false, doctor: null })} />
      <ScheduleModal doctor={hoursFor} onClose={() => setHoursFor(null)} />
    </Card>
  );
}

/* ---------- Departments ---------- */
function Departments({ departments, loading, error, retry }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ open: false, dept: null });
  const [f, setF] = useState({ name: '', code: '', description: '' });
  const [err, setErr] = useState(null);
  const editing = Boolean(form.dept);
  useEffect(() => { if (form.open) { setErr(null); setF(form.dept ? { name: form.dept.name, code: form.dept.code, description: form.dept.description || '' } : { name: '', code: '', description: '' }); } }, [form]);
  const errs = fieldErrors(err);

  const save = useMutation({
    mutationFn: () => (editing ? api(`/directory/departments/${form.dept.id}`, { method: 'PATCH', body: f }) : api('/directory/departments', { method: 'POST', body: { name: f.name, code: f.code, ...(f.description && { description: f.description }) } })),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['departments'] }); toast.success(editing ? 'Department updated.' : 'Department added.'); setForm({ open: false, dept: null }); },
    onError: setErr,
  });
  const deactivate = useMutation({
    mutationFn: (d) => api(`/directory/departments/${d.id}`, { method: 'DELETE' }),
    onSuccess: (_, d) => { queryClient.invalidateQueries({ queryKey: ['departments'] }); toast.success(`${d.name} deactivated.`); },
    onError: toast.error,
  });

  return (
    <Card>
      <div className="flex justify-end border-b p-3"><Button onClick={() => setForm({ open: true, dept: null })}><Plus className="h-4 w-4" aria-hidden="true" />Add department</Button></div>
      {error ? <div className="p-4"><ErrorNote error={error} onRetry={retry} /></div> : loading ? <TableSkeleton cols={3} /> : (
        <table className="w-full">
          <thead><tr><th className="th">Department</th><th className="th">Code</th><th className="th"><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>{departments.map((d) => (
            <tr key={d.id} className="hover:bg-mint/30">
              <td className="td"><p className="font-semibold">{d.name}</p>{d.description && <p className="text-xs text-ink/60">{d.description}</p>}</td>
              <td className="td num">{d.code}</td>
              <td className="td"><div className="flex justify-end gap-1.5"><Button size="sm" variant="secondary" onClick={() => setForm({ open: true, dept: d })}>Edit</Button><Button size="sm" variant="ghost" onClick={() => deactivate.mutate(d)}>Deactivate</Button></div></td>
            </tr>
          ))}</tbody>
        </table>
      )}
      <Modal open={form.open} onClose={() => setForm({ open: false, dept: null })} title={editing ? 'Edit department' : 'Add department'} footer={<><Button variant="ghost" onClick={() => setForm({ open: false, dept: null })}>Cancel</Button><Button loading={save.isPending} onClick={() => save.mutate()}>Save</Button></>}>
        <div className="space-y-4">
          <TextField label="Name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} error={errs.name} required />
          <TextField label="Code" hint="Short and unique, for example CARD." value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} error={errs.code} required />
          <AreaField label="Description" rows={2} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
          {err && err.code !== 'VALIDATION_ERROR' && <ErrorNote error={err} />}
        </div>
      </Modal>
    </Card>
  );
}

/* ---------- Staff ---------- */
function Staff() {
  const { user } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ fullName: '', email: '', phone: '', password: '', role: 'front_desk' });
  const [err, setErr] = useState(null);
  const errs = fieldErrors(err);
  const list = useQuery({ queryKey: ['staff', page], queryFn: () => api('/directory/staff', { query: { page, pageSize: 15 } }) });
  const rows = list.data?.data || [];

  const create = useMutation({
    mutationFn: () => api('/directory/staff', { method: 'POST', body: f }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['staff'] }); toast.success('Account created.'); setOpen(false); setF({ fullName: '', email: '', phone: '', password: '', role: 'front_desk' }); },
    onError: setErr,
  });
  const toggle = useMutation({
    mutationFn: (u) => api(`/directory/staff/${u.id}/status`, { method: 'PATCH', body: { isActive: !u.is_active } }),
    onSuccess: (_, u) => { queryClient.invalidateQueries({ queryKey: ['staff'] }); toast.success(u.is_active ? `${u.full_name} deactivated.` : `${u.full_name} reactivated.`); },
    onError: toast.error,
  });

  return (
    <Card>
      <div className="flex justify-end border-b p-3"><Button onClick={() => { setErr(null); setOpen(true); }}><UserPlus className="h-4 w-4" aria-hidden="true" />Add staff account</Button></div>
      {list.error ? <div className="p-4"><ErrorNote error={list.error} onRetry={list.refetch} /></div> : list.isLoading ? <TableSkeleton cols={4} /> : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead><tr><th className="th">Name</th><th className="th">Role</th><th className="th">Status</th><th className="th"><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>{rows.map((u) => (
              <tr key={u.id} className="hover:bg-mint/30">
                <td className="td"><div className="flex items-center gap-3"><Initials name={u.full_name} /><div><p className="font-semibold">{u.full_name}</p><p className="num text-xs text-ink/60">{u.email}</p></div></div></td>
                <td className="td capitalize">{u.role.replace('_', ' ')}</td>
                <td className="td">{u.is_active ? 'Active' : <span className="text-coral-ink">Deactivated</span>}</td>
                <td className="td text-right">{u.id === user.id ? <span className="text-xs text-ink/55">You</span> : <Button size="sm" variant={u.is_active ? 'ghost' : 'secondary'} onClick={() => toggle.mutate(u)}>{u.is_active ? 'Deactivate' : 'Reactivate'}</Button>}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      <Pager page={page} pageSize={list.data?.pageSize || 15} total={list.data?.total || 0} onPage={setPage} />
      <Modal open={open} onClose={() => setOpen(false)} title="Add staff account" footer={<><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button loading={create.isPending} onClick={() => create.mutate()}>Create account</Button></>}>
        <div className="space-y-4">
          <TextField label="Full name" value={f.fullName} onChange={(e) => setF({ ...f, fullName: e.target.value })} error={errs.fullName} required />
          <TextField label="Email" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} error={errs.email} required />
          <TextField label="Phone" type="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} error={errs.phone} required />
          <SelectField label="Role" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}><option value="front_desk">Front desk</option><option value="admin">Administrator</option></SelectField>
          <TextField label="Temporary password" type="password" autoComplete="new-password" hint="At least 8 characters." value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} error={errs.password} required />
          {err && err.code !== 'VALIDATION_ERROR' && <ErrorNote error={err} />}
        </div>
      </Modal>
    </Card>
  );
}

export default function Directory() {
  const [tab, setTab] = useState('doctors');
  const departments = useQuery({ queryKey: ['departments'], queryFn: () => api('/directory/departments') });
  return (
    <>
      <PageHeader title="Directory" subtitle="Doctors and their working hours, departments, and staff accounts." />
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'doctors', label: 'Doctors' }, { id: 'departments', label: 'Departments' }, { id: 'staff', label: 'Staff accounts' }]} />
      {tab === 'doctors' && <Doctors departments={departments.data?.data || []} />}
      {tab === 'departments' && <Departments departments={departments.data?.data || []} loading={departments.isLoading} error={departments.error} retry={departments.refetch} />}
      {tab === 'staff' && <Staff />}
    </>
  );
}
