import { useMemo, useState } from 'react';
import { CONFIG, circuitCfg } from '../sim/config';
import { runQualifying } from '../sim/quali';
import { fmtLap } from '../sim/race';
import { Rng } from '../sim/rng';
import { describe, evaluate, pitCost, suggestedPlans, type OptimizerCtx } from '../sim/strategy';
import { driverById, driversOfTeam, teamById } from '../sim/teams';
import { bestCompoundFor } from '../sim/tyres';
import { ALL_COMPOUNDS, DRY_COMPOUNDS, type Compound, type RaceSetup, type Strategy } from '../sim/types';
import { Weather } from '../sim/weather';
import type { EventCtx } from './App';
import { TeamDot, TrackThumb, TyreBadge } from './common';

type Mode = 'one' | 'two' | 'custom' | 'none';
interface CarPlan {
  mode: Mode;
  start: Compound;
  custom: { compound: Compound; laps: number }[];
}

const levelLabel = (v: number, lo: number, hi: number, labels: [string, string, string]) => (v <= lo ? labels[0] : v >= hi ? labels[2] : labels[1]);

export function PreRace({ ev, onBack, onStart }: { ev: EventCtx; onBack: () => void; onStart: (s: RaceSetup) => void }) {
  const c = circuitCfg(ev.circuitId);
  const weather = useMemo(() => new Weather(c, ev.laps, ev.weather, ev.tempOffset, ev.rainMult, new Rng(ev.seed)), [ev]);
  const quali = useMemo(() => runQualifying(ev.circuitId, new Rng(ev.seed ^ 0x5bd1)), [ev]);
  const ctx: OptimizerCtx = { circuit: c, laps: ev.laps, trackTemp: weather.trackTemp };
  const wetStart = weather.wetness > 0.2;
  const drivers = driversOfTeam(ev.teamId);
  const team = teamById(ev.teamId);

  const initial = (i: number): CarPlan => {
    if (wetStart) return { mode: 'none', start: bestCompoundFor(weather.wetness), custom: [] };
    const sug = suggestedPlans(ctx);
    const base = i === 0 ? sug.oneStop : sug.twoStop;
    return { mode: i === 0 ? 'one' : 'two', start: base.strategy.startCompound, custom: toCustom(base.strategy, ev.laps) };
  };
  const [plans, setPlans] = useState<CarPlan[]>(() => drivers.map((_, i) => initial(i)));

  const suggestions = useMemo(() => {
    const m = new Map<Compound, ReturnType<typeof suggestedPlans>>();
    for (const cc of DRY_COMPOUNDS) m.set(cc, suggestedPlans(ctx, cc));
    return m;
  }, [ev]);
  const bestTime = Math.min(...[...suggestions.values()].map((s) => Math.min(s.oneStop.time, s.twoStop.time)));

  const strategyOf = (p: CarPlan): Strategy => {
    if (p.mode === 'none' || !DRY_COMPOUNDS.includes(p.start) && p.mode !== 'custom') return { startCompound: p.start, stops: [] };
    if (p.mode === 'custom') return fromCustom(p.custom, ev.laps);
    const s = suggestions.get(p.start)!;
    return (p.mode === 'one' ? s.oneStop : s.twoStop).strategy;
  };

  const update = (i: number, p: Partial<CarPlan>) => setPlans((ps) => ps.map((x, j) => (j === i ? { ...x, ...p } : x)));

  const start = () => {
    const playerStrategies: Record<string, Strategy> = {};
    drivers.forEach((d, i) => (playerStrategies[d.id] = strategyOf(plans[i])));
    onStart({
      circuitId: ev.circuitId, roundName: ev.roundName, laps: ev.laps, difficulty: ev.difficulty, weather: ev.weather,
      playerTeamId: ev.teamId, tempOffset: ev.tempOffset, rainChanceMult: ev.rainMult, seed: ev.seed,
      playerStrategies, grid: quali.map((q) => q.driverId),
    });
  };

  return (
    <div className="prerace">
      <header className="screen-head">
        <button className="btn ghost" onClick={onBack}>← Back</button>
        <div>
          <div className="eyebrow">{ev.mode === 'season' ? 'Championship' : 'Quick race'} · {CONFIG.difficulty[ev.difficulty].label}</div>
          <h1>{ev.roundName}</h1>
        </div>
        <button className="btn primary" onClick={start}>Start race →</button>
      </header>

      <div className="prerace-grid">
        <section className="card">
          <div className="row gap">
            <TrackThumb id={c.id} w={200} h={124} />
            <div>
              <h2>{c.name}</h2>
              <div className="muted">{c.country} · {c.character}</div>
              <div className="facts">
                <div><b>{ev.laps}</b> laps</div>
                <div><b>{c.lengthKm.toFixed(2)}</b> km</div>
                <div><b>{pitCost(c).toFixed(0)}s</b> pit loss</div>
              </div>
            </div>
          </div>
          <div className="facts-list">
            <div>Overtaking <b>{levelLabel(c.overtakeThreshold, 0.4, 0.9, ['Easy', 'Medium', 'Very hard'])}</b></div>
            <div>Tyre wear <b>{levelLabel(c.wearMult, 0.85, 1.1, ['Low', 'Medium', 'High'])}</b></div>
            <div>Safety Car risk <b>{levelLabel(c.incidentPerLap, 0.009, 0.016, ['Low', 'Medium', 'High'])}</b></div>
            <div>Track temp <b>{weather.trackTemp.toFixed(0)}°C</b></div>
            <div>Conditions <b>{wetStart ? 'Wet' : 'Dry'}</b></div>
            <div>Rain risk (race) <b>{ev.weather === 'dry' ? '0%' : `${weather.raceRainRisk(ev.difficulty)}%`}</b></div>
          </div>

          <h3>Qualifying</h3>
          <div className="grid-list">
            {quali.map((q, i) => {
              const d = driverById(q.driverId);
              const t = teamById(d.teamId);
              return (
                <div key={q.driverId} className={`grid-row ${t.id === ev.teamId ? 'mine' : ''}`}>
                  <span className="pos">{i + 1}</span>
                  <TeamDot color={t.color} />
                  <span className="num">{d.number}</span>
                  <span className="code">{d.code}</span>
                  <span className="muted small">{fmtLap(q.time)}</span>
                </div>
              );
            })}
          </div>
        </section>

        <section className="card">
          <h2><TeamDot color={team.color} /> {team.name} — strategy</h2>
          {wetStart && <p className="note warn">Wet start: begin on wet-weather tyres and call the switch to slicks live as the track dries.</p>}
          {!wetStart && <p className="help">Plans are estimates without traffic. Splitting strategies between your two cars hedges against Safety Cars and weather. Planned stops are executed automatically — you can override them during the race.</p>}
          {drivers.map((d, i) => {
            const p = plans[i];
            const s = strategyOf(p);
            const est = DRY_COMPOUNDS.includes(s.startCompound) ? evaluate(ctx, s) : NaN;
            const sug = suggestions.get(p.start);
            const gridPos = quali.findIndex((q) => q.driverId === d.id) + 1;
            return (
              <div key={d.id} className="plan-card">
                <div className="plan-head">
                  <span className="num-badge" style={{ background: team.color }}>{d.number}</span>
                  <b>{d.name}</b>
                  <span className="muted">P{gridPos} on the grid</span>
                </div>
                <div className="row gap wrap">
                  <span className="label">Start tyre</span>
                  {ALL_COMPOUNDS.map((cc) => (
                    <button key={cc} className={`tyre-btn ${p.start === cc ? 'on' : ''}`} onClick={() => update(i, { start: cc, mode: DRY_COMPOUNDS.includes(cc) ? (p.mode === 'none' ? 'one' : p.mode) : 'none', custom: p.custom.map((x, k) => (k === 0 ? { ...x, compound: cc } : x)) })}>
                      <TyreBadge c={cc} />
                    </button>
                  ))}
                </div>
                <div className="seg small">
                  {DRY_COMPOUNDS.includes(p.start) && (
                    <>
                      <button className={p.mode === 'one' ? 'on' : ''} onClick={() => update(i, { mode: 'one' })}>1-stop</button>
                      <button className={p.mode === 'two' ? 'on' : ''} onClick={() => update(i, { mode: 'two' })}>2-stop</button>
                    </>
                  )}
                  <button className={p.mode === 'custom' ? 'on' : ''} onClick={() => update(i, { mode: 'custom', custom: p.mode === 'custom' ? p.custom : toCustom(s, ev.laps) })}>Custom</button>
                  <button className={p.mode === 'none' ? 'on' : ''} onClick={() => update(i, { mode: 'none' })}>No plan</button>
                </div>

                {p.mode === 'custom' ? (
                  <CustomEditor laps={ev.laps} stints={p.custom} onChange={(custom) => update(i, { custom, start: custom[0]?.compound ?? p.start })} />
                ) : (
                  <div className="plan-line">
                    <PlanStrip s={s} laps={ev.laps} />
                  </div>
                )}
                <div className="plan-foot">
                  <span className="muted">{p.mode === 'none' ? 'No planned stops — you call every stop.' : describe(s)}</span>
                  {isFinite(est) && <span className={est - bestTime < 1 ? 'good' : est - bestTime < 6 ? 'muted' : 'bad'}>{est - bestTime < 0.05 ? 'Optimal' : `+${(est - bestTime).toFixed(1)}s vs best`}</span>}
                </div>
                {sug && p.mode !== 'custom' && p.mode !== 'none' && (
                  <div className="muted small">Best 1-stop: {describe(sug.oneStop.strategy)} · best 2-stop: {describe(sug.twoStop.strategy)}</div>
                )}
              </div>
            );
          })}
          <button className="btn primary wide" onClick={start}>Lights out →</button>
        </section>
      </div>
    </div>
  );
}

