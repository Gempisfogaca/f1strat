// Headless race runner for tuning: `npm run simtest -- [circuit] [length] [weather] [seed]`
import { CONFIG, lapsFor } from '../src/sim/config';
import { RaceEngine, fmtLap } from '../src/sim/race';
import { Rng } from '../src/sim/rng';
import { runQualifying } from '../src/sim/quali';
import { suggestedPlans } from '../src/sim/strategy';
import { driverById, driversOfTeam } from '../src/sim/teams';
import type { WeatherMode } from '../src/sim/types';

const [circuit = 'silverstone', length = 'short', weather = 'random', seedArg = '42'] = process.argv.slice(2);
const seed = Number(seedArg);
const laps = lapsFor(circuit, length);
const rng = new Rng(seed);
const grid = runQualifying(circuit, rng).map((q) => q.driverId);
const c = CONFIG.circuits.find((x) => x.id === circuit)!;
const plans = suggestedPlans({ circuit: c, laps, trackTemp: c.trackTemp });
console.log('1-stop', JSON.stringify(plans.oneStop.strategy), plans.oneStop.time.toFixed(1));
console.log('2-stop', JSON.stringify(plans.twoStop.strategy), plans.twoStop.time.toFixed(1));
const team = 'williams';
const ps: Record<string, any> = {};
for (const d of driversOfTeam(team)) ps[d.id] = plans.oneStop.strategy;
const t0 = Date.now();
const e = new RaceEngine({
  circuitId: circuit, roundName: 'Test', laps, difficulty: 'normal', weather: weather as WeatherMode,
  playerTeamId: team, tempOffset: 0, rainChanceMult: 1, seed, playerStrategies: ps, grid,
});
let steps = 0;
while (e.state !== 'finished' && steps < 60 * 60 * 200) { e.step(1 / 60); steps++; }
console.log(`${circuit} ${laps} laps, sim ${e.time.toFixed(0)}s, wall ${Date.now() - t0}ms, incidents ${e.incidents}, wet race ${e.weather.isWetRace}`);
for (const r of e.result!.results) {
  const car = e.cars.find((x) => x.id === r.driverId)!;
  console.log(
    String(r.position).padStart(2), driverById(r.driverId).code, `grid ${String(r.grid).padStart(2)}`, r.gapText.padEnd(12),
    'best', fmtLap(r.bestLap), 'stints', car.stints.map((s) => `${s.compound}${s.startLap}-${s.endLap}(${s.maxWear.toFixed(0)}%)`).join(' '),
    'traffic', car.stats.traffic.toFixed(1), r.penalty ? `PEN ${r.penalty}` : '',
  );
}
console.log('--- radio');
for (const m of e.radio.slice(-25)) console.log(`L${m.lap} [${m.level}] ${m.text}`);
