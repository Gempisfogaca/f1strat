import { useEffect, useMemo, useRef, useState } from 'react';
import { Renderer } from '../render/renderer';
import { CONFIG } from '../sim/config';
import { RaceEngine, fmtLap, type Car } from '../sim/race';
import { ALL_COMPOUNDS, type PaceMode, type RaceResult, type RaceSetup, type RadioMsg } from '../sim/types';
import { WearBar, TyreBadge, fmtGap } from './common';

interface Props {
  setup: RaceSetup;
  onQuit: () => void;
  onFinished: (r: RaceResult) => void;
}

export function RaceScreen({ setup, onQuit, onFinished }: Props) {
  const engine = useMemo(() => new RaceEngine(setup), [setup]);
  if (import.meta.env.DEV) (window as unknown as { __engine: RaceEngine }).__engine = engine;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [speed, setSpeed] = useState(0);
  const speedRef = useRef(0);
  const [follow, setFollow] = useState(false);
  const mine = engine.cars.filter((c) => c.isPlayer);
  const [selected, setSelected] = useState<string>(mine[0].id);
  const [autoPause, setAutoPause] = useState(true);
  const autoPauseRef = useRef(true);
  const [, setTick] = useState(0);
  const selRef = useRef(selected);
  const followRef = useRef(follow);
  selRef.current = selected;
  followRef.current = follow;
  speedRef.current = speed;
  autoPauseRef.current = autoPause;

  // Simulation + render loop. Fixed-step sim, decoupled from the display refresh.
  useEffect(() => {
    const canvas = canvasRef.current!;
    const renderer = new Renderer(canvas, engine.track);
    let raf = 0;
    let last = performance.now();
    let acc = 0;
    let lastMsg = engine.radio.at(-1)?.id ?? 0;
    const STEP = 1 / CONFIG.sim.HZ;
    const loop = (now: number) => {
      const realDt = Math.min(0.1, (now - last) / 1000);
      last = now;
      acc += realDt * speedRef.current * CONFIG.sim.BASE_TIME_SCALE;
      let steps = 0;
      while (acc >= STEP && steps < CONFIG.sim.MAX_STEPS_PER_FRAME) {
        engine.step(STEP);
        acc -= STEP;
        steps++;
      }
      if (steps >= CONFIG.sim.MAX_STEPS_PER_FRAME) acc = 0;
      // Auto-pause on alerts (Safety Car, rain, retirements).
      const newest = engine.radio.at(-1);
      if (newest && newest.id !== lastMsg) {
        const fresh = engine.radio.filter((m) => m.id > lastMsg);
        lastMsg = newest.id;
        if (autoPauseRef.current && fresh.some((m) => m.level === 'alert') && speedRef.current > 0) {
          speedRef.current = 0;
          setSpeed(0);
        }
      }
      try {
        renderer.draw(engine, { followId: followRef.current ? selRef.current : null, selectedId: selRef.current, dt: realDt });
      } catch (err) {
        console.error(err);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    const ui = setInterval(() => setTick((t) => t + 1), CONFIG.sim.UI_REFRESH_MS);
    return () => { cancelAnimationFrame(raf); clearInterval(ui); };
  }, [engine]);

  // Canvas sizing.
  useEffect(() => {
    const el = wrapRef.current!;
    const cv = canvasRef.current!;
    const ro = new ResizeObserver(() => {
      const dpr = window.devicePixelRatio || 1;
      cv.width = Math.max(1, el.clientWidth * dpr);
      cv.height = Math.max(1, el.clientHeight * dpr);
      cv.style.width = el.clientWidth + 'px';
      cv.style.height = el.clientHeight + 'px';
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Keyboard shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'INPUT') return;
      if (e.code === 'Space') { e.preventDefault(); setSpeed((s) => (s === 0 ? 1 : 0)); }
      const n = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5'].indexOf(e.code);
      if (n >= 0) setSpeed(CONFIG.sim.SPEEDS[n]);
      if (e.code === 'KeyF') setFollow((f) => !f);
      if (e.code === 'KeyB') {
        const car = engine.cars.find((c) => c.id === selRef.current);
        if (car?.isPlayer) engine.setBox(car.id, car.boxRequest ? null : car.plan[0]?.compound ?? 'M');
      }
      if (e.code === 'Tab') {
        e.preventDefault();
        setSelected((s) => (s === mine[0].id ? mine[1].id : mine[0].id));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [engine]);

  const leaderLap = Math.min(engine.laps, Math.max(1, Math.floor(engine.leaderLap) + 1));
  const wx = engine.weather;
  const forecast = wx.forecast(engine.leaderLap, setup.difficulty);
  const headline = wx.headline(engine.leaderLap, setup.difficulty);

  return (
    <div className="race">
      <header className="topbar">
        <div className="tb-left">
          <button className="btn ghost tiny" onClick={() => { if (engine.state === 'finished' || confirm('Leave this race? Progress will be lost.')) onQuit(); }}>✕</button>
          <div className="tb-title">
            <div className="eyebrow">{engine.circuit.name}</div>
            <div className="lapcount">LAP <b>{engine.state === 'lights' ? 0 : leaderLap}</b><span>/{engine.laps}</span></div>
          </div>
          <FlagBadge engine={engine} />
        </div>
        <div className="tb-weather">
          <div className="wx-now">
            <span title="Air temperature">Air <b>{wx.airTemp.toFixed(0)}°C</b></span>
            <span title="Track temperature">Track <b>{wx.trackTemp.toFixed(0)}°C</b></span>
            <span title="Track wetness">{wx.rain > 0.05 ? '🌧' : wx.wetness > 0.05 ? '💧' : '☀'} <b>{Math.round(wx.wetness * 100)}%</b> wet</span>
          </div>
          <div className="forecast" title="Rain probability for the next laps">
            {forecast.map((f) => (
              <div key={f.lap} className="fc-cell" style={{ background: `rgba(58,160,255,${f.prob / 110})` }}>
                <span>{f.prob}</span>
              </div>
            ))}
            <div className="fc-text">{headline ?? 'No rain expected'}</div>
          </div>
        </div>
        <div className="tb-right">
          <div className="seg speeds">
            {CONFIG.sim.SPEEDS.map((s) => (
              <button key={s} className={speed === s ? 'on' : ''} onClick={() => setSpeed(s)}>{s === 0 ? '❚❚' : `${s}x`}</button>
            ))}
          </div>
          <label className="toggle" title="Pause automatically on Safety Car, rain or retirements">
            <input type="checkbox" checked={autoPause} onChange={(e) => setAutoPause(e.target.checked)} /> Auto-pause
          </label>
          <button className={`btn tiny ${follow ? 'on' : 'ghost'}`} onClick={() => setFollow((f) => !f)} title="Camera follows the selected car (F)">🎥 Follow</button>
        </div>
      </header>

      <div className="track-wrap" ref={wrapRef}>
        <canvas ref={canvasRef} />
        {speed === 0 && engine.state !== 'finished' && engine.state !== 'lights' && <div className="paused">PAUSED</div>}
        {engine.state === 'lights' && speed === 0 && (
          <div className="overlay-center"><button className="btn primary big" onClick={() => setSpeed(1)}>Start the race</button></div>
        )}
        {engine.state === 'finished' && engine.result && (
          <div className="overlay-center">
            <div className="finish-card">
              <div className="chequered" />
              <h2>Chequered flag</h2>
              <p>{engine.order[0].driver.name} wins the {setup.roundName.split('·').pop()?.trim()}.</p>
              <button className="btn primary big" onClick={() => onFinished(engine.result!)}>Results & recap →</button>
            </div>
          </div>
        )}
      </div>

      <aside className="side">
        <TimingTower engine={engine} selected={selected} onSelect={setSelected} />
        <RadioFeed msgs={engine.radio} />
      </aside>

      <footer className="bottom">
        {mine.map((car) => (
          <CarCard key={car.id} car={car} engine={engine} selected={selected === car.id} onSelect={() => setSelected(car.id)} />
        ))}
        <TeamOrders engine={engine} />
      </footer>
    </div>
  );
}

function FlagBadge({ engine }: { engine: RaceEngine }) {
  if (engine.state === 'lights') return <span className="flag flag-grid">GRID</span>;
  if (engine.state !== 'running') return <span className="flag flag-chq">FINISH</span>;
  if (engine.flag === 'sc') return <span className="flag flag-sc">SAFETY CAR{engine.flagEnding ? ' · IN' : ''}</span>;
  if (engine.flag === 'vsc') return <span className="flag flag-sc">VSC{engine.flagEnding ? ' · ENDING' : ''}</span>;
  return <span className="flag flag-green">GREEN</span>;
}

function TimingTower({ engine, selected, onSelect }: { engine: RaceEngine; selected: string; onSelect: (id: string) => void }) {
  const mode = CONFIG.difficulty[engine.setup.difficulty].rivalWear;
  return (
    <div className="tower">
      <div className="tower-head">
        <span>P</span><span />
        <span>Driver</span>
        <span className="r">Gap</span>
        <span className="r">Int</span>
        <span>Tyre</span>
        <span className="r">Wear</span>
        <span className="r">Pit</span>
      </div>
      {engine.order.map((c, i) => {
        const lapped = i > 0 && engine.order[0].dist - c.dist >= 1 && c.status === 'running';
        const gap = c.status === 'dnf' ? 'OUT' : i === 0 ? 'Leader' : lapped ? `+${Math.floor(engine.order[0].dist - c.dist)}L` : fmtGap(c.gapLeader);
        const interval = c.status === 'dnf' || i === 0 ? '' : c.status === 'finished' ? '🏁' : fmtGap(engine.gapBetween(engine.order[i - 1], c));
        const wear = c.isPlayer || mode === 'exact' ? `${Math.round(c.wear)}%` : mode === 'approx' ? `≈${Math.round(c.wear / 10) * 10}%` : '—';
        const status = c.pit ? 'PIT' : c.outLap ? 'OUT' : c.drsOpen ? 'DRS' : '';
        return (
          <div key={c.id} className={`tower-row ${c.isPlayer ? 'mine' : ''} ${selected === c.id ? 'sel' : ''} ${c.status === 'dnf' ? 'dnf' : ''}`} onClick={() => onSelect(c.id)}>
            <span className="pos">{i + 1}</span>
            <span className="stripe" style={{ background: c.team.color }} />
            <span className="drv"><b>{c.driver.code}</b> <small>{c.driver.number}</small>{status && <em className={`st st-${status.toLowerCase()}`}>{status}</em>}</span>
            <span className="r mono">{gap}</span>
            <span className="r mono">{interval}</span>
            <span className="tyrecell"><TyreBadge c={c.compound} size={16} /><small>{c.tyreAge}</small></span>
            <span className="r mono">{wear}</span>
            <span className="r mono">{c.pitStops.length}</span>
          </div>
        );
      })}
    </div>
  );
}

function RadioFeed({ msgs }: { msgs: RadioMsg[] }) {
  const list = msgs.slice(-30).reverse();
  return (
    <div className="radio">
      <div className="radio-head">📻 Team radio</div>
      <div className="radio-list">
        {list.map((m) => (
          <div key={m.id} className={`msg msg-${m.level}`}>
            <span className="msg-lap">L{m.lap}</span>
            <span>{m.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function CarCard({ car, engine, selected, onSelect }: { car: Car; engine: RaceEngine; selected: boolean; onSelect: () => void }) {
  const cfg = CONFIG.tyres.compounds[car.compound];
  const rejoin = car.status === 'running' && !car.pit ? engine.estimateRejoin(car.id) : null;
  const ahead = engine.order[car.position - 2];
  const behind = engine.order[car.position];
  const racing = car.status === 'running' && engine.state === 'running';
  const next = car.plan[0];

  let statusLine: React.ReactNode = null;
  if (car.status === 'dnf') statusLine = <span className="bad">RETIRED</span>;
  else if (car.status === 'finished') statusLine = <span className="good">FINISHED P{car.position}</span>;
  else if (car.pit) statusLine = <span className="warn">{car.pit.stopped ? 'Leaving pit lane' : car.pit.moved >= car.pit.laneTime / 2 ? `Stopped · ${(car.pit.stopTime - car.pit.stopLeft).toFixed(1)}s` : 'In pit lane'} → {CONFIG.tyres.compounds[car.pit.toCompound].name}</span>;
  else if (car.boxRequest) statusLine = <span className="warn blink">BOX THIS LAP → {CONFIG.tyres.compounds[car.boxRequest].name}</span>;

  return (
    <div className={`carcard ${selected ? 'sel' : ''}`} onClick={onSelect} style={{ borderTopColor: car.team.color }}>
      <div className="cc-head">
        <div className="cc-pos">P{car.position}</div>
        <div className="cc-name">
          <div><span className="num-badge" style={{ background: car.team.color }}>{car.driver.number}</span> <b>{car.driver.name}</b></div>
          <div className="muted small mono">Last {fmtLap(car.lastLap)} · Best {fmtLap(car.bestLap)} · {Math.round(car.speedKmh)} km/h</div>
        </div>
        <div className="cc-gaps mono small">
          <div>{ahead ? <>▲ #{ahead.driver.number} {fmtGap(engine.gapBetween(ahead, car))}</> : 'Leading'}</div>
          <div>{behind && behind.status !== 'dnf' ? <>▼ #{behind.driver.number} {fmtGap(engine.gapBetween(car, behind))}</> : ''}</div>
        </div>
      </div>

      <div className="cc-tyre">
        <TyreBadge c={car.compound} size={30} />
        <div className="cc-tyre-info">
          <div className="row between"><span>{cfg.name} · {car.tyreAge} laps</span><b className="mono">{car.wear.toFixed(0)}%</b></div>
          <WearBar wear={car.wear} compound={car.compound} />
          <div className="row between muted small"><span>Fuel {car.fuelKg.toFixed(1)} kg</span><span>Cliff {cfg.cliff}%</span></div>
        </div>
      </div>

      <div className="cc-row">
        <span className="label">Pace</span>
        <div className="seg small">
          {(['push', 'balanced', 'conserve'] as PaceMode[]).map((m) => (
            <button key={m} disabled={!racing} className={car.paceMode === m ? 'on' : ''} onClick={(e) => { e.stopPropagation(); engine.setPaceMode(car.id, m); }}>
              {m === 'push' ? 'Push' : m === 'balanced' ? 'Balanced' : 'Conserve'}
            </button>
          ))}
        </div>
      </div>

      <div className="cc-row">
        <span className="label">Box</span>
        <div className="row">
          {ALL_COMPOUNDS.map((c) => (
            <button key={c} disabled={!racing || !!car.pit} className={`tyre-btn ${car.boxRequest === c ? 'on' : ''}`} onClick={(e) => { e.stopPropagation(); engine.setBox(car.id, car.boxRequest === c ? null : c); }} title={`Box for ${CONFIG.tyres.compounds[c].name}`}>
              <TyreBadge c={c} size={22} />
            </button>
          ))}
          {car.boxRequest && <button className="btn ghost tiny" onClick={(e) => { e.stopPropagation(); engine.setBox(car.id, null); }}>Stay out</button>}
        </div>
      </div>

      <div className="cc-info small">
        {statusLine && <div>{statusLine}</div>}
        {rejoin && racing && (
          <div className="hint">
            If box now: rejoin <b>P{rejoin.pos}</b>
            {rejoin.ahead && <>, {rejoin.ahead.gap.toFixed(1)}s behind #{rejoin.ahead.number}</>}
            {rejoin.behind && <> · {rejoin.behind.gap.toFixed(1)}s ahead of #{rejoin.behind.number}</>}
            <span className="muted"> · loss {rejoin.lossGreen.toFixed(1)}s{engine.flag !== 'green' ? ' (cheap!)' : ''}</span>
          </div>
        )}
        {racing && (
          <div className="plan-status">
            {next ? <>Plan: box L{next.lap} → <TyreBadge c={next.compound} size={14} /></> : <span className="muted">No planned stops</span>}
            {next && <button className="btn ghost tiny" onClick={(e) => { e.stopPropagation(); engine.skipPlanStop(car.id); }}>Skip</button>}
            <label className="toggle small" onClick={(e) => e.stopPropagation()}>
              <input type="checkbox" checked={car.autoPlan} onChange={(e) => engine.setAutoPlan(car.id, e.target.checked)} /> Auto
            </label>
          </div>
        )}
      </div>
    </div>
  );
}

function TeamOrders({ engine }: { engine: RaceEngine }) {
  const alive = engine.cars.filter((c) => c.isPlayer && c.status === 'running').length === 2;
  return (
    <div className="orders">
      <div className="label">Team orders</div>
      <div className="seg vertical">
        <button disabled={!alive} className={engine.teamOrder === 'none' ? 'on' : ''} onClick={() => engine.setTeamOrder('none')}>Free to race</button>
        <button disabled={!alive} className={engine.teamOrder === 'hold' ? 'on' : ''} onClick={() => engine.setTeamOrder('hold')}>Hold position</button>
        <button disabled={!alive || (!engine.canSwap() && engine.teamOrder !== 'swap')} title="Cars must be adjacent and within 2.5s" className={engine.teamOrder === 'swap' ? 'on' : ''} onClick={() => engine.setTeamOrder('swap')}>Swap cars</button>
      </div>
      <div className="muted small">Pit loss now: {(() => {
        const c = engine.cars.find((x) => x.isPlayer && x.status === 'running');
        return c ? `${engine.pitLossGreenEquiv(c).toFixed(1)}s` : '—';
      })()}</div>
    </div>
  );
}
