import { STEPS } from '../constants';
import { stepColor, stepDim, stepIcon } from '../utils/format';
import type { StepId } from '../constants';

function FlowStep({ step, active, done }: { step: typeof STEPS[number]; active: boolean; done: boolean }) {
  const c = stepColor(step.color);
  const d = stepDim(step.color);
  const lit = active || done;
  return (
    <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:6, flex:1, minWidth:0 }}>
      <div style={{ width:44, height:44, borderRadius:12, border:`2px solid ${lit ? c : 'var(--border)'}`, background: lit ? d : 'var(--card)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:18, boxShadow: lit ? `0 0 10px ${c}66` : 'none', transition:'all 0.35s ease', animation: active ? 'pulse 1s ease-in-out infinite' : done ? 'stepDone 0.4s ease' : 'none' }}>
        {done && !active ? '✓' : stepIcon(step.id)}
      </div>
      <div style={{ textAlign:'center', color: lit ? c : 'var(--text-muted)', transition:'color 0.35s ease' }}>
        <div style={{ fontSize:12, fontWeight:600 }}>{step.label}</div>
        <div style={{ fontSize:10, opacity:0.7 }}>{step.desc}</div>
      </div>
    </div>
  );
}

function Connector({ active, done }: { active: boolean; done: boolean }) {
  return (
    <div style={{ flex:0, width:24, height:2, marginTop:-22, alignSelf:'center', background: done ? 'var(--success)' : active ? 'linear-gradient(90deg, var(--primary), var(--secondary), var(--primary))' : 'var(--border)', backgroundSize: active ? '200% 100%' : undefined, animation: active ? 'flowRight 1.2s linear infinite' : 'none', boxShadow: done ? '0 0 6px var(--success)55' : active ? '0 0 6px var(--primary-glow)' : 'none', transition:'background 0.4s ease, box-shadow 0.4s ease', borderRadius:1 }} />
  );
}

export function ProtocolFlow({ activeStep, doneSteps, elapsed, loading }: {
  activeStep: StepId | null;
  doneSteps: Set<StepId>;
  elapsed: number | null;
  loading: boolean;
}) {
  const fmtTime = (ms: number) => ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
  return (
    <section className="content-section" style={{ maxWidth:900, margin:'0 auto', width:'100%', padding:'0 40px 48px', boxSizing:'border-box' }}>
      <div style={{ background:'var(--card)', border:'1px solid var(--border)', borderRadius:20, padding:'28px 32px' }}>
        <div style={{ fontSize:11, fontWeight:600, letterSpacing:'0.1em', textTransform:'uppercase', color:'var(--text-muted)', marginBottom:24, display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          <span>Protocol Flow</span>
          {elapsed !== null && !loading && (
            <span style={{ fontFamily:'var(--mono)', color:'var(--success)', fontSize:12 }}>completed in {fmtTime(elapsed)}</span>
          )}
        </div>
        <div className="flow-steps" style={{ display:'flex', alignItems:'flex-start', overflowX:'auto', paddingBottom:4 }}>
          {STEPS.map((step, i) => (
            <div key={step.id} style={{ display:'flex', alignItems:'flex-start', flex:1, minWidth:0 }}>
              <FlowStep step={step} active={activeStep === step.id} done={doneSteps.has(step.id)} />
              {i < STEPS.length - 1 && <Connector active={activeStep === step.id} done={doneSteps.has(step.id)} />}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
