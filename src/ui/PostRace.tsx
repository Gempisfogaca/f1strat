import { circuitCfg } from '../sim/config';
import { fmtLap } from '../sim/race';
import { driverById, teamById } from '../sim/teams';
import type { RaceResult } from '../sim/types';
import type { EventCtx } from './App';
import { TeamDot } from './common';

export function PostRace({ result, ev, onContinue }: { result: RaceResult; ev: EventCtx; onContinue: () => void }) {
  const mine = result.results.filter((r) => r.teamId === ev.teamId);
  const teamPts = mine.reduce((a, b) => a + b.points, 0);
  const team = teamById(ev.teamId);
  return (
    <div className="post">
      <header className="screen-head">
        <div>
          <div className="eyebrow">Race result · {circuitCfg(result.circuitId).name}</div>
          <h1>{result.roundName}</h1>
        </div>
        <button className="btn primary" onClick={onContinue}>{ev.mode === 'season' ? 'Championship standings →' : 'Back to menu →'}</button>
      </header>
      <div className="post-grid">
        <section className="card">
          <h2>Classification</h2>
          <table className="table">
            <thead>
              <tr><th>Pos</th><th /><th>Driver</th><th>Team</th><th className="r">Grid</th><th className="r">Time / Gap</th><th className="r">Best lap</th><th className="r">Stops</th><th className="r">Pts</th></tr>
            </thead>
            <tbody>
              {result.results.map((r) => {
                const d = driverById(r.driverId);
                const t = teamById(r.teamId);
                const fl = result.fastestLap?.driverId === r.driverId;
                return (
                  <tr key={r.driverId} className={r.teamId === ev.teamId ? 'mine' : ''}>
                    <td className="pos">{r.status === 'dnf' ? 'DNF' : r.position}</td>
                    <td><TeamDot color={t.color} /></td>
                    <td><b>{d.name}</b> <span className="muted">#{d.number}</span></td>
                    <td className="muted">{t.name}</td>
                    <td className="r mono">{r.grid}</td>
                    <td className="r mono">{r.gapText}{r.penalty ? <span className="bad"> (+{r.penalty}s pen)</span> : null}</td>
                    <td className={`r mono ${fl ? 'purple' : ''}`}>{fmtLap(r.bestLap)}</td>
                    <td className="r mono">{r.pitStops}</td>
                    <td className="r mono"><b>{r.points || ''}</b></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
        <section className="card">
          <h2><TeamDot color={team.color} /> {team.name}: {teamPts} point{teamPts === 1 ? '' : 's'}</h2>
          {mine.map((r) => {
            const d = driverById(r.driverId);
            return (
              <div key={r.driverId} className="recap">
                <h3>
                  <span className="num-badge" style={{ background: team.color }}>{d.number}</span> {d.name} —{' '}
                  {r.status === 'dnf' ? 'DNF' : `P${r.position}`} {r.points ? <span className="good">+{r.points} pts</span> : null}
                </h3>
                <ul>
                  {(result.recap[r.driverId] ?? []).map((it, i) => (
                    <li key={i} className={it.good ? 'good-item' : 'bad-item'}>
                      <span className="mark">{it.good ? '✓' : '✗'}</span> {it.text}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </section>
      </div>
    </div>
  );
}
