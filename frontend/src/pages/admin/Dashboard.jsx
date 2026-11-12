import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BarChart3 } from 'lucide-react';
import { api } from '../../lib/api.js';
import { addDays, fmtDate, istDate, rupees } from '../../lib/format.js';
import { Button, Card, Empty, ErrorNote, PageHeader, Spinner, StatusPill, TextField } from '../../components/ui.jsx';

function Bars({ rows, label, value, format = (v) => v }) {
  const max = Math.max(1, ...rows.map(value));
  return (
    <ul className="space-y-2.5">
      {rows.map((r) => (
        <li key={label(r)} className="grid grid-cols-[8.5rem_1fr_auto] items-center gap-3 text-sm">
          <span className="truncate">{label(r)}</span>
          <span className="h-2.5 rounded-full bg-ink/10" aria-hidden="true"><span className="block h-full rounded-full bg-primary" style={{ width: `${Math.max(3, (value(r) / max) * 100)}%` }} /></span>
          <span className="num text-right">{format(value(r))}</span>
        </li>
      ))}
    </ul>
  );
}

function DailyRevenue({ rows }) {
  const max = Math.max(1, ...rows.map((r) => r.total_paise));
  return (
    <>
      <div className="flex h-40 items-end gap-1.5" role="img" aria-label={`Daily revenue for ${rows.length} days with payments`}>
        {rows.map((r) => (
          <div key={r.day} className="group relative flex-1" title={`${r.day}: ${rupees(r.total_paise)}`}>
            <div className="rounded-t bg-primary transition-opacity group-hover:opacity-75" style={{ height: `${Math.max(4, (r.total_paise / max) * 100)}%` }} />
          </div>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-xs text-ink/55"><span className="num">{rows[0]?.day}</span><span className="num">{rows[rows.length - 1]?.day}</span></div>
      <table className="sr-only"><caption>Revenue by day</caption><tbody>{rows.map((r) => <tr key={r.day}><td>{r.day}</td><td>{rupees(r.total_paise)}</td></tr>)}</tbody></table>
    </>
  );
}

export default function Dashboard() {
  const [to, setTo] = useState(istDate());
  const [from, setFrom] = useState(addDays(istDate(), -29));
  const report = useQuery({ queryKey: ['report', from, to], queryFn: () => api('/reports/summary', { query: { from, to } }) });
  const d = report.data?.data;
  const preset = (days) => { setTo(istDate()); setFrom(addDays(istDate(), -(days - 1))); };

  return (
    <>
      <PageHeader title="Overview" subtitle="Operational and financial figures. Totals only: no patient details or clinical notes appear here." />
      <Card className="mb-6 flex flex-wrap items-end gap-3 p-3">
        <TextField label="From" type="date" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} />
        <TextField label="To" type="date" value={to} min={from} max={istDate()} onChange={(e) => e.target.value && setTo(e.target.value)} />
        <div className="flex gap-1.5 pb-0.5">{[7, 30, 90].map((n) => <Button key={n} size="sm" variant="secondary" onClick={() => preset(n)}>Last {n} days</Button>)}</div>
      </Card>

      {report.isLoading && <Spinner label="Calculating" />}
      {report.error && <ErrorNote error={report.error} onRetry={report.refetch} />}
      {d && (
        <div className="space-y-8">
          <p className="max-w-3xl font-display text-3xl leading-snug">
            <span className="num">{rupees(d.revenuePaise)}</span> collected from {fmtDate(`${d.range.from}T12:00:00+05:30`)} to {fmtDate(`${d.range.to}T12:00:00+05:30`)}, across <span className="num">{d.totalAppointments}</span> appointments.{' '}
            <span className="text-ink/60">{d.outstandingPaise > 0 ? <><span className="num">{rupees(d.outstandingPaise)}</span> is still outstanding.</> : 'Nothing is outstanding.'}</span>
          </p>

          {d.totalAppointments === 0 && d.revenuePaise === 0 ? (
            <Card><Empty icon={BarChart3} title="No activity in this period">Choose a longer range.</Empty></Card>
          ) : (
            <div className="grid gap-6 lg:grid-cols-2">
              <Card className="p-5">
                <h2 className="mb-4 text-xl font-semibold">Appointments by status</h2>
                <ul className="space-y-2.5">
                  {d.appointmentsByStatus.map((r) => (
                    <li key={r.status} className="flex items-center justify-between gap-3 text-sm"><StatusPill status={r.status} /><span className="num">{r.count}</span></li>
                  ))}
                </ul>
              </Card>
              <Card className="p-5">
                <h2 className="mb-4 text-xl font-semibold">Revenue by day</h2>
                {d.dailyRevenue.length ? <DailyRevenue rows={d.dailyRevenue} /> : <p className="text-sm text-ink/60">No payments in this period.</p>}
              </Card>
              <Card className="p-5">
                <h2 className="mb-4 text-xl font-semibold">Collected by method</h2>
                {d.revenueByMethod.length ? <Bars rows={d.revenueByMethod} label={(r) => r.payment_method.replace('_', ' ')} value={(r) => r.total_paise} format={rupees} /> : <p className="text-sm text-ink/60">No payments in this period.</p>}
                {d.declinedPayments > 0 && <p className="mt-4 text-sm text-ink/65"><span className="num font-semibold">{d.declinedPayments}</span> card {d.declinedPayments === 1 ? 'payment was' : 'payments were'} declined.</p>}
              </Card>
              <Card className="p-5">
                <h2 className="mb-4 text-xl font-semibold">Invoices created</h2>
                <table className="w-full text-sm">
                  <thead><tr><th className="th">Status</th><th className="th text-right">Count</th><th className="th text-right">Value</th></tr></thead>
                  <tbody>{d.invoicesByStatus.map((r) => <tr key={r.status}><td className="td"><StatusPill status={r.status} /></td><td className="td num text-right">{r.count}</td><td className="td num text-right">{rupees(r.total_paise)}</td></tr>)}</tbody>
                </table>
                <p className="mt-3 text-sm text-ink/65">Billed in this period, excluding cancelled: <span className="num font-semibold">{rupees(d.billedPaise)}</span></p>
              </Card>
              <Card className="p-5 lg:col-span-2">
                <h2 className="mb-4 text-xl font-semibold">Most completed visits</h2>
                {d.topDoctors.length ? <Bars rows={d.topDoctors} label={(r) => r.doctor_name} value={(r) => r.completed} /> : <p className="text-sm text-ink/60">No completed visits in this period.</p>}
              </Card>
            </div>
          )}
        </div>
      )}
    </>
  );
}
