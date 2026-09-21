# Controles

O mesmo sistema atende toque, teclado e controle. O que muda é quanto dele fica
exposto — não existe "modo fácil" separado.

## Celular (toque)

Os controles aparecem sozinhos quando o jogo detecta uma tela de toque.

| Ação | Gesto |
|---|---|
| Mover | Toque e arraste em **qualquer ponto da metade esquerda** — o analógico nasce onde o dedo encostar |
| Correr | Empurre o analógico até o fim do curso (ou segure `CORRER`, na defesa) |
| Arremessar | Segure `ARR`, **arraste para baixo** e solte no tempo certo |
| Arremesso simples | Se preferir, apenas segure `ARR` e solte: o medidor enche sozinho |
| Passar | Toque em `PASSE` |
| Passe alto / alley-oop | Segure `ATACAR` e toque em `PASSE` |
| Atacar a cesta | Segure `ATACAR` |
| Move de drible | Arraste `DRIBLE` na direção: lados = crossover, cima = hesitation, baixo = stepback |
| Jogo de costas | Segure `POSTE` |
| Pedir bloqueio | Toque em `BLOQ.` |
| Roubar / tocar | Na defesa a botoeira **troca sozinha**: `ROUBO` e `TOCO` |
| Trocar de jogador | Toque em `TROCAR` (defesa) |

Três decisões de design que valem explicar:

- **O analógico é flutuante.** Num celular você não vê onde o polegar está; exigir
  mira num alvo fixo faria você errar o controle toda hora.
- **Correr não gasta um botão.** É o fim do curso do analógico, como em quase todo
  jogo de esporte no celular.
- **A botoeira troca sozinha entre ataque e defesa.** Não cabem as duas na tela, e
  um botão de "alternar modo" seria uma coisa a mais para errar no meio da jogada.

O jogo pede a tela **na horizontal**: basquete em retrato não dá leitura de quadra.

## Teclado

| Ação | Tecla |
|---|---|
| Mover | `W` `A` `S` `D` ou setas |
| Correr | `Shift` |
| Arremessar (ritmo) | Segurar e soltar `Espaço` |
| Passar | `J` |
| Atacar a cesta | `K` |
| Roubar (defendendo) | `J` |
| Tocar (defendendo) | `Espaço` |
| Jogo de costas | `L` |
| Pedir bloqueio | `E` |
| Trocar de jogador | `Q` |
| Move de drible | `Z` / `X` |
| Trocar câmera | `C` |
| Tempo técnico | `T` |
| Falta intencional | `F` |
| Pausar | `Esc` |

## Controle

| Ação | Botão |
|---|---|
| Mover | Analógico esquerdo |
| Correr | `RT` |
| Arremessar (ritmo) | Analógico direito para baixo, soltar no tempo |
| Drible | Analógico direito (lateral, cima, diagonal para trás) |
| Passar | `A` |
| Atacar a cesta | `B` |
| Roubar | `X` |
| Tocar | `Y` |
| Jogo de costas | `LT` |
| Pedir bloqueio | `RB` |
| Trocar de jogador | `LB` |

## Como o arremesso de ritmo funciona

1. **Início** — segurar começa a subida do corpo.
2. **Tempo** — o sistema amostra a continuidade do movimento. Puxada suave e
   contínua melhora o ritmo; travar ou recuar no meio piora.
3. **Soltura** — o instante em que você solta é comparado ao release ideal.

O ritmo **aumenta a janela verde**; marcação, desequilíbrio e fadiga a
**encolhem**. Soltar cedo deixa a bola curta; soltar tarde, longa — e a bola
realmente vai curta ou longa na tela.

## Drible no analógico direito

| Gesto | Move |
|---|---|
| Lateral | Crossover |
| Lateral + `RT` | Behind the back |
| Para cima | Hesitation |
| Para baixo + diagonal | Stepback |

Cada move tem duração, direção de saída, quanto "vende" a direção errada e
quanto expõe a bola. Repetir o mesmo move encarece o próximo (anti-cheese): a
stamina e a adrenalina sobem de custo e a defesa se adapta.
