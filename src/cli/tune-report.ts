/**
 * Relatorio de calibracao em confrontos variados (nao espelhados).
 * Uso: npm run sim:tune -- [jogos]
 */
import { generateLeague } from '../core/data/generator.js';
import { GameSim } from '../core/sim/game.js';
import { DEFAULT_TUNING } from '../core/config/tuning.js';
import { DEFAULT_SLIDERS } from '../core/config/sliders.js';
import { overall } from '../core/model/attributes.js';
import { startersOf } from '../core/model/team.js';

const league = generateLeague('courtside');
const games = Number(process.argv[2] ?? 6);
const acc = { pts: 0, fga: 0, fgm: 0, tpa: 0, tpm: 0, fta: 0, ftm: 0, to: 0, ast: 0, reb: 0, oreb: 0, poss: 0, foul: 0, stl: 0, blk: 0, n: 0 };
const spread: number[] = [];

const strength = (t: typeof league.teams[0]) =>
  startersOf(t).reduce((s, p) => s + overall(p.attributes, p.position), 0) / 5;

for (let g = 0; g < games; g++) {
  const home = league.teams[(g * 3) % league.teams.length];
  const away = league.teams[(g * 7 + 1) % league.teams.length];
  if (home === away) continue;
  const sim = new GameSim({ home, away, tuning: DEFAULT_TUNING, sliders: DEFAULT_SLIDERS, seed: `tune${g}` });
  sim.runToCompletion();
  for (const t of sim.box.teams) {
    acc.pts += t.points; acc.fga += t.fga; acc.fgm += t.fgm; acc.tpa += t.tpa; acc.tpm += t.tpm;
    acc.fta += t.fta; acc.ftm += t.ftm; acc.to += t.turnovers; acc.ast += t.assists;
    acc.reb += t.oreb + t.dreb; acc.oreb += t.oreb; acc.poss += t.possessions;
    acc.foul += t.fouls; acc.stl += t.steals; acc.blk += t.blocks;
    acc.n++;
  }
  spread.push(Math.abs(sim.box.teams[0].points - sim.box.teams[1].points));
  console.log(`  ${home.identity.abbreviation} ${sim.box.teams[0].points} x ${sim.box.teams[1].points} ${away.identity.abbreviation}` +
    `  (forca ${strength(home).toFixed(0)} x ${strength(away).toFixed(0)}, erros ${sim.box.teams[0].turnovers}/${sim.box.teams[1].turnovers})`);
}

const n = acc.n;
const f = (v: number) => (v / n).toFixed(1);
console.log('\nMEDIA POR EQUIPE POR JOGO');
console.log(`  PTS ${f(acc.pts)} (alvo 114) | FGA ${f(acc.fga)} (88) | FG% ${((acc.fgm / acc.fga) * 100).toFixed(1)} (47)`);
console.log(`  3PA ${f(acc.tpa)} (35) | 3P% ${((acc.tpm / acc.tpa) * 100).toFixed(1)} (36) | FTA ${f(acc.fta)} (22) | FT% ${((acc.ftm / acc.fta) * 100).toFixed(1)} (78)`);
console.log(`  TO ${f(acc.to)} (13) | AST ${f(acc.ast)} (26) | REB ${f(acc.reb)} (44) | OREB ${f(acc.oreb)} (10)`);
console.log(`  POSSES ${f(acc.poss)} (100) | FALTAS ${f(acc.foul)} (19) | ROUBOS ${f(acc.stl)} (8) | TOCOS ${f(acc.blk)} (5)`);
console.log(`  Margem media: ${(spread.reduce((a, b) => a + b, 0) / spread.length).toFixed(1)} pontos`);
