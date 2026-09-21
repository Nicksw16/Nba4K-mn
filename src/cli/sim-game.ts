/**
 * Simula uma partida completa sem render e imprime a sumula.
 * Uso: npm run sim:game -- [seed] [--quiet]
 */
import { generateLeague } from '../core/data/generator.js';
import { GameSim } from '../core/sim/game.js';
import { DEFAULT_TUNING } from '../core/config/tuning.js';
import { DEFAULT_SLIDERS } from '../core/config/sliders.js';
import { BOX_HEADER, formatPlayerLine, formatTeamLine, offensiveRating, effectiveFg } from '../core/stats/boxscore.js';
import { pct } from '../core/math/util.js';

const seed = process.argv[2] ?? 'demo';
const quiet = process.argv.includes('--quiet');

const league = generateLeague('courtside');
const home = league.teams[0];
const away = league.teams[1];

const sim = new GameSim({
  home, away,
  tuning: DEFAULT_TUNING,
  sliders: DEFAULT_SLIDERS,
  seed,
});

const started = Date.now();
sim.runToCompletion();
const elapsed = Date.now() - started;

const t0 = sim.box.teams[0];
const t1 = sim.box.teams[1];

console.log('');
console.log('='.repeat(96));
console.log(`  ${t0.name}  ${t0.points}  x  ${t1.points}  ${t1.name}`);
console.log(`  Periodos: ${t0.pointsByPeriod.join(' / ')}  |  ${t1.pointsByPeriod.join(' / ')}`);
console.log('='.repeat(96));

for (const team of [t0, t1]) {
  console.log('');
  console.log(formatTeamLine(team));
  console.log(`  Posses: ${team.possessions} | Rating ofensivo: ${offensiveRating(team).toFixed(1)} | eFG%: ${(effectiveFg(team) * 100).toFixed(1)} | Banco: ${team.benchPoints} | Contra-ataque: ${team.fastBreakPoints} | 2a chance: ${team.secondChancePoints} | Maior vantagem: ${team.biggestLead}`);
  console.log('');
  console.log(BOX_HEADER);
  console.log('-'.repeat(96));
  const players = [...sim.box.players.values()]
    .filter((p) => p.teamIdx === team.teamIdx && p.secondsPlayed > 1)
    .sort((a, b) => b.secondsPlayed - a.secondsPlayed);
  for (const p of players) console.log(formatPlayerLine(p));
}

if (!quiet) {
  console.log('');
  console.log('DESTAQUES');
  console.log('-'.repeat(96));
  for (const e of sim.events.highlights(0.7).slice(0, 14)) {
    console.log(`  P${e.period} ${Math.floor(e.clock / 60)}:${Math.floor(e.clock % 60).toString().padStart(2, '0')}  ${e.text ?? e.kind}`);
  }
}

const shots = sim.box.shotChart;
const byZone = new Map<string, { made: number; att: number }>();
for (const s of shots) {
  const z = byZone.get(s.zone) ?? { made: 0, att: 0 };
  z.att++;
  if (s.made) z.made++;
  byZone.set(s.zone, z);
}
console.log('');
console.log('DISTRIBUICAO DE ARREMESSO (ambos os times)');
console.log('-'.repeat(96));
for (const [zone, z] of [...byZone.entries()].sort((a, b) => b[1].att - a[1].att)) {
  const share = ((z.att / shots.length) * 100).toFixed(1);
  console.log(`  ${zone.padEnd(14)} ${String(z.made).padStart(3)}/${String(z.att).padEnd(3)}  ${pct(z.made, z.att).padStart(5)}%   ${share.padStart(5)}% das tentativas`);
}
console.log('');
console.log(`Simulado em ${elapsed} ms (${(elapsed / 48 / 60).toFixed(2)} ms por segundo de jogo).`);
