import type { Purchase } from '../hooks/useBuyer';

const CHART_COLORS = ['var(--primary)', 'var(--secondary)', 'var(--warning)', 'var(--success)'];

function parsePrice(s: string) { return parseFloat(s.replace('$', '')) || 0; }

export function SpendingChart({ purchases, prices }: { purchases: Purchase[]; prices: Record<string, string> }) {
  if (purchases.length === 0) return null;

  const endpoints = [...new Set(purchases.map(p => p.endpoint))];
  const stats = endpoints.map((ep, i) => {
    const count = purchases.filter(p => p.endpoint === ep).length;
    const spend = count * parsePrice(prices[ep] ?? '$0');
    return { ep, count, spend, color: CHART_COLORS[i % CHART_COLORS.length] };
  });
  const total = stats.reduce((s, e) => s + e.spend, 0);
  if (total === 0) return null;

  const r = 38, cx = 56, cy = 56, circ = 2 * Math.PI * r;
  let cumOffset = 0;
  const arcs = stats.map(s => {
    const arc = (s.spend / total) * circ;
    const dashOffset = -cumOffset;
    cumOffset += arc;
    return { ...s, arc, dashOffset };
  });

  return (
    <div style={{ display:'flex', alignItems:'center', gap:28, padding:'20px 0', borderBottom:'1px solid var(--border)', marginBottom:20 }}>
      <svg width={112} height={112} viewBox="0 0 112 112" style={{ flexShrink:0 }}>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--border)" strokeWidth={14} />
        {arcs.map(({ ep, arc, dashOffset, color }) => arc > 0 ? (
          <circle key={ep} cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth={14}
            strokeDasharray={`${arc} ${circ}`} strokeDashoffset={dashOffset}
            transform={`rotate(-90 ${cx} ${cy})`} strokeLinecap="round" />
        ) : null)}
        <text x={cx} y={cy - 7} textAnchor="middle" fill="var(--text)" fontSize={13} fontWeight={700} fontFamily="var(--mono)">${total.toFixed(3)}</text>
        <text x={cx} y={cy + 9} textAnchor="middle" fill="var(--text-muted)" fontSize={10} fontFamily="var(--sans)">USDC spent</text>
      </svg>
      <div style={{ display:'flex', flexDirection:'column', gap:14, flex:1 }}>
        <div style={{ display:'flex', gap:20, flexWrap:'wrap' }}>
          <div>
            <div style={{ fontSize:18, fontWeight:700, fontFamily:'var(--mono)', color:'var(--text)' }}>{purchases.length}</div>
            <div style={{ fontSize:11, color:'var(--text-muted)' }}>API call{purchases.length !== 1 ? 's' : ''}</div>
          </div>
          <div>
            <div style={{ fontSize:18, fontWeight:700, fontFamily:'var(--mono)', color:'var(--success)' }}>${total.toFixed(3)}</div>
            <div style={{ fontSize:11, color:'var(--text-muted)' }}>total USDC</div>
          </div>
          <div>
            <div style={{ fontSize:18, fontWeight:700, fontFamily:'var(--mono)', color:'var(--text-dim)' }}>${(total / purchases.length).toFixed(3)}</div>
            <div style={{ fontSize:11, color:'var(--text-muted)' }}>avg per call</div>
          </div>
        </div>
        <div style={{ display:'flex', gap:16, flexWrap:'wrap' }}>
          {stats.map(({ ep, count, spend, color }) => count > 0 ? (
            <div key={ep} style={{ display:'flex', alignItems:'center', gap:7 }}>
              <span style={{ width:8, height:8, borderRadius:2, background:color, display:'inline-block', flexShrink:0 }} />
              <span style={{ fontSize:12, color:'var(--text-muted)' }}>{ep} — {count} call{count !== 1 ? 's' : ''} · ${spend.toFixed(3)}</span>
            </div>
          ) : null)}
        </div>
      </div>
    </div>
  );
}
