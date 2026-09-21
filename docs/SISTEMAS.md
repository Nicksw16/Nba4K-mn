# Mapa dos sistemas

Referência rápida de onde cada coisa vive e o que ela faz.

## Núcleo (`src/core/`)

### `math/`
| Arquivo | Conteúdo |
|---|---|
| `vec.ts` | Vetores 2D/3D, projeções, distância a segmento (usado em linha de passe). |
| `rng.ts` | RNG determinístico (mulberry32) com hash de string, normal, escolha ponderada e fork. |
| `util.ts` | Clamp, lerp, remap, logística, `attrScale`, damp independente de framerate, conversões imperiais↔SI. |

### `config/`
| Arquivo | Conteúdo |
|---|---|
| `court.ts` | Geometria da quadra em metros, zonas de arremesso, valor do arremesso, garrafão, área restritiva. |
| `tuning.ts` | ~150 constantes de balanceamento, todas nomeadas e comentadas. Fonte única. |
| `sliders.ts` | 14 sliders, 5 perfis de dificuldade (IA), 5 perfis de assistência, presets simulação/arcade. |

### `model/`
| Arquivo | Conteúdo |
|---|---|
| `attributes.ts` | 34 atributos, físico em SI, alcance em pé, massa efetiva, inércia, overall por posição. |
| `badges.ts` | 53 badges com situação, requisito, slots; sinergias FUSE/REACTION; compilação de ficha. |
| `tendencies.ts` | 35 tendências e 13 estilos de jogo originais. |
| `build.ts` | Custo por atributo modulado pelo físico, orçamento, máximo alcançável, 12 blueprints, cap breakers, rebirth. |
| `player.ts` | Perfil persistente, contrato, personalidade, saúde, loadouts. |
| `team.ts` | Identidade, gameplan (16 parâmetros), treinador, derivação tática a partir do elenco. |

### `sim/`
| Arquivo | Responsabilidade |
|---|---|
| `actor.ts` | Corpo em partida: posição, velocidade, equilíbrio, pés, fadiga, takeover, ação atual. |
| `effective.ts` | Atributos efetivos do frame (fadiga, adrenalina, takeover, badges). |
| `locomotion.ts` | Momentum, inércia, atrito, foot planting, equilíbrio, salto, impulso. |
| `contact.ts` | Colisão massa-ponderada, classificação, cutoff, screen, boxout. |
| `ball.ts` | Física 3D, aro como toro, tabela, solver de lançamento com arrasto, predição. |
| `dribble.ts` | 28 moves, execução via locomoção, ankle breaker causal, segurança da bola. |
| `shooting.ts` | Rhythm meter, contest multinível, janela verde, probabilidade, construção do release. |
| `finishing.ts` | Seleção gather×finish, dunk meter dinâmico, pump fake, step-through, and-one. |
| `passing.ts` | 14 tipos, lead, erro angular, interceptação, ranking de alvos, alley-oop. |
| `defense.ts` | Postura, cushion, cutoff planejado, closeout, roubo, toco, pressão na bola. |
| `rebounding.ts` | Previsão individual, disputa, tip-out. |
| `fatigue.ts` | Stamina e adrenalina com drenos e recuperação separados. |
| `takeover.ts` | Cinco disciplinas, seis estados, especialidades. |
| `fouls.ts` | Responsabilidade do contato, tipos de falta, lances livres, eliminação. |
| `events.ts` | Fluxo único de eventos para estatística, áudio, apresentação e replay. |
| `game.ts` | Motor: loop, máquina de posse, resolução de ações, substituições, períodos. |

### `ai/`
| Arquivo | Responsabilidade |
|---|---|
| `perception.ts` | Leitura de quadra: espaçamento, linhas, gravidade, mismatch, carga do garrafão. |
| `offense.ts` | Decisão com bola por valor esperado; movimentação sem bola; transição. |
| `defense-ai.ts` | Atribuição, marcação individual, ajuda, 10 coberturas de pick and roll. |
| `playbook.ts` | 10 sets como função do tempo (alimenta também o play art). |
| `coach.ts` | Playcalling, adaptação de gameplan, rotação, tempo técnico, matchup hunting. |

### `career/`, `franchise/`, `stats/`, `save/`
| Arquivo | Responsabilidade |
|---|---|
| `career/progression.ts` | XP por trilha, tokens, níveis, medalhas, desafios de especialização. |
| `career/career.ts` | Estágios, 5 eras, confiança do treinador, manchetes, decisões, co-op. |
| `franchise/league.ts` | Calendário round-robin, classificação, playoffs, premiações. |
| `franchise/quicksim.ts` | Resolução estatística de partida para simular temporadas. |
| `franchise/contracts.ts` | Valor de mercado, free agency multi-fator, GM trust, trocas. |
| `franchise/development.ts` | Curva de idade, aposentadoria, draft com loteria, relacionamentos. |
| `stats/boxscore.ts` | Súmula, shot chart por zona, eFG, TS, rating, estimativa de posses. |
| `save/save.ts` | Serialização versionada, backup e migração. |

## Cliente (`src/client/`)

| Arquivo | Responsabilidade |
|---|---|
| `render/camera.ts` | Câmera pinhole, 7 modos, amortecimento por eixo, shake. |
| `render/renderer.ts` | Quadra projetada, corpos a partir dos pés, bola com spin, play art. |
| `ui/hud.ts` | Scorebug, shot meter, feedback de arremesso, painel do atleta, ticker. |
| `ui/dom.ts` | Construtores de DOM sem framework. |
| `input/input.ts` | Teclado + gamepad para o mesmo `UserCommand`; pro stick. |
| `audio/audio.ts` | Síntese WebAudio de todos os sons + torcida contextual. |
| `screens/` | Builder, franquia, carreira, treino. |
| `main.ts` | Roteador de telas e loop principal. |

## Ferramentas (`src/cli/`)

| Comando | O que faz |
|---|---|
| `sim-game.js` | Partida headless com súmula, destaques e distribuição de arremesso. |
| `sim-season.js` | Temporada completa com classificação, líderes, premiações e playoffs. |
| `mirror.js` | Teste de espelho: elencos idênticos dos dois lados. |
| `diagnose.js` | Eventos por tipo, esperado × realizado, motivos de erro de arremesso. |
| `tune-report.js` | Médias em confrontos variados contra os alvos de liga real. |
| `serve.js` | Servidor estático para o cliente. |
