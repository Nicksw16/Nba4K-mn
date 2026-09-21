/** Diagnostico de calibracao: eventos, esperado vs realizado. */
import { generateLeague } from '../core/data/generator.js';
import { GameSim } from '../core/sim/game.js';
import { DEFAULT_TUNING } from '../core/config/tuning.js';
import { DEFAULT_SLIDERS } from '../core/config/sliders.js';

const league = generateLeague('courtside');
const games = Number(process.argv[2] ?? 1);
const counts = new Map<string, number>();
const foulKinds = new Map<string, number>();
let expSum = 0;
let attempts = 0;
const byType = new Map<string, { exp: number; n: number }>();
const missReasons = new Map<string, number>();

for (let g = 0; g < games; g++) {
  const sim = new GameSim({
    home: league.teams[0], away: league.teams[1],
    tuning: DEFAULT_TUNING, sliders: DEFAULT_SLIDERS, seed: `diag${g}`,
  });
  sim.runToCompletion();
  for (const e of sim.events.all()) {
    counts.set(e.kind, (counts.get(e.kind) ?? 0) + 1);
    if (e.kind === 'foul') {
      const k = String((e.data as any)?.kind ?? '?') + ((e.data as any)?.shooting ? '/shooting' : '');
      foulKinds.set(k, (foulKinds.get(k) ?? 0) + 1);
    }
    if (e.kind === 'shot_attempt') {
      const prob = Number((e.data as any)?.probability ?? 0);
      const kind = String((e.data as any)?.type ?? (e.data as any)?.kind ?? 'jump');
      expSum += prob;
      attempts++;
      const b = byType.get(kind) ?? { exp: 0, n: 0 };
      b.exp += prob;
      b.n++;
      byType.set(kind, b);
    }
  }
  for (const [k, v] of sim.missReasons.entries()) missReasons.set(k, (missReasons.get(k) ?? 0) + v);
  const t0 = sim.box.teams[0];
  const t1 = sim.box.teams[1];
  const fgm = t0.fgm + t1.fgm;
  const fga = t0.fga + t1.fga;
  console.log(`jogo ${g}: ${t0.points}-${t1.points} | FG ${fgm}/${fga} (${((fgm / Math.max(1, fga)) * 100).toFixed(1)}%) | 3P ${t0.tpm + t1.tpm}/${t0.tpa + t1.tpa} | FTA ${t0.fta}/${t1.fta} | TO ${t0.turnovers}/${t1.turnovers} | AST ${t0.assists}/${t1.assists} | REB ${t0.oreb + t0.dreb}/${t1.oreb + t1.dreb} | periodos ${t0.pointsByPeriod.length} | posses ${t0.possessions}/${t1.possessions}`);
}

console.log(`\nESPERADO vs REALIZADO: media de probabilidade ${(expSum / Math.max(1, attempts) * 100).toFixed(1)}% em ${attempts} tentativas registradas`);
for (const [k, b] of [...byType.entries()].sort((a, b) => b[1].n - a[1].n)) {
  console.log(`  ${k.padEnd(18)} n=${String(b.n).padStart(4)}  prob media ${(b.exp / Math.max(1, b.n) * 100).toFixed(1)}%`);
}

console.log('\nEVENTOS (media por jogo)');
for (const [k, v] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k.padEnd(24)} ${(v / games).toFixed(1)}`);
}
console.log('\nMOTIVOS DE ERRO');
for (const [k, v] of [...missReasons.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
  console.log(`  ${k.padEnd(40)} ${(v / games).toFixed(1)}`);
}
console.log('\nFALTAS POR TIPO');
for (const [k, v] of [...foulKinds.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k.padEnd(28)} ${(v / games).toFixed(1)}`);
}
