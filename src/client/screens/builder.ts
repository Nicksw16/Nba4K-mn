/**
 * TELA DO BUILDER (secoes 41, 42, 43, 46, 47).
 *
 * Tudo reativo: mexer na altura recalcula na hora o custo de cada atributo, o
 * maximo alcancavel, os slots de badge e quais badges ficam disponiveis. E o
 * mesmo `evaluateBuild` que o resto do jogo usa.
 */
import { AppContext } from '../main.js';
import { el, clear, selectRow, sliderRow, textRow, table } from '../ui/dom.js';
import { BLUEPRINTS, BuildInput, BuildResult, buildToPlayer, evaluateBuild } from '../../core/model/build.js';
import { ATTRIBUTE_CATEGORY, ATTRIBUTE_KEYS, ATTRIBUTE_LABELS, Attributes, AttributeCategory, Position } from '../../core/model/attributes.js';
import { BADGES, BadgeLoadout, BadgeTier, TIER_NAMES, maxTierFor, slotsUsed, validateLoadout } from '../../core/model/badges.js';
import { PLAY_STYLE_LABELS, PlayStyle } from '../../core/model/tendencies.js';
import { clamp } from '../../core/math/util.js';
import { CareerSave } from '../../core/save/save.js';
import { createCareer } from '../../core/career/career.js';

const CATEGORY_LABELS: Record<AttributeCategory, string> = {
  shooting: 'Arremesso',
  finishing: 'Finalizacao',
  playmaking: 'Criacao',
  defense: 'Defesa',
  rebounding: 'Rebote',
  physicals: 'Fisico',
};

