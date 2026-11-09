// Money is always integer paise. BIGINT columns come back from pg as strings, so convert safely.
export function toPaise(value) {
  const n = Number(value);
  if (!Number.isSafeInteger(n)) {
    throw new Error(`Unsafe or non-integer paise value: ${value}`);
  }
  return n;
}

export function derivePaymentStatus(totalPaise, paidPaise) {
  if (paidPaise <= 0) return 'unpaid';
  if (paidPaise < totalPaise) return 'partial';
  return 'paid';
}
