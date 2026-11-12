import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { api } from '../lib/api.js';
import { ageFromDob } from '../lib/format.js';
import { Initials, SearchBox, Spinner, useDebounced } from './ui.jsx';

// Search-as-you-type patient chooser. Shows the chosen patient as a chip with a way to change it.
export default function PatientPicker({ value, onChange, error }) {
  const [q, setQ] = useState('');
  const dq = useDebounced(q.trim(), 300);
  const results = useQuery({
    queryKey: ['patient-search', dq],
    queryFn: () => api('/patients', { query: { q: dq, pageSize: 6 } }),
    enabled: !value && dq.length >= 2,
  });

  if (value) {
    return (
      <div>
        <span className="mb-1 block text-sm font-medium">Patient</span>
        <div className="flex items-center gap-3 rounded-md border bg-mint/50 px-3 py-2">
          <Initials name={value.full_name} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{value.full_name}</p>
            <p className="num text-xs text-ink/60">{value.mrn}</p>
          </div>
          <button type="button" onClick={() => onChange(null)} className="rounded p-1 text-ink/60 hover:bg-ink/10" aria-label="Choose a different patient">
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        {error && <p className="mt-1 text-xs text-coral-ink">{error}</p>}
      </div>
    );
  }

  return (
    <div>
      <span className="mb-1 block text-sm font-medium">Patient</span>
      <SearchBox value={q} onChange={setQ} placeholder="Search by name, MRN or phone" />
      {error && <p className="mt-1 text-xs text-coral-ink">{error}</p>}
      {dq.length >= 2 && (
        <div className="mt-2 rounded-md border bg-surface">
          {results.isLoading && <Spinner label="Searching" />}
          {results.data?.data?.length === 0 && <p className="px-3 py-3 text-sm text-ink/60">No patient matches “{dq}”.</p>}
          <ul className="divide-y">
            {results.data?.data?.map((p) => (
              <li key={p.id}>
                <button type="button" onClick={() => onChange(p)} className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-mint/60">
                  <Initials name={p.full_name} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{p.full_name}</span>
                    <span className="num block text-xs text-ink/60">
                      {p.mrn} · {ageFromDob(p.date_of_birth)} yrs · {p.phone}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
