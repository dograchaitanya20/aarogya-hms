import { Fragment, useEffect, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, ScrollText } from 'lucide-react';
import { api } from '../../lib/api.js';
import { fmtDateTime } from '../../lib/format.js';
import { Card, Empty, ErrorNote, PageHeader, Pager, SelectField, StatusPill, Tabs, TableSkeleton, TextField, Button } from '../../components/ui.jsx';

const ACTIONS = ['LOGIN_SUCCESS', 'LOGIN_FAILURE', 'PERMISSION_DENIED', 'CREATE_PATIENT', 'UPDATE_PATIENT', 'CREATE_APPOINTMENT', 'UPDATE_APPOINTMENT_STATUS', 'CANCEL_APPOINTMENT', 'CREATE_ENCOUNTER', 'CREATE_CLINICAL_NOTE', 'CREATE_PRESCRIPTION', 'READ_CLINICAL_RECORD', 'CREATE_INVOICE', 'CREATE_PAYMENT', 'PAYMENT_DECLINED', 'PAYMENT_REJECTED_OVERPAYMENT', 'CANCEL_INVOICE', 'CREATE_DOCTOR', 'UPDATE_DOCTOR', 'DELETE_DOCTOR', 'CREATE_STAFF_USER', 'UPDATE_STAFF_STATUS'];

function AuditLog() {
  const [action, setAction] = useState('');
  const [entityType, setEntityType] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(null);
  useEffect(() => setPage(1), [action, entityType, from, to]);

  const list = useQuery({
    queryKey: ['audit', action, entityType, from, to, page],
    queryFn: () => api('/audit/logs', { query: { action, entityType, from, to, page, pageSize: 20 } }),
    placeholderData: keepPreviousData,
  });
  const rows = list.data?.data || [];

  return (
    <Card>
      <div className="grid gap-3 border-b p-3 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <TextField label="Action" list="audit-actions" placeholder="Any action" value={action} onChange={(e) => setAction(e.target.value.trim())} />
          <datalist id="audit-actions">{ACTIONS.map((a) => <option key={a} value={a} />)}</datalist>
        </div>
        <SelectField label="About" value={entityType} onChange={(e) => setEntityType(e.target.value)}>
          <option value="">Anything</option><option value="patient">Patients</option><option value="appointment">Appointments</option><option value="invoice">Invoices</option><option value="encounter">Consultations</option><option value="user">Accounts</option><option value="authorization">Denied access</option>
        </SelectField>
        <TextField label="From" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        <TextField label="To" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
      </div>
      {list.error ? <div className="p-4"><ErrorNote error={list.error} onRetry={list.refetch} /></div> : list.isLoading ? <TableSkeleton cols={4} /> : rows.length === 0 ? (
        <Empty icon={ScrollText} title="No activity matches" action={<Button variant="secondary" onClick={() => { setAction(''); setEntityType(''); setFrom(''); setTo(''); }}>Clear filters</Button>}>The log is append-only: entries cannot be edited or removed.</Empty>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead><tr><th className="th w-8"><span className="sr-only">Details</span></th><th className="th">When</th><th className="th">Who</th><th className="th">Action</th><th className="th">About</th></tr></thead>
            <tbody>
              {rows.map((r) => {
                const isOpen = open === r.id;
                const hasDetail = r.before_state || r.after_state;
                return (
                  <Fragment key={r.id}>
                    <tr className="hover:bg-mint/30">
                      <td className="td">{hasDetail && <button onClick={() => setOpen(isOpen ? null : r.id)} aria-expanded={isOpen} aria-label={isOpen ? 'Hide details' : 'Show details'} className="rounded p-0.5 hover:bg-ink/10">{isOpen ? <ChevronDown className="h-4 w-4" aria-hidden="true" /> : <ChevronRight className="h-4 w-4" aria-hidden="true" />}</button>}</td>
                      <td className="td num whitespace-nowrap text-xs">{fmtDateTime(r.ts)}</td>
                      <td className="td"><p className="font-semibold">{r.actor_name || 'Not signed in'}</p><p className="text-xs text-ink/60">{r.actor_role?.replace('_', ' ') || ''}</p></td>
                      <td className="td num text-xs">{r.action}</td>
                      <td className="td text-sm"><span className="capitalize">{r.entity_type}</span> <span className="num text-xs text-ink/55">{String(r.entity_id || '').slice(0, 8)}</span></td>
                    </tr>
                    {isOpen && (
                      <tr><td colSpan={5} className="border-b bg-ink/[0.03] px-6 py-3">
                        <div className="grid gap-3 md:grid-cols-2">
                          {r.before_state && <div><p className="mb-1 text-xs font-semibold text-ink/60">Before</p><pre className="num max-h-56 overflow-auto rounded-md border bg-surface p-3 text-xs">{JSON.stringify(r.before_state, null, 2)}</pre></div>}
                          {r.after_state && <div><p className="mb-1 text-xs font-semibold text-ink/60">After</p><pre className="num max-h-56 overflow-auto rounded-md border bg-surface p-3 text-xs">{JSON.stringify(r.after_state, null, 2)}</pre></div>}
                        </div>
                        {r.request_id && <p className="num mt-2 text-xs text-ink/55">Request {r.request_id}</p>}
                      </td></tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <Pager page={page} pageSize={list.data?.pageSize || 20} total={list.data?.total || 0} onPage={setPage} />
    </Card>
  );
}

function Consultations() {
  const [page, setPage] = useState(1);
  const list = useQuery({ queryKey: ['encounters', page], queryFn: () => api('/clinical/encounters', { query: { page, pageSize: 15 } }), placeholderData: keepPreviousData });
  const rows = list.data?.data || [];
  return (
    <Card>
      <p className="border-b px-4 py-3 text-sm text-ink/65">Who was seen, by whom, and when. Clinical notes and prescriptions are never shown to administrators.</p>
      {list.error ? <div className="p-4"><ErrorNote error={list.error} onRetry={list.refetch} /></div> : list.isLoading ? <TableSkeleton cols={4} /> : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead><tr><th className="th">Started</th><th className="th">Patient</th><th className="th">Doctor</th><th className="th">Status</th></tr></thead>
            <tbody>{rows.map((e) => <tr key={e.id}><td className="td num text-xs">{fmtDateTime(e.started_at)}</td><td className="td"><p className="font-semibold">{e.patient_name}</p><p className="num text-xs text-ink/60">{e.mrn}</p></td><td className="td">{e.doctor_name}</td><td className="td"><StatusPill status={e.status} /></td></tr>)}</tbody>
          </table>
        </div>
      )}
      <Pager page={page} pageSize={list.data?.pageSize || 15} total={list.data?.total || 0} onPage={setPage} />
    </Card>
  );
}

export default function Activity() {
  const [tab, setTab] = useState('audit');
  return (
    <>
      <PageHeader title="Activity log" subtitle="Every change and every record access, with who did it. Entries cannot be edited or deleted." />
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'audit', label: 'Audit log' }, { id: 'consults', label: 'Consultations' }]} />
      {tab === 'audit' ? <AuditLog /> : <Consultations />}
    </>
  );
}
