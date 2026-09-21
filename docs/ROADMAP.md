# Roadmap

Ordenado por impacto sobre a sensação de jogo, não por facilidade.

## Prioridade 1 — fechar a calibração

| Item | Situação | O que fazer |
|---|---|---|
| Ritmo ~15% acima do alvo | Posses em ~118, alvo 100 | Reduzir devolução de posse: rebote ofensivo e bolas fora. |
| Erros de posse acima do alvo | ~20 contra ~13 | A maior fatia ainda é bola fora; adicionar tentativa de salvamento perto da linha. |
| Roubos abaixo do alvo | ~5 contra ~8 | Aumentar a janela de tentativa sem reabrir a amplificação de talento. |
| Margem média alta | ~19 pontos contra ~12 | Continuar comprimindo a diferença por atributo nos sistemas de alta variância. |

## Prioridade 1.5 — distribuição de arremesso

O controle de uso já impede que um atleta domine (máximo caiu de 44 para ~23
tentativas), mas a curva entre titular e reserva ainda é mais plana que a real.
A tendência pessoal deveria pesar mais na fatia de posse.

## Prioridade 2 — completar sistemas já iniciados

- **Alley-oop:** fechar o ciclo passe → recepção aérea → finalização no motor.
- **Step-through:** ligar pump fake e step-through à decisão da IA e ao input.
- **Especialidades de takeover:** hoje todas dão o mesmo bônus; cada uma deve
  ter efeito próprio.
- **Lesões:** a carga acumulada já é medida; falta gerar o evento e a ausência.
- **Treinador adaptativo:** implementado, falta ligar ao loop do modo treino.
- **Loadouts de badge:** existem no modelo, faltam na interface.

## Prioridade 2.5 — celular

O jogo ja roda e e jogavel no celular (controles de toque, layout responsivo,
tela cheia, instalavel na tela de inicio). Falta:

- **Vibracao** em contato forte, toco e cesta decisiva (`navigator.vibrate`).
- **Ajuste de tamanho e posicao dos botoes** pelo usuario, para maos diferentes.
- **Canhoto:** espelhar analogico e botoeira.
- **Medicao de desempenho em aparelho real** — o teste atual usa emulacao de
  toque em Chromium de desktop, que nao diz nada sobre FPS num celular de
  entrada.

## Prioridade 3 — apresentação

- Replay visual com o diretor de câmera que já seleciona os lances por drama.
- Pré-jogo, intervalo e pós-jogo.
- Mais micro-reações desenhadas (o sistema de cues já emite os eventos).
- Comentário em texto mais denso, usando contexto de série e histórico.

## Prioridade 4 — conteúdo

- Modo rua com variantes de regra (21, make-it-take-it, king of the court).
- Hub social e equipes.
- Ligas customizadas e editor de regras.
- Modo de coleção.

## Prioridade 5 — online

Exige servidor autoritativo com reconciliação de estado. Só faz sentido depois
que a simulação estiver congelada: cada mudança de física invalidaria o
protocolo.

---

## Débito técnico conhecido

- `GameSim` é uma classe grande (~1400 linhas). Vale extrair a resolução de
  arremesso/finalização e a máquina de bola morta.
- O renderizador desenha corpo a corpo sem batching; em telas grandes com
  qualidade alta há espaço para agrupar por primitiva.
- `quicksim` duplica parte do modelo de eficiência do motor físico. O ideal é
  derivar seus coeficientes automaticamente da calibração do motor.
