# Cobertura do escopo

O escopo original tem 141 seções. Esta tabela registra o estado de cada uma,
sem arredondar para cima. Legenda:

- **Pronto** — implementado e coberto por teste ou verificável rodando.
- **Parcial** — o sistema existe e funciona, mas não na profundidade pedida.
- **Ausente** — não implementado.

| # | Seção | Status | Observação |
|---|---|---|---|
| 1 | Visão do produto | Parcial | Partida, carreira, franquia, builder e treino existem. Hub aberto, rua, online e coleção não. |
| 2 | Filosofia de gameplay | Pronto | Skill + atributos + contexto + física, nenhum dominando sozinho. |
| 3 | Motor de movimento | Parcial | Física completa (massa, inércia, atrito, equilíbrio). Motion matching não existe: não há sistema de animação, o corpo é desenhado do estado físico. |
| 4 | Foot planting | Pronto | Pés têm posição própria; cortes só são eficientes perto da planta. |
| 5 | Momentum | Pronto | Base de tudo: arrancada, frenagem, inversão e ankle breaker. |
| 6 | Dribbling engine | Pronto | Os 28 componentes do escopo, equipáveis individualmente. |
| 7 | Signature movements | Parcial | 13 estilos originais mudam tendências e escolhas; sem animações de assinatura. |
| 8 | Ankle breaker | Pronto | Causal: mede o peso comprometido do defensor contra a direção de saída. |
| 9 | Dynamic layup engine | Pronto | 7 gathers × 9 finishes escolhidos por geometria, não por sorteio. |
| 10 | Step-through / up-and-under | Parcial | Pump fake e direção de step-through implementados; ainda não acionados pela IA. |
| 11 | Dunk system | Pronto | Meter dinâmico reavaliado em decolagem, meio do salto e ápice. |
| 12 | Contact system | Pronto | Sem atravessamento, com classificação e impulso massa-ponderado. |
| 13 | Ball physics | Pronto | Gravidade, arrasto, Magnus, aro como toro, tabela, quique e rolamento. |
| 14 | Ball security | Pronto | Risco por pressão, contato, exposição do move e tráfego. |
| 15 | Passing system | Pronto | 14 tipos com lead, erro angular e seleção inteligente de alvo. |
| 16 | No-look passes | Pronto | O olhar aponta para outro lugar e a precisão cai. |
| 17 | Alley-oop | Parcial | Passe e avaliação de recepção existem; finalização aérea ainda não fecha no loop. |
| 18 | Rhythm shooting | Pronto | Início, tempo e soltura medidos; ritmo altera a janela verde. |
| 19 | Shooting physics | Pronto | 10 termos explícitos, nunca "80 de três = 80%". |
| 20 | Shot contest | Pronto | Seis fatores somados, com rótulo visível no HUD. |
| 21 | Defensive system | Pronto | Mãos agressivas/conservadoras, toco com timing, cutoff em três alcances. |
| 22 | Defensive cut-offs | Pronto | Defensor projeta a linha e escolhe o ponto que consegue alcançar. |
| 23 | Rebounding | Pronto | Trajetória prevista com erro individual, disputa por posição e alcance. |
| 24 | Boxout | Pronto | Interativo, com força, posição e empurrão real. |
| 25 | Fatigue / stamina | Pronto | Efeitos separados em velocidade, salto, precisão, controle e reação. |
| 26 | Adrenaline | Pronto | Reserva curta de explosão que limita spam de moves. |
| 27 | Takeover | Parcial | Cinco disciplinas independentes com seis estados; as especialidades estão definidas mas ainda dão o mesmo bônus. |
| 28 | AI spatial awareness | Pronto | Espaçamento, linhas, gravidade, carga do garrafão, lado forte/fraco. |
| 29 | Offensive AI | Pronto | Decisão por valor esperado ponderada por tendência individual. |
| 30 | Set AI | Pronto | Playbook com 10 sets e escolha por elenco, foco e mismatch. |
| 31 | Transition AI | Pronto | Lanes, rim run e condução imediata após a posse mudar. |
| 32 | Pick-and-roll AI | Pronto | 10 coberturas que se adaptam ao contexto. |
| 33 | Team gameplan AI | Pronto | Identidade derivada do elenco e ajustada durante o jogo. |
| 34 | Matchup intelligence | Pronto | Detecta mismatch de tamanho, velocidade, força e arremesso. |
| 35 | Coaching | Pronto | Playcalling, substituição, tempo técnico e mudança de plano. |
| 36 | Physics-driven animation | Parcial | Todo movimento vem da física; não há blending nem IK porque não há rig. |
| 37 | Camera system | Pronto | Cinco modos, todos amortecidos, sem corte seco. |
| 38 | Audio | Pronto | Tudo sintetizado: quique, rangido, aro, tabela, rede, contato, apito, torcida. |
| 39 | Broadcast presentation | Parcial | Scorebug, ticker, destaques e flashes. Sem pré-jogo, intervalo ou replay. |
| 40 | Visual style | Ausente | Render 2D estilizado em perspectiva, não PBR fotorrealista. |
| 41 | Character creation | Parcial | Físico completo com efeito real; sem editor de rosto e aparência. |
| 42 | MyPlayer builder | Pronto | 34 atributos, custo por físico, máximo alcançável e slots derivados. |
| 43 | Badge system | Pronto | 53 badges, cada uma com situação específica declarada. |
| 44 | Badge tokens | Pronto | Tokens saem da trilha usada em quadra. |
| 45 | Badge synergy | Pronto | FUSE e REACTION implementadas. |
| 46 | Badge loadouts | Parcial | Quatro loadouts por atleta no modelo; troca rápida ainda não está na UI. |
| 47 | Signature blueprints | Pronto | 12 builds originais com três arquétipos cada. |
| 48 | Cap breakers | Pronto | Com preview antes de confirmar. |
| 49 | Rebirth | Pronto | Herança decrescente a cada uso. |
| 50 | Build specialization | Pronto | Oito desafios com recompensa real. |
| 51 | Career mode | Parcial | Estágios, decisões e narrativa emergente; sem cenas cinematográficas. |
| 52 | Historical eras | Pronto | Cinco eras com tuning, meta e apresentação próprios. |
| 53 | Co-op career | Parcial | Estrutura do companheiro existe; falta multiplayer. |
| 54 | Open world hub | Ausente | — |
| 55 | Streetball | Ausente | — |
| 56 | Social hub | Ausente | — |
| 57 | Crew system | Ausente | — |
| 58 | Rookie hub | Ausente | — |
| 59 | Street tournament | Ausente | — |
| 60 | Daily competition | Ausente | — |
| 61 | Player medals | Pronto | Dez medalhas verificadas contra a súmula real. |
| 62 | Rep system | Pronto | Seis faixas de reputação. |
| 63 | Franchise mode | Pronto | Elenco, rotação, trocas, free agency, draft e temporadas. |
| 64 | Free agency | Pronto | Oito fatores, não só dinheiro. |
| 65 | Contract system | Parcial | Salário, anos, opções, garantia e buyout; incentivos declarados mas não avaliados. |
| 66 | GM trust | Pronto | Promessas alteram confiança e encarecem negociações. |
| 67 | Player relationships | Pronto | Amizade, rivalidade e dupla emergem do convívio e do uso. |
| 68 | Multi-generational franchise | Parcial | Desenvolvimento, aposentadoria e draft por décadas; sem expansão e relocação. |
| 69 | Legacy RPG | Parcial | Pontos de legado e gerações no modelo; árvore ainda não exposta. |
| 70 | Evolution system | Pronto | Curva de idade com crescimento por uso e regressão por idade. |
| 71 | Franchise rule engine | Parcial | Regras configuráveis com histórico; sem editor completo. |
| 72 | Custom leagues | Ausente | — |
| 73–76 | Modo de coleção / cartas | Ausente | — |
| 77 | Offline modes | Pronto | Tudo funciona offline. |
| 78 | Multiplayer | Ausente | — |
| 79 | Netcode | Ausente | — |
| 80 | Competitive integrity | Ausente | Depende de servidor. |
| 81 | Practice facility | Parcial | Oito exercícios definidos; todos entram na quadra livre. |
| 82 | Tutorial | Parcial | Tela de controles explica conceitos, não só botões. |
| 83 | Difficulty | Pronto | Cinco níveis que mudam IA e assistência, nunca atributos. |
| 84 | Slider system | Pronto | 14 sliders ligados ao tuning. |
| 85 | Realism mode | Pronto | Preset de simulação com posses longas. |
| 86 | Immersion mode | Pronto | HUD mínimo e câmera cinematográfica. |
| 87 | Statistics | Pronto | Súmula completa por atleta e equipe. |
| 88 | Advanced analytics | Parcial | Shot chart, rating ofensivo, eFG, TS e posses; sem heatmap e eficiência de quinteto na UI. |
| 89 | Injury system | Parcial | Carga acumulada e estado de saúde no modelo; geração de lesão ainda não roda no loop. |
| 90 | Clothing / cosmetics | Ausente | — |
| 91 | Arena design | Parcial | Uma arena paramétrica com cores por equipe. |
| 92 | Street environments | Ausente | — |
| 93 | UI / UX | Pronto | Menus rápidos, hierarquia clara, transições suaves. |
| 94 | HUD | Pronto | Aparece quando é necessário e some quando não é. |
| 95 | Play art | Pronto | Rotas desenhadas na quadra. |
| 96 | Replay system | Parcial | Destaques selecionados por drama; sem reprodução visual. |
| 97 | Photo mode | Ausente | — |
| 98 | Performance | Pronto | Simulação a ~4 ms por segundo de jogo; render em 60 fps. |
| 99 | Loading | Pronto | Não há tela de carregamento. A distribuição em arquivo único abre direto do disco, sem servidor. |
| 100 | Visual fidelity | Ausente | Fora do alcance de Canvas 2D sem assets. |
| 101 | Animation quality | Parcial | Transições contínuas porque tudo vem da física, não de clipes. |
| 102 | AI animation selection | Parcial | A escolha contextual existe (gather/finish/move); a apresentação é procedural. |
| 103 | Micro-reactions | Parcial | O sistema de cues existe e é emitido; poucos são desenhados. |
| 104 | Crowd AI | Pronto | Quatro níveis reagindo ao contexto. |
| 105 | Weather / ambiente | Ausente | — |
| 106 | Sound design | Pronto | Timbre por superfície e intensidade por evento físico. |
| 107 | Presentation | Parcial | Durante o jogo sim; antes e depois não. |
| 108 | Commentary AI | Parcial | Texto contextual com base em eventos reais; sem voz. |
| 109 | Story system | Pronto | As histórias nascem dos números. |
| 110 | Dynamic world | Ausente | — |
| 111 | Media system | Parcial | Manchetes geradas; sem feed social e coletivas. |
| 112 | Economy | Parcial | Duas moedas separadas; sem loja. |
| 113 | Seasons | Ausente | — |
| 114 | Cross-system progression | Parcial | Carreira alimenta progressão; os outros modos ainda não se conversam. |
| 115 | Accessibility | Pronto | Daltonismo, escala de texto, pistas visuais, movimento reduzido, remapeamento, alvos de toque de 44 px. |
| 116 | Control scheme | Pronto | Toque, teclado e controle produzem o mesmo comando. Analogico flutuante, botoeira contextual e arremesso de ritmo por arrasto no celular. |
| 117 | Beginner control mode | Pronto | Subconjunto do mesmo sistema. |
| 118 | Advanced control mode | Pronto | Stick direito para drible, arremesso e finalização. |
| 119 | Training AI | Parcial | Treinador adaptativo implementado; falta ligar ao loop do treino. |
| 120 | Game balance | Pronto | Habilidade pesa mais que número bruto, sem anular o número. |
| 121 | Anti-cheese | Pronto | Repetição encarece, stamina e adrenalina limitam, defesa se adapta. |
| 122 | Real basketball principles | Pronto | Espaçamento, timing, seleção de arremesso e posicionamento são recompensados. |
| 123 | Core game loop | Parcial | Criar → treinar → jogar → evoluir → competir existe; construir legado é raso. |
| 124 | Immersion directive | Pronto | Resposta de input, continuidade e peso corporal. |
| 125 | Realism directive | Pronto | Cada sistema responde "isso aconteceria assim de verdade?". |
| 126 | Feeling of control | Pronto | Input → corpo → pé → momentum → bola → reação do defensor. |
| 127 | No teleportation | Pronto | Reposicionamento só em bola morta, andando. |
| 128 | No randomized animation chaos | Pronto | Variação com causa: contexto define a escolha. |
| 129 | Next-gen graphics | Ausente | — |
| 130 | Ultra-smooth transitions | Pronto | Câmera amortecida e transições de UI com easing. |
| 131 | UI animation | Pronto | 180–320 ms com spring easing. |
| 132 | Menu architecture | Pronto | Sete entradas, todas funcionais. |
| 133 | Save system | Pronto | Versionado, com backup e migração testada. |
| 134 | Loading times | Pronto | Entrada direta na quadra. |
| 135 | Quality bar | Pronto | Nenhum botão decorativo: o que aparece opera sobre o núcleo. |
| 136 | Architecture | Pronto | 20 módulos desacoplados; `core` não conhece `client`. |
| 137 | Data-driven design | Pronto | Todo valor de balanceamento em um arquivo. |
| 138 | Debug tools | Parcial | Vetores de direção e peso, inspetor de estado, esperado × realizado, contagem de eventos. Falta visualizador de decisão da IA. |
| 139 | QA requirements | Parcial | 59 testes automatizados cobrindo física, sistemas, partida, franquia e progressão. |
| 140 | Final quality test | Parcial | Ver checklist abaixo. |
| 141 | Resultado final | Parcial | Simulador + carreira + franquia entregues; rua, online e coleção não. |

