# Pitwall — F1-style race strategy game

You're the strategist, not the driver. Cars race on their own; you win or lose on
pit stops, tyres, pace modes, team orders and weather calls.

## Run

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # static build in dist/ (no backend)
npm run simtest -- highland short random 42   # headless race for tuning
```

> The project lives in iCloud Drive, so `node_modules` is a symlink to
> `node_modules.nosync` (iCloud skips `.nosync` folders). If you clone this
> elsewhere, a normal `npm install` works fine.

## How to play

1. **Menu** – pick a team, difficulty and race length; start a Season (8 rounds) or a Quick race.
2. **Pre-race** – see qualifying, circuit traits and the rain risk; choose each car's start tyre and plan
   (suggested 1-stop / 2-stop, custom stints, or no plan).
3. **Race** – planned stops happen automatically (toggle *Auto* or *Skip* per car). Override at any time:
   - **Box** + compound (S/M/H/I/W) → boxes at the end of this lap. The hint shows where you'd rejoin.
   - **Pace**: Push / Balanced / Conserve trades lap time for tyre wear.
   - **Team orders**: Free / Hold position / Swap (cars must be adjacent and within 2.5 s).
   - **Weather**: the strip at the top shows rain probability for the next 10 laps.
   - **Safety Car / VSC** make stops much cheaper; the game auto-pauses on SC, rain and retirements.
4. **Post-race** – classification, points and a recap of what worked and what cost time.

Keys: `Space` pause, `1`–`5` speed (pause/1x/2x/4x/8x), `F` follow-cam, `Tab` switch car, `B` box selected car.

## Code layout

| Path | What |
|---|---|
| `src/sim/config.ts` | **Every tuning number** — tyres, pit loss, pace deltas, weather, SC, AI, circuits |
| `src/sim/race.ts` | Fixed-step race engine: movement, traffic/overtaking, pits, flags, AI, radio, recap |
| `src/sim/laptime.ts` | Lap-time model (base + tyre + fuel + traffic + weather + noise) |
| `src/sim/tyres.ts` | Wear, degradation/cliff, wet-weather suitability |
| `src/sim/weather.ts` | Rain events, wetness/temperature, forecast |
| `src/sim/strategy.ts` | Strategy optimizer (used by pre-race suggestions and the AI) |
| `src/sim/track.ts` | Spline circuits, speed profile, DRS/passing zones, pit lane |
| `src/sim/season.ts` | Calendar, points, localStorage save |
| `src/render/renderer.ts` | Canvas drawing only (reads engine state) |
| `src/ui/*` | React screens and panels |

The simulation runs at 60 Hz in fixed steps, decoupled from rendering; the HTML panels refresh ~7×/s.
Tyre wear and fuel are scaled by race length, so a short race needs the same kind of strategy as a full one.
