import type { BuyEvent } from '../hooks/useBuyer';
import { eventColor, eventLabel, fmtTime } from '../utils/format';

export function EventLog({ events, elapsed }: { events: BuyEvent[]; elapsed: number | null }) {
  return (
    <div style={{ background:'var(--card)', border:'1px solid var(--border)', borderRadius:16, overflow:'hidden', fontFamily:'var(--mono)', fontSize:12, height:'100%', display:'flex', flexDirection:'column' }}>
      <div style={{ padding:'10px 16px', borderBottom:'1px solid var(--border)', fontSize:11, fontFamily:'var(--sans)', fontWeight:600, color:'var(--text-muted)', letterSpacing:'0.08em', textTransform:'uppercase', display:'flex', alignItems:'center', gap:8 }}>
        <span style={{ width:8, height:8, borderRadius:'50%', background: events.length > 0 ? 'var(--success)' : 'var(--text-muted)', display:'inline-block', boxShadow: events.length > 0 ? '0 0 6px var(--success)' : 'none', transition:'all 0.3s' }} />
        Event Log
        {elapsed !== null && <span style={{ marginLeft:'auto', fontFamily:'var(--mono)', fontSize:11, color:'var(--success)', fontWeight:700 }}>{fmtTime(elapsed)}</span>}
      </div>
      <div style={{ flex:1, overflowY:'auto', padding:'12px 0' }}>
        {events.length === 0
          ? <div style={{ padding:'24px 16px', color:'var(--text-muted)', fontFamily:'var(--sans)', textAlign:'center', fontSize:13 }}>Waiting for purchase…</div>
          : events.map((e, i) => (
            <div key={i} style={{ padding:'6px 16px', display:'flex', gap:10, alignItems:'flex-start', animation:'fadeIn 0.3s ease', borderLeft:`2px solid ${eventColor(e.type)}`, marginLeft:12, marginBottom:4 }}>
              <span style={{ color:'var(--text-muted)', flexShrink:0, fontSize:10, marginTop:1 }}>{String(i + 1).padStart(2, '0')}</span>
              <span style={{ color: eventColor(e.type), lineHeight:1.5 }}>{eventLabel(e)}</span>
            </div>
          ))
        }
      </div>
    </div>
  );
}