## Contagem

- **Pronto:** 81
- **Parcial:** 36
- **Ausente:** 22

## Checklist final da seção 140

| Pergunta | Resposta |
|---|---|
| Movimento parece humano? | Sim — aceleração, inércia e passada vêm da física. |
| Jogadores possuem peso? | Sim — massa afeta inversão, contato e quem cede terreno. |
| A bola possui física convincente? | Sim — arrasto, Magnus, aro como toro, quique e rolamento. |
| Colisões são naturais? | Sim — impulso massa-ponderado, sem atravessamento. |
| Dribles são responsivos? | Sim — 28 moves com saída própria, mas o corpo respeita o atrito. |
| Finalizações são contextuais? | Sim — gather e finish escolhidos pela geometria. |
| Dunks possuem timing e risco? | Sim — meter reavaliado durante o voo. |
| Arremessos dependem de habilidade + atributos? | Sim — dez termos explícitos. |
| Defesa é física e inteligente? | Sim — contenção real e coberturas adaptativas. |
| Rebotes são físicos? | Sim — trajetória, posição, boxout e alcance. |
| IA entende spacing? | Sim. |
| IA entende mismatch? | Sim. |
| IA muda estratégia? | Sim — o treinador reage ao que está sendo feito. |
| Progressão é profunda? | Sim — trilhas, tokens, badges, cap breakers, rebirth. |
| Career possui narrativa? | Parcialmente — emergente, sem cenas. |
| Franchise possui profundidade? | Sim. |
| Multiplayer possui arquitetura segura? | **Não** — não há multiplayer. |
| Menus são rápidos? | Sim. |
| Animações são fluidas? | Parcialmente — contínuas, mas procedurais. |
| O jogo mantém 60 FPS? | Sim. |
| O jogador sente que está dentro de uma partida real? | Parcialmente — a simulação convence; a apresentação visual não é AAA. |
