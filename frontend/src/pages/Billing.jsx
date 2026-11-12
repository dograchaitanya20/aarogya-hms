import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BadgeCheck, CreditCard, FilePlus2, Plus, Printer, ReceiptText, Trash2, TriangleAlert } from 'lucide-react';
import { api, explain, newIdempotencyKey } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { fmtDate, fmtDateTime, fmtTime, rupees, rupeesToPaise, toNumber } from '../lib/format.js';
import { useToast } from '../components/Toasts.jsx';
import PatientPicker from '../components/PatientPicker.jsx';
import { EmptyBillingArt } from '../components/Art.jsx';
import { AreaField, Button, Card, Empty, ErrorNote, Modal, PageHeader, Pager, SearchBox, SelectField, Spinner, StatusPill, TableSkeleton, TextField, useDebounced } from '../components/ui.jsx';

const BLANK_ITEM = () => ({ id: Math.random().toString(36).slice(2), description: '', qty: '1', price: '' });

/* ---------- New invoice ---------- */
function NewInvoiceModal({ open, onClose, prefill, onCreated }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [patient, setPatient] = useState(null);
  const [appointmentId, setAppointmentId] = useState('');
  const [items, setItems] = useState([BLANK_ITEM()]);
  const [tax, setTax] = useState('');
  const [discount, setDiscount] = useState('');
  const [error, setError] = useState(null);
  const keyRef = useRef(null);

  const doctors = useQuery({ queryKey: ['doctors'], queryFn: () => api('/directory/doctors', { query: { pageSize: 100 } }), enabled: open });
  const appts = useQuery({
    queryKey: ['patient-appts', patient?.id],
    queryFn: () => api('/appointments', { query: { patientId: patient.id, pageSize: 50 } }),
    enabled: open && Boolean(patient),
  });
  const choices = (appts.data?.data || []).filter((a) => !['cancelled', 'no_show'].includes(a.status));

  const feeItemFor = (appt) => {
    const d = (doctors.data?.data || []).find((x) => x.id === appt.doctor_id);
    return { ...BLANK_ITEM(), description: `Consultation, ${appt.doctor_name}`, price: d ? (toNumber(d.consultation_fee_paise) / 100).toFixed(2) : '' };
  };

  useEffect(() => {
    if (!open) return;
    setError(null);
    keyRef.current = null;
    setTax('');
    setDiscount('');
    if (prefill) {
      setPatient({ id: prefill.patient_id, full_name: prefill.patient_name, mrn: prefill.mrn });
      setAppointmentId(prefill.id);
      setItems([feeItemFor(prefill)]);
    } else {
      setPatient(null);
      setAppointmentId('');
      setItems([BLANK_ITEM()]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, prefill]);

  const parsed = items.map((i) => ({ description: i.description.trim(), quantity: parseInt(i.qty, 10), unitPricePaise: rupeesToPaise(i.price) }));
  const itemsOk = parsed.length > 0 && parsed.every((p) => p.description && Number.isInteger(p.quantity) && p.quantity >= 1 && p.unitPricePaise !== null);
  const taxPaise = tax.trim() === '' ? 0 : rupeesToPaise(tax);
  const discountPaise = discount.trim() === '' ? 0 : rupeesToPaise(discount);
  const subtotal = itemsOk ? parsed.reduce((s, p) => s + p.quantity * p.unitPricePaise, 0) : 0;
  const amountsOk = taxPaise !== null && discountPaise !== null;
  const tooMuch = amountsOk && discountPaise > subtotal + taxPaise;
  const total = amountsOk ? subtotal + taxPaise - discountPaise : 0;
  const canSubmit = Boolean(patient) && itemsOk && amountsOk && !tooMuch;

  const create = useMutation({
    mutationFn: () => {
      if (!keyRef.current) keyRef.current = newIdempotencyKey();
      return api('/billing/invoices', {
        method: 'POST',
        idempotencyKey: keyRef.current,
        body: { patientId: patient.id, ...(appointmentId && { appointmentId }), items: parsed, taxPaise, discountPaise },
      });
    },
    onSuccess: (res) => {
      keyRef.current = null;
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      toast.success(`Invoice ${res.data.invoice.invoice_number} created.`);
      onCreated(res.data.invoice.id);
    },
    onError: (e) => {
      if (e.status > 0 && e.status < 500 && e.code !== 'IDEMPOTENCY_IN_PROGRESS') keyRef.current = null;
      setError(e);
    },
  });

  const setItem = (id, key, value) => setItems((list) => list.map((i) => (i.id === id ? { ...i, [key]: value } : i)));

  return (
    <Modal open={open} onClose={onClose} title="New invoice" width="max-w-3xl" footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button loading={create.isPending} disabled={!canSubmit} onClick={() => create.mutate()}>Create invoice</Button></>}>
      <div className="space-y-5">
        <PatientPicker value={patient} onChange={(p) => { setPatient(p); setAppointmentId(''); }} />
        {patient && (
          <SelectField label="Link to a visit" hint="Optional. Each visit can have one active invoice." value={appointmentId} onChange={(e) => {
            const id = e.target.value;
            setAppointmentId(id);
            const appt = choices.find((a) => a.id === id);
            if (appt && items.length === 1 && !items[0].description && !items[0].price) setItems([feeItemFor(appt)]);
          }}>
            <option value="">Not linked to a visit</option>
            {choices.map((a) => <option key={a.id} value={a.id}>{fmtDate(a.starts_at)} {fmtTime(a.starts_at)}, {a.doctor_name} ({a.status.replace('_', ' ')})</option>)}
          </SelectField>
        )}

        <fieldset>
          <legend className="mb-2 text-sm font-medium">Items</legend>
          <div className="space-y-2">
            {items.map((it, idx) => (
              <div key={it.id} className="grid grid-cols-[1fr_4.5rem_7rem_auto] items-start gap-2">
                <TextField aria-label={`Item ${idx + 1} description`} placeholder="Description" value={it.description} onChange={(e) => setItem(it.id, 'description', e.target.value)} />
                <TextField aria-label={`Item ${idx + 1} quantity`} inputMode="numeric" value={it.qty} onChange={(e) => setItem(it.id, 'qty', e.target.value)} />
                <TextField aria-label={`Item ${idx + 1} price in rupees`} inputMode="decimal" placeholder="₹ price" inputClassName="num text-right" value={it.price} onChange={(e) => setItem(it.id, 'price', e.target.value)} error={it.price && rupeesToPaise(it.price) === null ? 'Use rupees, up to 2 decimals' : undefined} />
                <Button variant="ghost" size="sm" disabled={items.length === 1} onClick={() => setItems((l) => l.filter((x) => x.id !== it.id))} aria-label={`Remove item ${idx + 1}`}><Trash2 className="h-4 w-4" aria-hidden="true" /></Button>
              </div>
            ))}
          </div>
          <Button size="sm" variant="secondary" className="mt-2" onClick={() => setItems((l) => [...l, BLANK_ITEM()])}><Plus className="h-4 w-4" aria-hidden="true" />Add item</Button>
        </fieldset>

        <div className="grid gap-3 sm:grid-cols-2">
          <TextField label="Tax (₹)" inputMode="decimal" inputClassName="num text-right" value={tax} onChange={(e) => setTax(e.target.value)} error={taxPaise === null ? 'Use rupees, up to 2 decimals' : undefined} />
          <TextField label="Discount (₹)" inputMode="decimal" inputClassName="num text-right" value={discount} onChange={(e) => setDiscount(e.target.value)} error={discountPaise === null ? 'Use rupees, up to 2 decimals' : tooMuch ? 'Discount is more than the bill' : undefined} />
        </div>

        <dl className="ml-auto grid max-w-xs grid-cols-2 gap-y-1 text-sm">
          <dt className="text-ink/65">Subtotal</dt><dd className="num text-right">{rupees(subtotal)}</dd>
          <dt className="text-ink/65">Tax</dt><dd className="num text-right">{rupees(taxPaise || 0)}</dd>
          <dt className="text-ink/65">Discount</dt><dd className="num text-right">−{rupees(discountPaise || 0)}</dd>
          <dt className="border-t pt-2 font-semibold">Total</dt><dd className="num border-t pt-2 text-right text-lg font-semibold">{rupees(Math.max(total, 0))}</dd>
        </dl>
        {error && <ErrorNote error={error} />}
      </div>
    </Modal>
  );
}

/* ---------- Take payment ---------- */
const TEST_CARDS = [
  { number: '4242 4242 4242 4242', note: 'succeeds' },
  { number: '4000 0000 0000 0002', note: 'declined' },
  { number: '4000 0000 0000 9995', note: 'declined, insufficient funds' },
];

function PayModal({ invoice, balance, onClose, onPaid }) {
  const toast = useToast();
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('cash');
  const [card, setCard] = useState('');
  const [error, setError] = useState(null);
  const keyRef = useRef(null);

  useEffect(() => {
    if (invoice) {
      setAmount((balance / 100).toFixed(2));
      setMethod('cash');
      setCard('');
      setError(null);
      keyRef.current = null;
    }
  }, [invoice, balance]);

  const paise = rupeesToPaise(amount);
  const valid = paise !== null && paise > 0 && (method !== 'card' || card.replace(/\s/g, '').length >= 12);

  const pay = useMutation({
    mutationFn: () => {
      if (!keyRef.current) keyRef.current = newIdempotencyKey();
      return api(`/billing/invoices/${invoice.id}/payments`, {
        method: 'POST',
        idempotencyKey: keyRef.current,
        body: { amountPaise: paise, method, ...(method === 'card' && { cardNumber: card }) },
      });
    },
    onSuccess: (res) => {
      keyRef.current = null;
      toast.success(`Payment of ${rupees(paise)} recorded. Invoice is ${res.data.invoiceStatus === 'paid' ? 'paid in full' : 'part paid'}.`);
      onPaid();
    },
    onError: (e) => {
      if (e.status > 0 && e.status < 500 && e.code !== 'IDEMPOTENCY_IN_PROGRESS') keyRef.current = null; // a new attempt is a new payment
      setError(e);
      if (e.code === 'PAYMENT_DECLINED') onPaid(true); // the declined attempt is recorded: refresh the history
    },
  });

  return (
    <Modal open={Boolean(invoice)} onClose={onClose} title="Take payment" footer={<><Button variant="ghost" onClick={onClose}>Close</Button><Button loading={pay.isPending} disabled={!valid} onClick={() => pay.mutate()}><CreditCard className="h-4 w-4" aria-hidden="true" />Take {paise ? rupees(paise) : 'payment'}</Button></>}>
      {invoice && (
        <div className="space-y-4">
          <p className="text-sm">Outstanding on <span className="num font-semibold">{invoice.invoice_number}</span>: <span className="num font-semibold">{rupees(balance)}</span></p>
          <TextField label="Amount (₹)" inputMode="decimal" inputClassName="num" value={amount} onChange={(e) => setAmount(e.target.value)} error={amount && paise === null ? 'Use rupees, up to 2 decimals' : undefined} />
          <SelectField label="Method" value={method} onChange={(e) => setMethod(e.target.value)}>
            <option value="cash">Cash</option><option value="upi">UPI</option><option value="net_banking">Net banking</option><option value="card">Card</option>
          </SelectField>
          {method === 'card' && (
            <div className="space-y-2">
              <TextField label="Card number" inputMode="numeric" autoComplete="off" inputClassName="num" placeholder="4242 4242 4242 4242" value={card} onChange={(e) => setCard(e.target.value)} />
              <div className="rounded-md bg-mint/60 p-3 text-xs text-mint-ink">
                <p className="mb-1 font-semibold">Sandbox only. These are test cards, no real charge is made:</p>
                <ul className="space-y-0.5">{TEST_CARDS.map((c) => <li key={c.number}><button type="button" className="num underline" onClick={() => setCard(c.number)}>{c.number}</button> {c.note}</li>)}</ul>
              </div>
            </div>
          )}
          {error && <ErrorNote error={error} />}
        </div>
      )}
    </Modal>
  );
}

/* ---------- Invoice detail ---------- */
function InvoiceDrawer({ id, onClose, canWrite }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [paying, setPaying] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState('');
  const [cancelError, setCancelError] = useState(null);

  const detail = useQuery({ queryKey: ['invoice', id], queryFn: () => api(`/billing/invoices/${id}`), enabled: Boolean(id) });
  const d = detail.data?.data;
  const refresh = () => { queryClient.invalidateQueries({ queryKey: ['invoice', id] }); queryClient.invalidateQueries({ queryKey: ['invoices'] }); };

  const cancel = useMutation({
    mutationFn: () => api(`/billing/invoices/${id}/cancel`, { method: 'PATCH', body: { reason: reason.trim() } }),
    onSuccess: () => { toast.success('Invoice cancelled.'); setCancelling(false); setReason(''); refresh(); },
    onError: setCancelError,
  });

  const balance = d ? d.reconciliation.balancePaise : 0;
  const live = d && d.invoice.status !== 'cancelled';

  return (
    <>
      <Modal open={Boolean(id)} onClose={onClose} side title={d ? d.invoice.invoice_number : 'Invoice'}>
        {detail.isLoading && <Spinner />}
        {detail.error && <ErrorNote error={detail.error} onRetry={detail.refetch} />}
        {d && (
          <div className="space-y-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-lg font-semibold">{d.invoice.patient_name}</p>
                <p className="num text-xs text-ink/60">{d.invoice.mrn} · created {fmtDateTime(d.invoice.created_at)}</p>
              </div>
              <StatusPill status={d.invoice.status} />
            </div>
            {d.invoice.cancellation_reason && <p className="rounded-md bg-coral/15 px-3 py-2 text-sm">Cancelled: {d.invoice.cancellation_reason}</p>}

            <table className="w-full text-sm">
              <thead><tr><th className="th">Item</th><th className="th text-right">Qty</th><th className="th text-right">Price</th><th className="th text-right">Amount</th></tr></thead>
              <tbody>
                {d.items.map((i) => (
                  <tr key={i.id}><td className="td">{i.description}</td><td className="td num text-right">{i.quantity}</td><td className="td num text-right">{rupees(i.unit_price_paise)}</td><td className="td num text-right">{rupees(i.total_paise)}</td></tr>
                ))}
              </tbody>
            </table>

            <dl className="ml-auto grid max-w-xs grid-cols-2 gap-y-1 text-sm">
              <dt className="text-ink/65">Subtotal</dt><dd className="num text-right">{rupees(d.invoice.subtotal_paise)}</dd>
              <dt className="text-ink/65">Tax</dt><dd className="num text-right">{rupees(d.invoice.tax_paise)}</dd>
              <dt className="text-ink/65">Discount</dt><dd className="num text-right">−{rupees(d.invoice.discount_paise)}</dd>
              <dt className="border-t pt-2 font-semibold">Total</dt><dd className="num border-t pt-2 text-right font-semibold">{rupees(d.invoice.total_paise)}</dd>
              <dt className="text-ink/65">Paid</dt><dd className="num text-right">{rupees(d.reconciliation.paidPaise)}</dd>
              <dt className="font-semibold">Balance</dt><dd className="num text-right text-lg font-semibold">{rupees(Math.max(balance, 0))}</dd>
            </dl>

            <p className={d.reconciliation.consistent ? 'flex items-center gap-2 text-sm text-mint-ink' : 'flex items-center gap-2 text-sm text-coral-ink'}>
              {d.reconciliation.consistent ? <BadgeCheck className="h-4 w-4" aria-hidden="true" /> : <TriangleAlert className="h-4 w-4" aria-hidden="true" />}
              {d.reconciliation.consistent ? 'Items, tax, discount and payments add up to the stored total.' : 'The stored total does not match its items and payments. Report this.'}
            </p>

            <section>
              <h3 className="mb-2 font-sans text-sm font-semibold">Payments</h3>
              {d.payments.length === 0 ? <p className="text-sm text-ink/60">No payments yet.</p> : (
                <ul className="divide-y rounded-md border">
                  {d.payments.map((p) => (
                    <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                      <span><span className="num font-semibold">{rupees(p.amount_paise)}</span> <span className="capitalize">{p.payment_method.replace('_', ' ')}</span>{p.card_last_four && <span className="num"> ····{p.card_last_four}</span>}<span className="block text-xs text-ink/60">{p.payment_number} · {fmtDateTime(p.created_at)}{p.failure_reason ? ` · ${p.failure_reason}` : ''}</span></span>
                      <StatusPill status={p.status} />
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-4 print:hidden">
              <div className="flex flex-wrap gap-2">
                {canWrite && live && balance > 0 && <Button onClick={() => setPaying(true)}><CreditCard className="h-4 w-4" aria-hidden="true" />Take payment</Button>}
                {canWrite && live && d.reconciliation.paidPaise === 0 && <Button variant="ghost" onClick={() => setCancelling(true)}>Cancel invoice</Button>}
              </div>
              <Button variant="secondary" onClick={() => window.print()}><Printer className="h-4 w-4" aria-hidden="true" />Print receipt</Button>
            </div>
          </div>
        )}
      </Modal>
      <PayModal invoice={paying ? d?.invoice : null} balance={balance} onClose={() => setPaying(false)} onPaid={(keepOpen) => { refresh(); if (!keepOpen) setPaying(false); }} />
      <Modal open={cancelling} onClose={() => setCancelling(false)} title="Cancel this invoice?" footer={<><Button variant="ghost" onClick={() => setCancelling(false)}>Keep invoice</Button><Button variant="danger" loading={cancel.isPending} disabled={reason.trim().length < 3} onClick={() => cancel.mutate()}>Cancel invoice</Button></>}>
        <AreaField label="Reason" hint="Recorded in the activity log." value={reason} onChange={(e) => setReason(e.target.value)} />
        {cancelError && <div className="mt-3"><ErrorNote error={cancelError} /></div>}
      </Modal>
    </>
  );
}

/* ---------- Page ---------- */
export default function Billing() {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const canWrite = user.role === 'front_desk';
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const dq = useDebounced(q.trim(), 300);
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState(null);
  const [creating, setCreating] = useState(false);
  const [prefill, setPrefill] = useState(null);
  useEffect(() => setPage(1), [status, dq]);

  // "Invoice" on a completed appointment lands here with that visit pre-filled
  useEffect(() => {
    if (canWrite && location.state?.invoiceFor) {
      setPrefill(location.state.invoiceFor);
      setCreating(true);
      navigate(location.pathname, { replace: true, state: null });
    }
  }, [location, navigate, canWrite]);

  const list = useQuery({
    queryKey: ['invoices', status, dq, page],
    queryFn: () => api('/billing/invoices', { query: { status, q: dq, page, pageSize: 15 } }),
    placeholderData: keepPreviousData,
  });
  const rows = list.data?.data || [];

  return (
    <>
      <PageHeader title="Billing" subtitle={canWrite ? 'Create invoices, take payments and check that every bill adds up.' : 'Read-only view of invoices and payments.'} actions={canWrite && <Button onClick={() => { setPrefill(null); setCreating(true); }}><FilePlus2 className="h-4 w-4" aria-hidden="true" />New invoice</Button>} />
      <Card>
        <div className="grid gap-3 border-b p-3 sm:grid-cols-[12rem_1fr]">
          <SelectField label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option><option value="unpaid">Unpaid</option><option value="partial">Part paid</option><option value="paid">Paid</option><option value="cancelled">Cancelled</option>
          </SelectField>
          <div className="flex items-end"><SearchBox value={q} onChange={setQ} placeholder="Invoice number, patient or MRN" className="w-full" /></div>
        </div>
        {list.error ? <div className="p-4"><ErrorNote error={list.error} onRetry={list.refetch} /></div> : list.isLoading ? <TableSkeleton cols={5} /> : rows.length === 0 ? (
          <Empty illustration={<EmptyBillingArt />} icon={ReceiptText} title="No invoices match" action={canWrite && <Button variant="secondary" onClick={() => setCreating(true)}>Create an invoice</Button>}>Change the filters, or create an invoice for a completed visit.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead><tr><th className="th">Invoice</th><th className="th">Patient</th><th className="th">Created</th><th className="th text-right">Total</th><th className="th">Status</th></tr></thead>
              <tbody>
                {rows.map((i) => (
                  <tr key={i.id} className="cursor-pointer hover:bg-mint/30" onClick={() => setOpenId(i.id)}>
                    <td className="td"><button className="num link font-semibold" onClick={(e) => { e.stopPropagation(); setOpenId(i.id); }}>{i.invoice_number}</button></td>
                    <td className="td"><p className="font-semibold">{i.patient_name}</p><p className="num text-xs text-ink/60">{i.mrn}</p></td>
                    <td className="td text-ink/70">{fmtDateTime(i.created_at)}</td>
                    <td className="td num text-right font-semibold">{rupees(i.total_paise)}</td>
                    <td className="td"><StatusPill status={i.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pager page={page} pageSize={list.data?.pageSize || 15} total={list.data?.total || 0} onPage={setPage} />
      </Card>
      <InvoiceDrawer id={openId} onClose={() => setOpenId(null)} canWrite={canWrite} />
      <NewInvoiceModal open={creating} prefill={prefill} onClose={() => setCreating(false)} onCreated={(id) => { setCreating(false); setOpenId(id); }} />
    </>
  );
}
