import type { BuyEvent, Endpoint } from '../hooks/useBuyer';
import { CONDITION_ICON } from '../constants';
import type { StepId, StepColor } from '../constants';

export function formatKey(k: string) {
  return k.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase());
}

export function formatVal(v: unknown): string {
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  return String(v);
}

export function visiblePages(current: number, total: number): (number | '…')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i);
  const out: (number | '…')[] = [];
  for (let i = 0; i < total; i++) {
    if (i === 0 || i === total - 1 || Math.abs(i - current) <= 1) {
      out.push(i);
    } else if (out[out.length - 1] !== '…') {
      out.push('…');
    }
  }
  return out;
}

export function firstResult(data: Record<string, unknown> | undefined): string {
  if (!data) return '—';
  const skip = new Set(['paidVia', 'timestamp']);
  for (const [k, v] of Object.entries(data)) {
    if (skip.has(k)) continue;
    if (Array.isArray(v)) continue;
    if (typeof v === 'object') continue;
    if (v !== undefined && v !== null && String(v).trim()) return String(v);
  }
  return '—';
}

export function stepColor(c: StepColor) {
  return c === 'warning' ? 'var(--warning)' : c === 'secondary' ? 'var(--secondary)' : c === 'success' ? 'var(--success)' : 'var(--primary)';
}
export function stepDim(c: StepColor) {
  return c === 'warning' ? 'var(--warning-dim)' : c === 'secondary' ? 'var(--secondary-dim)' : c === 'success' ? 'var(--success-dim)' : 'var(--primary-dim)';
}
export function eventColor(type: string) {
  if (type === 'payment_required' || type === 'error') return 'var(--warning)';
  if (type === 'payment_signing'  || type === 'payment_sent') return 'var(--secondary)';
  if (type === 'settlement_confirmed' || type === 'success') return 'var(--success)';
  return 'var(--primary)';
}

export function eventLabel(e: BuyEvent) {
  const ep = e.endpoint ?? 'weather';
  switch (e.type) {
    case 'request_sent':         return `GET /${ep} → seller (no payment)`;
    case 'payment_required':     return `402 received — ${Number(e.amount ?? 0) / 1e6} USDC required`;
    case 'payment_signing':      return 'Signing Algorand USDC transaction…';
    case 'payment_sent':         return 'Retrying with payment proof in header';
    case 'settlement_confirmed': {
      const lat = e.latencyMs ? ` · ${e.latencyMs}ms` : '';
      return e.txid ? `Settled — tx: ${e.txid.slice(0, 12)}…${lat}` : `Facilitator confirmed on-chain${lat}`;
    }
    case 'success': {
      const d = e.data;
      if (!d) return 'Data delivered';
      const city = typeof d['city'] === 'string' ? d['city'] : '';
      if (Array.isArray(d['days'])) return `Delivered — ${city}, ${(d['days'] as unknown[]).length} days`;
      const temp = typeof d['temperature'] === 'number' ? `, ${d['temperature']}°F` : '';
      return `Delivered — ${city}${temp}`;
    }
    case 'error': return `Error: ${e.message}`;
  }
}

export function stepIcon(id: StepId) {
  const m: Record<StepId, string> = {
    request_sent: '📡', payment_required: '🔴', payment_signing: '✍️',
    payment_sent: '💸', settlement_confirmed: '⛓️', success: '✅',
  };
  return m[id];
}

export function endpointIcon(ep: Endpoint) {
  if (ep === 'forecast') return '📅';
  if (ep === 'weather')  return '🌡️';
  return '📡';
}

export function condIcon(c: string) { return CONDITION_ICON[c] ?? '🌤️'; }

export function fmtTime(ms: number) {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}
