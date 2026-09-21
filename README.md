# COURTSIDE: LEGACY

Simulador de basquete com física contínua, IA contextual, carreira e franquia.
Escrito em TypeScript, sem engine de jogo e sem dependências de runtime — roda
no navegador (Canvas 2D com projeção em perspectiva) e no Node (simulação
headless para calibrar e para rodar temporadas).

> **Identidade original.** Times, atletas, arenas, uniformes e marcas são
> fictícios e gerados proceduralmente. Nenhum asset, logo, nome ou animação de
> produto comercial é usado ou imitado.

---

## O que está rodando de verdade

O critério do projeto é o da seção 135 do escopo: **nenhum botão decorativo.**
Se aparece na tela, opera sobre o mesmo núcleo que o simulador usa.

| Sistema | O que faz |
| --- | --- |
| **Locomoção** | Aceleração limitada, inércia por massa, limite de atrito do solado, foot planting que condiciona cortes, perda e recuperação de equilíbrio. Não existe mudança instantânea de direção. |
| **Contato** | Resolução massa-ponderada sem atravessamento, classificação (peito, ombro, quadril, bloqueio, boxout, aterrissagem, bola solta), contenção lateral, screens e boxout. |
| **Bola** | Corpo independente com gravidade, arrasto, efeito Magnus, aro tratado como toro, tabela como plano retangular e detecção de cesta por cruzamento do plano do aro. |
| **Drible** | 28 moves modulares equipáveis; ankle breaker **causal**, derivado do peso comprometido do defensor contra a direção de saída. Sem RNG de animação. |
| **Arremesso** | Rhythm shooting (início, tempo, soltura), janela verde variável, contest multinível e modelo de probabilidade com 10 termos explícitos. |
| **Finalização** | Gather × finish escolhidos em tempo real pela geometria (lado do defensor, ângulo, contato, alcance). Dunk meter reavaliado em três momentos do voo. |
| **Passe** | 14 tipos, alvo com lead, erro angular por precisão/pressão, três desfechos de interceptação (não tocar, desviar, dominar). |
| **Defesa** | Postura de mãos, cushion, forçar mão fraca, cutoff planejado, closeout, roubo e toco com timing real. |
| **Rebote** | Leitura individual da trajetória (com erro por atributo), disputa por posição + boxout + alcance, tip-outs. |
| **Fadiga** | Stamina longa e adrenalina curta, com efeitos separados em velocidade, salto, precisão, controle e reação. |
| **Takeover** | Cinco disciplinas independentes com medidor próprio e seis estados. |
| **IA** | Percepção espacial (espaçamento, linhas de penetração, gravidade, mismatch), decisão por valor esperado, 10 coberturas de pick and roll, ajuda do lado fraco, playbook com 10 sets e treinador adaptativo. |
| **Progressão** | XP por trilha do que foi feito, tokens de badge, 53 badges especializadas com sinergia FUSE/REACTION, cap breakers, rebirth, medalhas e desafios. |
| **Carreira** | Estágios, 5 eras jogáveis com regras próprias, confiança do treinador que controla minutos, manchetes geradas dos números. |
| **Franquia** | Calendário round-robin, classificação, playoffs, premiações, desenvolvimento por idade, aposentadoria, draft com loteria, contratos, free agency multi-fator, trocas e confiança do GM. |

---

## Rodando

```bash
npm install
npm run build

npm run serve        # cliente em http://localhost:8080
npm run sim:game     # uma partida headless com súmula completa
npm run sim:season   # temporada completa simulada
npm test             # suíte de testes
```

Ferramentas de calibração:

```bash
node dist/src/cli/mirror.js 8      # teste de espelho (elencos idênticos)
node dist/src/cli/diagnose.js 2    # contagem de eventos por tipo
```

---

## Arquitetura