function PlanStrip({ s, laps }: { s: Strategy; laps: number }) {
  const segs: { c: Compound; from: number; to: number }[] = [];
  let cur = s.startCompound, from = 0;
  for (const st of s.stops) { segs.push({ c: cur, from, to: st.lap }); cur = st.compound; from = st.lap; }
  segs.push({ c: cur, from, to: laps });
  return (
    <div className="strip">
      {segs.map((g, i) => (
        <div key={i} className="strip-seg" style={{ flex: g.to - g.from, background: CONFIG.tyres.compounds[g.c].color }}>
          <span>{g.c} · {g.to - g.from}</span>
        </div>
      ))}
    </div>
  );
}

function CustomEditor({ laps, stints, onChange }: { laps: number; stints: { compound: Compound; laps: number }[]; onChange: (s: { compound: Compound; laps: number }[]) => void }) {
  const fixed = stints.slice(0, -1);
  const used = fixed.reduce((a, b) => a + b.laps, 0);
  const last = laps - used;
  const set = (i: number, p: Partial<{ compound: Compound; laps: number }>) => onChange(stints.map((s, j) => (j === i ? { ...s, ...p } : s)));
  return (
    <div className="custom">
      {stints.map((s, i) => (
        <div key={i} className="custom-row">
          <span className="label">Stint {i + 1}</span>
          <div className="row">
            {ALL_COMPOUNDS.map((cc) => (
              <button key={cc} className={`tyre-btn ${s.compound === cc ? 'on' : ''}`} onClick={() => set(i, { compound: cc })}><TyreBadge c={cc} size={18} /></button>
            ))}
          </div>
          {i < stints.length - 1 ? (
            <input type="number" min={1} max={laps - 1} value={s.laps} onChange={(e) => set(i, { laps: Math.max(1, Math.min(laps - 1, Number(e.target.value) || 1)) })} />
          ) : (
            <span className={last < 1 ? 'bad' : 'muted'}>{last} laps</span>
          )}
          {stints.length > 1 && <button className="btn ghost tiny" onClick={() => onChange(stints.filter((_, j) => j !== i))}>✕</button>}
        </div>
      ))}
      {stints.length < 4 && (
        <button className="btn ghost tiny" onClick={() => {
          const n = [...stints];
          const lastS = n[n.length - 1];
          const half = Math.max(1, Math.floor(last / 2));
          n[n.length - 1] = { ...lastS, laps: half };
          n.push({ compound: 'M', laps: 0 });
          onChange(n);
        }}>+ Add stop</button>
      )}
    </div>
  );
}

function toCustom(s: Strategy, laps: number) {
  const out: { compound: Compound; laps: number }[] = [];
  let cur = s.startCompound, from = 0;
  for (const st of s.stops) { out.push({ compound: cur, laps: st.lap - from }); cur = st.compound; from = st.lap; }
  out.push({ compound: cur, laps: laps - from });
  return out;
}

function fromCustom(c: { compound: Compound; laps: number }[], laps: number): Strategy {
  const stops = [];
  let acc = 0;
  for (let i = 1; i < c.length; i++) {
    acc += c[i - 1].laps;
    if (acc >= laps) break;
    stops.push({ lap: acc, compound: c[i].compound });
  }
  return { startCompound: c[0]?.compound ?? 'M', stops };
}
