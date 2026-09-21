# Arquitetura

## Princípio central

```
src/core/  →  nunca importa de src/client/, nunca toca DOM
src/client/ →  importa de core livremente
src/cli/    →  importa de core livremente
```

Essa regra única é o que permite:

- rodar a **mesma** simulação no navegador e em um processo Node;
- calibrar com milhares de posses em segundos, sem render;
- manter testes de integração que jogam partidas inteiras em `node:test`;
- simular uma temporada de 82 jogos em ~180 ms.

## Dois relógios

| Relógio | Frequência | O que roda |
|---|---|---|
| Físico | 120 Hz (passo fixo) | Locomoção, contato, bola, progresso de ação, fadiga |
| Decisão | 12 Hz | Percepção de quadra, decisão da IA, atributos efetivos |

O corpo é contínuo; a cabeça decide em intervalos. É o que produz o atraso de
reação natural do defensor sem precisar de um `reactionDelay` artificial.

O tique de decisão também é onde os atributos efetivos são recalculados
(fadiga, adrenalina, takeover, badges) — fazer isso a 120 Hz custava mais que a
física inteira.

## Integração simultânea

```
1. calcular TODAS as intenções sobre o mesmo instante
2. aplicar contenção defensiva sobre as posições do início do passo
3. mover todos os corpos
4. resolver contatos
5. mover a bola
6. progredir ações
```

Integrar ator por ator na ordem da lista dava vantagem sistemática ao time que
vinha depois. O teste de espelho encontrou isso.

## Fluxo de uma posse

```
beginPossession
   ├─ assignMatchups (quem marca quem)
   ├─ callPlay (treinador escolhe o set)
   └─ assignRoles (quem é handler, big, shooter…)

a cada tique de decisão:
   buildCourtView  →  espaçamento, linhas, gravidade, mismatch
   decideOnBall    →  valor esperado: arremessar | penetrar | passar | criar | postar
   decideOffBall   →  papel na jogada, com abandono por leitura melhor
   decideDefense   →  marcação, cobertura de PnR, ajuda, boxout

a cada passo físico:
   stepLocomotion  →  momentum, atrito, equilíbrio, pés
   applyCutoff     →  contenção física do defensor
   resolveContacts →  impulso, classificação, julgamento de falta
   stepBall        →  gravidade, arrasto, Magnus, aro, tabela
   progressActions →  release de arremesso, passe, finalização
```

## Fluxo de um evento

Um único `EventLog` alimenta tudo:

```
GameSim → EventLog ─┬→ BoxScore (estatística)
                    ├→ HUD (ticker, flashes)
                    ├→ AudioEngine (rede, apito, torcida)
                    ├→ Camera (shake em lances de impacto)
                    └→ highlights() (seleção por drama, base do replay)
```

Isso evita o problema clássico de ter três fontes de verdade sobre o que
aconteceu na jogada.

## Onde o estado vive

| Estado | Onde | Escopo |
|---|---|---|
| Perfil do atleta | `PlayerProfile` | entre partidas |
| Corpo em quadra | `Actor` | uma partida |
| Gameplan da partida | `GameSim.gameplans` | uma partida (cópia) |
| Vitórias e derrotas | `Team` / `SeasonState` | temporada |
| Progressão | `ProgressionState` | carreira |

A cópia do gameplan é deliberada: o treinador ajusta o plano durante o jogo, e
se ele escrevesse no objeto da liga, a próxima partida começaria contaminada —
e duas simulações com a mesma seed dariam resultados diferentes. Há teste para
isso.

## Como um corpo vira imagem

Nenhuma pose é animada à mão. O caminho é sempre este:

```
estado do ator            rig.ts                  shading.ts           body.ts
(pés plantados,     →   esqueleto de 21     →   cápsula com        →  ordem por
 fase da passada,       juntas, IK de           gradiente da          profundidade,
 quadril, ombros,       duas ossadas,           seção do             cabeça, número,
 olhar, equilíbrio,     poses por ação          cilindro, luz        micro-reações
 ação em curso)                                 de arena
```

Três consequências que vale conhecer:

- **Não existe blending.** Como a pose é função do estado, e o estado é
  contínuo, a animação é contínua. Não há clipe para costurar nem transição
  para acertar.
- **O desenho não pode mentir.** O pé desenhado é o pé que o simulador
  plantou; a mão de drible está onde a bola está. Se a física escorregar, a
  imagem escorrega junto — e é assim que se descobre o bug.
- **A luz é uma só.** `ARENA_LIGHT` decide o gradiente do corpo, a direção da
  sombra no chão e o lado do contraluz. Mudar a direção muda as três coisas
  juntas, que é o que impede a cena de se desmontar.

## Dois renderizadores

O mesmo esqueleto alimenta dois caminhos de desenho:

| | `src/client/gl/` (WebGL2) | `src/client/render/` (Canvas 2D) |
|---|---|---|
| Oclusão | z-buffer, por pixel | ordenação por profundidade, por objeto |
| Luz | Cook-Torrance por pixel | gradiente aproximando a seção do cilindro |
| Sombra | shadow map com PCF | cápsulas projetadas na direção da luz |
| Corpos | malhas instanciadas (uma chamada para os ~130 ossos) | um preenchimento por osso |

O WebGL2 é o padrão. O 2D entra quando não há WebGL2 **ou** quando o 3D se
prova lento: o cliente mede o tempo de quadro durante a partida e, abaixo de
25 fps, troca o canvas e avisa no ticker. WebGL2 existir não garante que
exista GPU — máquina virtual, driver na lista negra ou aceleração desligada
caem num rasterizador por software que roda a menos de 10 fps. Um jogo a
8 fps é pior que um jogo 2D a 60.

## Determinismo

Toda aleatoriedade passa por `Rng` semeado. Dada a mesma seed e o mesmo estado
inicial, a partida se repete exatamente — incluindo a contagem de eventos.
Isso é o que torna possível investigar um bug de simulação.