export function openBuilder(ctx: AppContext, onDone?: (input: BuildInput, result: BuildResult, badges: BadgeLoadout) => void): void {
  let input: BuildInput = JSON.parse(JSON.stringify(BLUEPRINTS[0].input));
  input.name = { first: 'Novo', last: 'Atleta' };
  let badges: BadgeLoadout = {};

  const root = el('div', { class: 'screen' });
  ctx.ui.appendChild(root);

  const rerender = () => {
    clear(root);
    const result = evaluateBuild(input);
    root.appendChild(el('div', { class: 'brand' }, [
      el('h1', { text: 'CRIAR ATLETA' }),
      el('p', { text: 'o fisico muda o custo, nunca o atributo' }),
    ]));

    // --- Identidade e fisico ---
    root.appendChild(el('div', { class: 'panel' }, [
      el('h2', { text: 'Identidade e fisico' }),
      textRow('Nome', input.name.first, (v) => { input.name.first = v; }),
      textRow('Sobrenome', input.name.last, (v) => { input.name.last = v; }),
      selectRow('Posicao', input.position, (['PG', 'SG', 'SF', 'PF', 'C'] as Position[]).map((p) => ({ value: p, label: p })), (v) => {
        input.position = v as Position;
        rerender();
      }),
      selectRow('Estilo de jogo', input.style, (Object.keys(PLAY_STYLE_LABELS) as PlayStyle[]).map((s) => ({ value: s, label: PLAY_STYLE_LABELS[s] })), (v) => {
        input.style = v as PlayStyle;
      }),
      sliderRow('Altura', input.heightInches, 68, 90, 1, (v) => `${Math.floor(v / 12)}'${v % 12}" (${(v * 2.54).toFixed(0)} cm)`, (v) => {
        input.heightInches = v;
        input.wingspanInches = clamp(input.wingspanInches, v - 4, v + 10);
        rerender();
      }),
      sliderRow('Peso', input.weightLbs, 150, 300, 1, (v) => `${v} lb (${(v * 0.4536).toFixed(0)} kg)`, (v) => {
        input.weightLbs = v;
        rerender();
      }),
      sliderRow('Envergadura', input.wingspanInches, input.heightInches - 4, input.heightInches + 10, 1,
        (v) => `${Math.floor(v / 12)}'${v % 12}" (${(v * 2.54).toFixed(0)} cm)`, (v) => {
          input.wingspanInches = v;
          rerender();
        }),
      el('p', { class: 'hint', text: 'Cada centimetro muda o preco: um pivo alto paga barato em rebote e toco e caro em drible e velocidade. A aparencia em si nao altera nenhum atributo.' }),
    ]));

    // --- Orcamento ---
    const spentPct = Math.round((result.spent / result.budget) * 100);
    root.appendChild(el('div', { class: 'panel' }, [
      el('h2', { text: 'Orcamento' }),
      el('div', { class: 'row' }, [
        el('label', { text: 'Pontos usados' }),
        el('span', { class: 'value', text: `${result.spent} / ${result.budget} (${spentPct}%)` }),
      ]),
      ...(result.problems.length
        ? result.problems.map((p) => el('p', { class: 'hint', text: `⚠ ${p}` }))
        : [el('p', { class: 'hint', text: 'Build valido.' })]),
    ]));

    // --- Atributos por categoria ---
    const cats: AttributeCategory[] = ['shooting', 'finishing', 'playmaking', 'defense', 'rebounding', 'physicals'];
    for (const cat of cats) {
      const keys = ATTRIBUTE_KEYS.filter((k) => ATTRIBUTE_CATEGORY[k] === cat);
      const grid = el('div', { class: 'attr-grid' }, keys.map((k) => {
        const value = result.attributes[k];
        const max = result.maxPossible[k] ?? value;
        const cost = result.perAttributeCost[k] ?? 0;
        const valSpan = el('span', { class: 'val', text: String(value) });
        const range = el('input', {
          type: 'range', min: '25', max: '99', step: '1', value: String(value),
          oninput: (e: Event) => {
            const v = Number((e.target as HTMLInputElement).value);
            input.targets = { ...input.targets, [k]: v };
            valSpan.textContent = String(v);
          },
          onchange: () => rerender(),
        });
        return el('div', { class: 'attr', title: `Custo atual: ${cost} pontos · maximo alcancavel: ${max}` }, [
          el('span', { class: 'name', text: `${ATTRIBUTE_LABELS[k]} (max ${max})` }),
          range,
          valSpan,
        ]);
      }));
      root.appendChild(el('div', { class: 'panel' }, [el('h2', { text: CATEGORY_LABELS[cat] }), grid]));
    }

    // --- Badges ---
    const used = slotsUsed(badges);
    const badgeNodes = BADGES.map((def) => {
      const max = maxTierFor(def, result.attributes);
      const current = badges[def.id] ?? 0;
      const canEquip = max > 0 && used[def.category] + def.slotCost <= result.badgeSlots[def.category];
      const node = el('div', {
        class: `badge${current ? ' on' : ''}`,
        onclick: () => {
          if (current) {
            badges[def.id] = ((current + 1) % (max + 1)) as BadgeTier;
            if (!badges[def.id]) delete badges[def.id];
          } else if (canEquip) {
            badges[def.id] = 1;
          }
          rerender();
        },
      }, [
        el('div', {}, [
          el('b', { text: def.name }),
          el('small', { text: def.situation }),
          el('small', { class: 'tier', text: max === 0 ? 'atributo insuficiente' : `max ${TIER_NAMES[max]} · ${def.slotCost} slot(s) · atual ${TIER_NAMES[current]}` }),
        ]),
      ]);
      return node;
    });
    const validation = validateLoadout(badges, result.attributes, result.badgeSlots, result.badgeSlots);
    root.appendChild(el('div', { class: 'panel' }, [
      el('h2', { text: 'Badges' }),
      el('p', { class: 'hint', text: `Slots: ${cats.map((c) => `${CATEGORY_LABELS[c]} ${used[c]}/${result.badgeSlots[c]}`).join(' · ')}` }),
      ...(validation.problems.map((p) => el('p', { class: 'hint', text: `⚠ ${p}` }))),
      el('div', { class: 'badge-list scroll' }, badgeNodes),
    ]));

    // --- Blueprints ---
    root.appendChild(el('div', { class: 'panel' }, [
      el('h2', { text: 'Modelos prontos' }),
      el('div', { class: 'menu' }, BLUEPRINTS.map((b) => el('button', {
        class: 'card',
        onclick: () => {
          input = JSON.parse(JSON.stringify(b.input));
          input.name = { first: 'Novo', last: 'Atleta' };
          badges = {};
          rerender();
        },
      }, [
        el('h3', { text: b.name }),
        el('p', { text: `${b.description} (${b.archetypes.join(' · ')})` }),
      ]))),
    ]));

    root.appendChild(el('div', { class: 'toolbar' }, [
      el('button', {
        class: 'action',
        text: onDone ? 'Confirmar atleta' : 'Salvar e iniciar carreira',
        onclick: () => {
          const r = evaluateBuild(input);
          if (!r.ok) {
            ctx.app.flash('BUILD INVALIDO');
            return;
          }
          if (onDone) {
            onDone(input, r, badges);
            return;
          }
          const player = buildToPlayer(input, `user_${Date.now()}`, r);
          player.badges = badges;
          const career = createCareer(player.id);
          ctx.saves.write<CareerSave>({
            meta: { slot: 'default', kind: 'career', label: `${input.name.first} ${input.name.last}`, updatedAt: 0, version: 0 },
            career,
            build: input,
            leagueSeed: 'courtside-legacy',
            season: 1,
          });
          ctx.app.flash('ATLETA CRIADO');
          ctx.go('career');
        },
      }),
      el('button', { class: 'ghost', text: 'Voltar', onclick: () => ctx.go('main') }),
    ]));
  };

  rerender();
}