```
src/core/          núcleo puro, sem DOM — roda igual no navegador e no Node
  math/            vetores, RNG determinístico, utilidades numéricas
  config/          tuning data-driven, sliders, geometria da quadra
  model/           atributos, físico, badges, builder, tendências, times
  sim/             locomoção, contato, bola, drible, arremesso, finalização,
                   passe, defesa, rebote, fadiga, takeover, faltas, motor
  ai/              percepção, ataque, defesa, playbook, treinador
  stats/           súmula, shot chart, métricas avançadas
  career/          progressão, carreira, eras
  franchise/       liga, simulação rápida, contratos, desenvolvimento
  save/            serialização versionada com migração
src/client/        render, câmera, HUD, input, áudio, telas
src/cli/           simuladores headless e servidor estático
tests/             suíte em node:test
```

**Regra de dependência:** `core` não importa nada de `client`. Por isso a mesma
simulação roda no navegador e em um processo Node sem DOM.

---

## Como o jogo decide se um arremesso entra

Esta é a parte que mais costuma ser simplificada, então vale explicitar:

1. No release, calcula-se o **contest** somando proximidade, alinhamento com a
   cesta, mão levantada, envergadura relativa, timing do salto do defensor e
   velocidade de chegada.
2. Calcula-se a **janela verde**, que cresce com o atributo e com a suavidade do
   gesto e encolhe com marcação e desequilíbrio.
3. A **probabilidade** sai de base por timing, piso por habilidade, queda por
   distância além da zona confortável, e então penalidades e bônus de marcação,
   equilíbrio, movimento, fadiga, assistência, hot/cold, badges da situação e
   momento decisivo.
4. **Sorteia-se uma vez.** A física então encena o resultado: acerto mira o
   centro com variação pequena; erro recebe desvio coerente com a causa (curto
   por fadiga, longo por soltar tarde, lateral por contest de lado) e a bola
   realmente bate no aro, no vidro ou passa reto.

O passo 4 é uma escolha deliberada: garante que a estatística seja calibrável
sem abrir mão de uma trajetória fisicamente correta na tela.

---

## Documentação

- [`docs/DESIGN.md`](docs/DESIGN.md) — decisões de design e por quê
- [`docs/ARQUITETURA.md`](docs/ARQUITETURA.md) — dois relógios, integração simultânea, fluxo de posse
- [`docs/SISTEMAS.md`](docs/SISTEMAS.md) — mapa de onde cada coisa vive
- [`docs/CALIBRACAO.md`](docs/CALIBRACAO.md) — método, bugs encontrados e números atuais
- [`docs/COBERTURA.md`](docs/COBERTURA.md) — as 141 seções do escopo, uma a uma, com status honesto
- [`docs/CONTROLES.md`](docs/CONTROLES.md) — teclado, controle e o arremesso de ritmo
- [`docs/ROADMAP.md`](docs/ROADMAP.md) — o que falta e em que ordem

### Estado da calibração

Média por equipe por jogo, confrontos variados:

| | PTS | FGA | FG% | 3PA | 3P% | FTA | TO | AST | POSSES | Margem |
|---|---|---|---|---|---|---|---|---|---|---|
| **Atual** | 104 | 89 | 41,8% | 33 | 36,4% | 22,3 | 20 | 22,5 | 107 | 10–20 |
| **Alvo** | 114 | 88 | 47% | 35 | 36% | 22 | 13 | 26 | 100 | ~12 |

Volume de arremesso, três pontos, lances livres, ritmo e margem de vitória
estão em faixa de liga real. Aproveitamento, erros de posse e rebote ofensivo
continuam acima/abaixo do alvo — as causas estão identificadas em
[`docs/CALIBRACAO.md`](docs/CALIBRACAO.md).

---

## Licença e escopo

Projeto de código. Nenhuma propriedade intelectual de terceiros é incluída,
referenciada em assets ou imitada. O conteúdo audiovisual é gerado em tempo de
execução (geometria, cores, áudio sintetizado).
