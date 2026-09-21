/**
 * Simula uma temporada completa e imprime classificacao, lideres e playoffs.
 * Uso: npm run sim:season -- [jogos por equipe]
 */
import { Rng } from '../core/math/rng.js';
import { generateLeague } from '../core/data/generator.js';
import { DEFAULT_RULES, computeAwards, conferenceStandings, createSeason, runPlayoffs, simulateDay } from '../core/franchise/league.js';
import { fullName } from '../core/model/player.js';
import { teamLabel } from '../core/model/team.js';
import { overall } from '../core/model/attributes.js';

const gamesPerTeam = Number(process.argv[2] ?? 82);
const league = generateLeague('courtside');
const rng = new Rng('season-cli');
const season = createSeason(league, { ...DEFAULT_RULES, gamesPerTeam }, rng);

const started = Date.now();
let guard = 0;
while (!season.finished && guard++ < 5000) simulateDay(league, season, rng);
const elapsed = Date.now() - started;

const nameOf = (id: string) => {
  for (const t of league.teams) {
    const p = t.roster.find((x) => x.id === id);
    if (p) return `${fullName(p)} (${t.identity.abbreviation})`;
  }
  return '-';
};

for (const conf of ['Leste', 'Oeste'] as const) {
  console.log(`\nCONFERENCIA ${conf.toUpperCase()}`);
  console.log('-'.repeat(72));
  conferenceStandings(league, season, conf).forEach((r, i) => {
    console.log(
      `${String(i + 1).padStart(2)}. ${teamLabel(r.team.identity).padEnd(28)} ` +
      `${String(r.wins).padStart(3)}-${String(r.losses).padEnd(3)} ` +
      `${(r.pct * 100).toFixed(1).padStart(5)}%  saldo ${(r.diff > 0 ? '+' : '') + r.diff}`,
    );
  });
}

const leaders = [...season.playerSeason.values()]
  .filter((s) => s.games >= gamesPerTeam * 0.5)
  .map((s) => ({
    id: s.playerId,
    ppg: s.totals.points / s.games,
    rpg: (s.totals.oreb + s.totals.dreb) / s.games,
    apg: s.totals.assists / s.games,
  }));

console.log('\nLIDERES');
console.log('-'.repeat(72));
const top = (key: 'ppg' | 'rpg' | 'apg', label: string) => {
  const list = [...leaders].sort((a, b) => b[key] - a[key]).slice(0, 3);
  console.log(`  ${label}: ${list.map((l) => `${nameOf(l.id)} ${l[key].toFixed(1)}`).join(' · ')}`);
};
top('ppg', 'Pontos');
top('rpg', 'Rebotes');
top('apg', 'Assistencias');

const awards = computeAwards(league, season);
season.awards = awards;
console.log('\nPREMIACOES');
console.log('-'.repeat(72));
console.log(`  MVP: ${nameOf(awards.mvp)}`);
console.log(`  Defensor do ano: ${nameOf(awards.dpoy)}`);
console.log(`  Calouro do ano: ${nameOf(awards.roty)}`);
console.log(`  Sexto homem: ${nameOf(awards.sixthMan)}`);

const playoffs = runPlayoffs(league, season, rng);
console.log('\nPLAYOFFS');
console.log('-'.repeat(72));
playoffs.rounds.forEach((round, i) => {
  console.log(`  Rodada ${i + 1}:`);
  for (const s of round) {
    const high = league.teams.find((t) => t.identity.id === s.highId)!;
    const low = league.teams.find((t) => t.identity.id === s.lowId)!;
    const winner = s.winnerId === s.highId ? high : low;
    console.log(`    ${high.identity.abbreviation} ${s.highWins}-${s.lowWins} ${low.identity.abbreviation}  -> ${winner.identity.abbreviation}`);
  }
});
const champ = league.teams.find((t) => t.identity.id === playoffs.champion);
console.log(`\n  CAMPEAO: ${champ ? teamLabel(champ.identity) : 'indefinido'}`);
console.log(`\nTemporada de ${gamesPerTeam} jogos simulada em ${elapsed} ms.`);
