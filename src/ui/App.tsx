import { useState } from 'react';
import { lapsFor } from '../sim/config';
import { applyResult, CALENDAR, loadSave, newSeason, writeSave, type SaveData } from '../sim/season';
import type { Difficulty, RaceResult, RaceSetup, WeatherMode } from '../sim/types';
import { Menu } from './Menu';
import { PostRace } from './PostRace';
import { PreRace } from './PreRace';
import { RaceScreen } from './RaceScreen';
import { Standings } from './Standings';

/** Everything needed to set up an event before strategies are chosen. */
export interface EventCtx {
  mode: 'quick' | 'season';
  circuitId: string;
  roundName: string;
  laps: number;
  difficulty: Difficulty;
  weather: WeatherMode;
  teamId: string;
  tempOffset: number;
  rainMult: number;
  seed: number;
}

type Screen =
  | { kind: 'menu' }
  | { kind: 'prerace'; ev: EventCtx }
  | { kind: 'race'; ev: EventCtx; setup: RaceSetup }
  | { kind: 'post'; ev: EventCtx; result: RaceResult }
  | { kind: 'standings' };

export default function App() {
  const [save, setSave] = useState<SaveData>(() => loadSave());
  const [screen, setScreen] = useState<Screen>({ kind: 'menu' });

  const persist = (d: SaveData) => { setSave(d); writeSave(d); };

  const seasonEvent = (d: SaveData): EventCtx | null => {
    const s = d.season;
    if (!s || s.round >= CALENDAR.length) return null;
    const r = CALENDAR[s.round];
    return {
      mode: 'season', circuitId: r.circuitId, roundName: `Round ${s.round + 1} · ${r.name}`,
      laps: lapsFor(r.circuitId, s.lengthId), difficulty: s.difficulty, weather: 'random', teamId: s.teamId,
      tempOffset: r.tempOffset, rainMult: r.rainMult, seed: s.seed + s.round * 7919,
    };
  };

  switch (screen.kind) {
    case 'menu':
      return (
        <Menu
          save={save}
          onSettings={(settings) => persist({ ...save, settings })}
          onQuickRace={(ev) => setScreen({ kind: 'prerace', ev })}
          onNewSeason={(teamId, difficulty, lengthId) => {
            const d = { ...save, season: newSeason(teamId, difficulty, lengthId), settings: { teamId, difficulty, lengthId } };
            persist(d);
            setScreen({ kind: 'standings' });
          }}
          onContinueSeason={() => setScreen({ kind: 'standings' })}
          onAbandonSeason={() => persist({ ...save, season: null })}
        />
      );
    case 'prerace':
      return (
        <PreRace
          ev={screen.ev}
          onBack={() => setScreen(screen.ev.mode === 'season' ? { kind: 'standings' } : { kind: 'menu' })}
          onStart={(setup) => setScreen({ kind: 'race', ev: screen.ev, setup })}
        />
      );
    case 'race':
      return (
        <RaceScreen
          key={screen.setup.seed}
          setup={screen.setup}
          onQuit={() => setScreen(screen.ev.mode === 'season' ? { kind: 'standings' } : { kind: 'menu' })}
          onFinished={(result) => {
            if (screen.ev.mode === 'season' && save.season) persist({ ...save, season: applyResult(save.season, result) });
            setScreen({ kind: 'post', ev: screen.ev, result });
          }}
        />
      );
    case 'post':
      return (
        <PostRace
          result={screen.result}
          ev={screen.ev}
          onContinue={() => setScreen(screen.ev.mode === 'season' ? { kind: 'standings' } : { kind: 'menu' })}
        />
      );
    case 'standings': {
      const ev = seasonEvent(save);
      return save.season ? (
        <Standings
          season={save.season}
          onNext={ev ? () => setScreen({ kind: 'prerace', ev }) : undefined}
          onMenu={() => setScreen({ kind: 'menu' })}
        />
      ) : (
        <Menu
          save={save}
          onSettings={(settings) => persist({ ...save, settings })}
          onQuickRace={(e) => setScreen({ kind: 'prerace', ev: e })}
          onNewSeason={() => setScreen({ kind: 'menu' })}
          onContinueSeason={() => setScreen({ kind: 'menu' })}
          onAbandonSeason={() => undefined}
        />
      );
    }
  }
}
