/**
 * Teste de simetria: o mesmo elenco joga dos dois lados. Qualquer diferenca
 * sistematica entre casa e visitante indica bug de geometria ou de logica de
 * lado, nao diferenca de talento.
 */
import { generateLeague } from '../core/data/generator.js';
import { GameSim } from '../core/sim/game.js';
import { DEFAULT_TUNING } from '../core/config/tuning.js';
import { DEFAULT_SLIDERS } from '../core/config/sliders.js';
import { Team } from '../core/model/team.js';

const league = generateLeague('courtside');
const base = league.teams[0];
const games = Number(process.argv[2] ?? 6);

function cloneTeam(t: Team, suffix: string): Team {
  const copy: Team = JSON.parse(JSON.stringify(t));
  copy.identity.id = `${t.identity.id}${suffix}`;
  copy.identity.city = `${t.identity.city}${suffix}`;
  copy.roster.forEach((p) => { p.id = `${p.id}${suffix}`; p.teamId = copy.identity.id; });
  copy.starters = copy.starters.map((id) => `${id}${suffix}`);
  copy.rotation = copy.rotation.map((id) => `${id}${suffix}`);
  return copy;
}

const foulDetail = new Map<string, number>();
const totals = [
  { pts: 0, fga: 0, fgm: 0, tpa: 0, tpm: 0, fta: 0, to: 0, ast: 0, reb: 0, oreb: 0, poss: 0, foul: 0, stl: 0, blk: 0, paint: 0 },
  { pts: 0, fga: 0, fgm: 0, tpa: 0, tpm: 0, fta: 0, to: 0, ast: 0, reb: 0, oreb: 0, poss: 0, foul: 0, stl: 0, blk: 0, paint: 0 },
];

for (let g = 0; g < games; g++) {
  const sim = new GameSim({
    home: cloneTeam(base, '_H'),
    away: cloneTeam(base, '_A'),
    tuning: DEFAULT_TUNING,
    sliders: DEFAULT_SLIDERS,
    seed: `mirror${g}`,
  });
  sim.runToCompletion();
  for (const i of [0, 1] as const) {
    const t = sim.box.teams[i];
    const acc = totals[i];
    acc.pts += t.points; acc.fga += t.fga; acc.fgm += t.fgm; acc.tpa += t.tpa; acc.tpm += t.tpm;
    acc.fta += t.fta; acc.to += t.turnovers; acc.ast += t.assists; acc.reb += t.oreb + t.dreb;
    acc.oreb += t.oreb; acc.poss += t.possessions; acc.foul += t.fouls; acc.stl += t.steals;
    acc.blk += t.blocks; acc.paint += t.paintPoints;
  }
  for (const e of sim.events.all()) {
    if (e.kind === 'foul') {
      const k = `${e.team === 0 ? 'CASA' : 'FORA'}/${String((e.data as any)?.kind ?? '?')}`;
      foulDetail.set(k, (foulDetail.get(k) ?? 0) + 1);
    }
    if (e.kind === 'steal') {
      const k = `${e.team === 0 ? 'CASA' : 'FORA'}/steal`;
      foulDetail.set(k, (foulDetail.get(k) ?? 0) + 1);
    }
  }
  console.log(`  jogo ${g}: ${sim.box.teams[0].points} x ${sim.box.teams[1].points}`);
}

console.log(`\nMEDIA POR JOGO (${games} jogos, elencos identicos)`);
console.log('              PTS   FGA   FG%   3PA   3P%   FTA    TO   AST   REB  OREB  POSS   FAL   ROU   TOC  GARR');
for (const i of [0, 1] as const) {
  const a = totals[i];
  const n = games;
  console.log(
    `${(i === 0 ? 'CASA' : 'FORA').padEnd(10)} ${(a.pts / n).toFixed(1).padStart(5)} ${(a.fga / n).toFixed(1).padStart(5)} ` +
    `${((a.fgm / Math.max(1, a.fga)) * 100).toFixed(1).padStart(5)} ${(a.tpa / n).toFixed(1).padStart(5)} ` +
    `${((a.tpm / Math.max(1, a.tpa)) * 100).toFixed(1).padStart(5)} ${(a.fta / n).toFixed(1).padStart(5)} ` +
    `${(a.to / n).toFixed(1).padStart(5)} ${(a.ast / n).toFixed(1).padStart(5)} ${(a.reb / n).toFixed(1).padStart(5)} ` +
    `${(a.oreb / n).toFixed(1).padStart(5)} ${(a.poss / n).toFixed(1).padStart(5)} ${(a.foul / n).toFixed(1).padStart(5)} ` +
    `${(a.stl / n).toFixed(1).padStart(5)} ${(a.blk / n).toFixed(1).padStart(5)} ${(a.paint / n).toFixed(1).padStart(5)}`,
  );
}
console.log('\nFALTAS/ROUBOS POR LADO');
for (const [k, v] of [...foulDetail.entries()].sort()) console.log(`  ${k.padEnd(34)} ${(v / games).toFixed(1)}`);
console.log('\nAlvos NBA:  PTS ~114  FGA ~88  FG% ~47  3PA ~35  3P% ~36  FTA ~22  TO ~13  AST ~26  REB ~44  OREB ~10  POSS ~100  FAL ~19');
