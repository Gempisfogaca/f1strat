import { useState } from 'react';
import { CONFIG, lapsFor } from '../sim/config';
import { FULL_CALENDAR, SEASON_FORMATS, circuitNameOf, type SaveData, type SeasonFormat, type Settings } from '../sim/season';
import { driversOfTeam, TEAMS, teamById } from '../sim/teams';
import type { Difficulty, WeatherMode } from '../sim/types';
import type { EventCtx } from './App';
import { TeamDot, TrackThumb } from './common';

interface Props {
  save: SaveData;
  onSettings: (s: Settings) => void;
  onQuickRace: (ev: EventCtx) => void;
  onNewSeason: (teamId: string, difficulty: Difficulty, lengthId: string, format: SeasonFormat) => void;
  onContinueSeason: () => void;
  onAbandonSeason: () => void;
}

const DIFF_HELP: Record<Difficulty, string> = {
  easy: 'Weak AI strategies, exact rival tyre data, reliable forecasts.',
  normal: 'Competent AI, approximate rival tyre wear, decent forecasts.',
  hard: 'Sharp AI that reacts to Safety Cars and weather. Rival tyre wear hidden, forecasts unreliable.',
};

export function Menu({ save, onSettings, onQuickRace, onNewSeason, onContinueSeason, onAbandonSeason }: Props) {
  const st = save.settings;
  const [circuitId, setCircuitId] = useState(FULL_CALENDAR[0]);
  const circuit = CONFIG.circuits.find((c) => c.id === circuitId)!;
  const [weather, setWeather] = useState<WeatherMode>('random');
  const set = (p: Partial<Settings>) => onSettings({ ...st, ...p });
  const season = save.season;

  return (
    <div className="menu">
      <header className="menu-head">
        <div className="logo">PIT<span>WALL</span></div>
        <div className="tagline">You don't drive. You decide.</div>
      </header>

      <div className="menu-grid">
        <section className="card">
          <h2>Your team</h2>
          <div className="team-grid">
            {TEAMS.map((t) => (
              <button key={t.id} className={`team-btn ${st.teamId === t.id ? 'on' : ''}`} onClick={() => set({ teamId: t.id })} style={{ borderColor: st.teamId === t.id ? t.color : undefined }}>
                <span className="team-stripe" style={{ background: t.color }} />
                <span className="team-name">{t.name}</span>
                <span className="team-meta">Car {t.carRating} · {driversOfTeam(t.id).map((d) => d.code).join(' / ')}</span>
              </button>
            ))}
          </div>

          <h3>Difficulty</h3>
          <div className="seg">
            {(['easy', 'normal', 'hard'] as Difficulty[]).map((d) => (
              <button key={d} className={st.difficulty === d ? 'on' : ''} onClick={() => set({ difficulty: d })}>{CONFIG.difficulty[d].label}</button>
            ))}
          </div>
          <p className="help">{DIFF_HELP[st.difficulty]}</p>

          <h3>Race length</h3>
          <div className="seg">
            {CONFIG.race.LENGTH_OPTIONS.map((o) => (
              <button key={o.id} className={st.lengthId === o.id ? 'on' : ''} onClick={() => set({ lengthId: o.id })}>
                {o.label} <small>{Math.round(o.pct * 100)}%</small>
              </button>
            ))}
          </div>
          <p className="help">Tyre wear and fuel scale with distance, so short races still need real strategy.</p>
        </section>

        <section className="card">
          <h2>Season</h2>
          {season && season.round < season.rounds.length ? (
            <div className="season-box">
              <div className="season-line">
                <TeamDot color={teamById(season.teamId).color} /> {teamById(season.teamId).name}
                <span className="muted"> · {CONFIG.difficulty[season.difficulty].label}</span>
              </div>
              <div className="big">Round {season.round + 1}<span className="muted"> / {season.rounds.length}</span></div>
              <div className="muted">{SEASON_FORMATS[season.format].label} season · Next: {circuitNameOf(season.rounds[season.round])}</div>
              <div className="row gap">
                <button className="btn primary" onClick={onContinueSeason}>Continue season</button>
                <button className="btn ghost" onClick={() => { if (confirm('Abandon the current season?')) onAbandonSeason(); }}>Abandon</button>
              </div>
            </div>
          ) : (
            <div className="season-box">
              {season && <div className="muted">Last season complete. Start a new one!</div>}
              <div className="seg">
                {(Object.keys(SEASON_FORMATS) as SeasonFormat[]).map((f) => (
                  <button key={f} className={st.seasonFormat === f ? 'on' : ''} onClick={() => set({ seasonFormat: f })}>
                    {SEASON_FORMATS[f].label} <small>{SEASON_FORMATS[f].circuits.length} races</small>
                  </button>
                ))}
              </div>
              <p className="help">
                {st.seasonFormat === 'full'
                  ? 'The full 2026 calendar, Melbourne to Abu Dhabi.'
                  : `A ${SEASON_FORMATS[st.seasonFormat].circuits.length}-race selection from the calendar: ${SEASON_FORMATS[st.seasonFormat].circuits.map(circuitNameOf).join(', ')}.`}
                {' '}Drivers' and constructors' championships; progress is saved automatically.
              </p>
              <button className="btn primary" onClick={() => onNewSeason(st.teamId, st.difficulty, st.lengthId, st.seasonFormat)}>
                Start season with {teamById(st.teamId).name}
              </button>
            </div>
          )}

          <h2 style={{ marginTop: 24 }}>Quick race</h2>
          <div className="circuit-grid">
            {FULL_CALENDAR.map((id) => {
              const c = CONFIG.circuits.find((x) => x.id === id)!;
              return (
                <button key={c.id} className={`circuit-btn ${circuitId === c.id ? 'on' : ''}`} onClick={() => setCircuitId(c.id)} title={c.name}>
                  <TrackThumb id={c.id} w={96} h={60} />
                  <div className="circuit-name">{c.short ?? c.country}</div>
                </button>
              );
            })}
          </div>
          <div className="circuit-detail">
            <b>{circuit.gpName}</b> · {circuit.name}
            <div className="muted small">{circuit.character} · {circuit.lengthKm.toFixed(3)} km · {lapsFor(circuit.id, st.lengthId)} laps</div>
          </div>
          <h3>Weather</h3>
          <div className="seg">
            {(['random', 'dry', 'wet'] as WeatherMode[]).map((w) => (
              <button key={w} className={weather === w ? 'on' : ''} onClick={() => setWeather(w)}>{w === 'random' ? 'Dynamic' : w === 'dry' ? 'Dry' : 'Wet start'}</button>
            ))}
          </div>
          <button
            className="btn primary wide"
            onClick={() =>
              onQuickRace({
                mode: 'quick', circuitId, roundName: `${circuit.gpName} · Quick race`,
                laps: lapsFor(circuitId, st.lengthId), difficulty: st.difficulty, weather, teamId: st.teamId,
                tempOffset: 0, rainMult: 1, seed: Math.floor(Math.random() * 1e9),
              })
            }
          >
            Go to pre-race →
          </button>
        </section>
      </div>
      <footer className="menu-foot">Tip: Space pauses, keys 1–5 set speed, B boxes your selected car.</footer>
    </div>
  );
}
