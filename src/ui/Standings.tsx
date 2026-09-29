import { CONFIG, circuitCfg } from '../sim/config';
import { CALENDAR, driverStandings, teamStandings, type SeasonState } from '../sim/season';
import { driverById, teamById } from '../sim/teams';
import { TeamDot, TrackThumb } from './common';

export function Standings({ season, onNext, onMenu }: { season: SeasonState; onNext?: () => void; onMenu: () => void }) {
  const ds = driverStandings(season);
  const ts = teamStandings(season);
  const done = season.round >= CALENDAR.length;
  const next = CALENDAR[season.round];
  const myTeam = teamById(season.teamId);
  const myPos = ts.findIndex((t) => t.team.id === season.teamId) + 1;
  return (
    <div className="standings">
      <header className="screen-head">
        <button className="btn ghost" onClick={onMenu}>← Menu</button>
        <div>
          <div className="eyebrow">Championship · {CONFIG.difficulty[season.difficulty].label} · <TeamDot color={myTeam.color} /> {myTeam.name} (P{myPos})</div>
          <h1>{done ? 'Season complete' : `After round ${season.round} of ${CALENDAR.length}`}</h1>
        </div>
        {onNext && <button className="btn primary" onClick={onNext}>Next: {next.name} →</button>}
      </header>

      {done && (
        <div className="card champion">
          <div className="eyebrow">World champions</div>
          <h2>🏆 {ds[0].driver.name} <span className="muted">({teamById(ds[0].driver.teamId).name})</span> · {ts[0].team.name}</h2>
          <p>{myTeam.name} finished P{myPos} in the constructors' championship with {ts[myPos - 1].points} points.</p>
        </div>
      )}

      <div className="standings-grid">
        <section className="card">
          <h2>Drivers</h2>
          <table className="table">
            <thead><tr><th>Pos</th><th /><th>Driver</th><th className="r">Wins</th><th className="r">Podiums</th><th className="r">Pts</th></tr></thead>
            <tbody>
              {ds.map((d, i) => (
                <tr key={d.driver.id} className={d.driver.teamId === season.teamId ? 'mine' : ''}>
                  <td className="pos">{i + 1}</td>
                  <td><TeamDot color={teamById(d.driver.teamId).color} /></td>
                  <td><b>{d.driver.name}</b> <span className="muted">#{d.driver.number}</span></td>
                  <td className="r mono">{d.wins}</td>
                  <td className="r mono">{d.podiums}</td>
                  <td className="r mono"><b>{d.points}</b></td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        <section className="card">
          <h2>Constructors</h2>
          <table className="table">
            <thead><tr><th>Pos</th><th /><th>Team</th><th className="r">Wins</th><th className="r">Pts</th></tr></thead>
            <tbody>
              {ts.map((t, i) => (
                <tr key={t.team.id} className={t.team.id === season.teamId ? 'mine' : ''}>
                  <td className="pos">{i + 1}</td>
                  <td><TeamDot color={t.team.color} /></td>
                  <td><b>{t.team.name}</b></td>
                  <td className="r mono">{t.wins}</td>
                  <td className="r mono"><b>{t.points}</b></td>
                </tr>
              ))}
            </tbody>
          </table>
          <h2 style={{ marginTop: 20 }}>Calendar</h2>
          <div className="calendar">
            {CALENDAR.map((r, i) => {
              const res = season.results[i];
              const winner = res ? driverById(res.results[0].driverId) : null;
              const mine = res?.results.filter((x) => x.teamId === season.teamId).map((x) => (x.status === 'dnf' ? 'DNF' : `P${x.position}`)).join(' · ');
              return (
                <div key={i} className={`cal-row ${i === season.round ? 'next' : ''} ${res ? 'done' : ''}`}>
                  <span className="pos">{i + 1}</span>
                  <TrackThumb id={r.circuitId} w={46} h={30} />
                  <div className="cal-name">
                    <b>{r.name}</b>
                    <div className="muted small">{circuitCfg(r.circuitId).name}{winner ? ` · won by ${winner.code}` : ''}</div>
                  </div>
                  <span className="mono small">{mine ?? (i === season.round ? 'NEXT' : '')}</span>
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}
