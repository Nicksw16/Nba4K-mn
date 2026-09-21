# Calibração

Este documento registra **como** o jogo foi calibrado, **quais bugs o processo
encontrou** e **onde os números estão hoje** — incluindo o que ainda está fora
do alvo.

## Método

Um simulador de basquete pode parecer certo e estar completamente errado. Para
separar as duas coisas, o projeto usa três ferramentas:

### 1. Teste de espelho (`dist/src/cli/mirror.js`)

O **mesmo elenco** joga dos dois lados, várias partidas. Com rosters idênticos,
qualquer diferença sistemática entre casa e visitante é bug, não talento.

Foi essa ferramenta que expôs os três bugs mais graves do projeto:

| Sintoma | Causa real |
| --- | --- |
| Visitante cometia **3,4× mais faltas** com elenco idêntico | O desempate de "quem é o agressor" no contato comparava dois produtos escalares direto; no empate (dois corpos quase parados) culpava sempre o segundo ator da lista — e a lista é ordenada por time. |
| Casa vencia quase todo rebote e placar | A velocidade de aproximação estava calculada com sinal errado: `dot(a.vel, n) - dot(b.vel, n)` soma as duas aproximações em vez de compará-las. Um defensor parado levava a culpa de um atacante que entrava nele. |
| Assimetria residual em posse, rebote e falta | A integração era ator a ator na ordem da lista: o segundo time reagia a posições já atualizadas do primeiro. Passou a ser simultânea (calcular todas as intenções, depois mover todos). |

### 2. Diagnóstico de eventos (`dist/src/cli/diagnose.js`)

Conta eventos por tipo e compara **esperado × realizado**. Encontrou:

- **500 lances livres por jogo:** falta julgada a 120 Hz em vez de uma vez por
  episódio de contato.
- **1449 perdas de bola por jogo:** risco de fumble definido por segundo mas
  multiplicado por `dt * 60`.
- **FG% de 20% com 45% esperado:** bandejas e enterradas usavam trajetória plana
  e chegavam ao aro **ainda subindo** — a detecção de cesta exige a bola
  descendo pelo círculo, então toda bandeja "convertida" virava air ball.
- **Falta de bloqueio marcada contra quem atacava com a bola:** a lógica não
  separava responsabilidade ofensiva de defensiva.
- **240 faltas de "bola solta" por jogo:** qualquer encontrão fora da bola era
  classificado como disputa de bola solta.

### 3. Suíte de testes

59 testes cobrindo física, sistemas, integração de partida, franquia e
progressão. Os testes de estatística verificam **médias** de várias partidas,
não um jogo isolado: a calibração garante a distribuição, não cada resultado.

---

## Onde os números estão

Duas medições, porque elas contam coisas diferentes.

### Confrontos variados (`tune-report`) — o número honesto

Média por equipe por jogo, confrontos entre equipes de qualidades diferentes:

| Métrica | Atual | Alvo (liga profissional) | Desvio |
| --- | --- | --- | --- |
| Pontos | 104,4 | ~114 | −8% |
| Tentativas de quadra | 89,3 | ~88 | **na faixa** |
| Aproveitamento de quadra | 41,8% | ~47% | −5,2 pp |
| Tentativas de três | 32,8 | ~35 | −6% |
| Três pontos | 36,4% | ~36% | **na faixa** |
| Lances livres tentados | 22,3 | ~22 | **na faixa** |
| Lances livres convertidos | 80,1% | ~78% | **na faixa** |
| Erros de posse | 19,9 | ~13 | +53% |
| Assistências | 22,5 | ~26 | −13% |
| Rebotes | 54,7 | ~44 | +24% |
| Rebotes ofensivos | 16,9 | ~10 | +69% |
| Posses | 106,6 | ~100 | **+7%** |
| Faltas | 23,2 | ~19 | +22% |
| Roubos | 4,3 | ~8 | −46% |
| Tocos | 6,0 | ~5 | **na faixa** |
| Margem média | 10–20 | ~12 | **na faixa** |

### Espelho (`mirror`) — controle de simetria

Com elencos **idênticos** dos dois lados, casa e visitante ficam dentro do
ruído em todas as métricas. É esse teste que garante que nenhuma vantagem vem
da ordem de processamento.

### Leitura honesta

**Onde acertou:** volume de arremesso, distribuição de três, aproveitamento de
três, lances livres (volume e conversão), tocos, ritmo e margem de vitória
estão todos em faixa de liga real. A margem média era de **44 pontos** no
início da calibração e hoje fica entre 10 e 20 — ou seja, o problema de
massacres está resolvido.

**Onde ainda falta:**

1. **Aproveitamento 5 pontos abaixo.** O controle de uso (que impede um atleta
   de chutar 44 vezes) espalhou as tentativas para opções secundárias, que
   arremessam pior. Falta a IA ponderar melhor *quem* deve finalizar.
2. **Erros de posse 53% acima.** A maior fatia é bola que sai de quadra depois
   de rebote, desvio ou toco. Falta a tentativa de salvamento perto da linha.
3. **Rebotes ofensivos 69% acima.** A disputa ainda premia demais quem chega
   correndo em relação a quem já está posicionado.

Os itens 2 e 3 se resolvem no mesmo lugar — a disputa de posse solta — e estão
no topo do [roadmap](ROADMAP.md).

### O que foi necessário para chegar aqui

O caminho passou por três descobertas que só apareceram medindo:

- **Massacres de 44 pontos de margem** eram causados por dois fatores somados:
  a liga gerada tinha 18 pontos de overall entre a melhor e a pior equipe
  (o real é ~7), e as diferenças de atributo se multiplicavam entre sistemas
  (roubo × interceptação × fumble × aproveitamento). Estreitar a geração e
  comprimir a faixa por atributo nos sistemas de alta variância derrubou a
  margem para ~18–20 pontos.
- **Aproveitamento de 20%** com 45% esperado: bandejas chegavam ao aro ainda
  subindo e nunca registravam cesta.
- **500 lances livres por jogo:** falta julgada a 120 Hz em vez de uma vez por
  episódio de contato.

## Reproduzindo

```bash
npm run build
node dist/src/cli/mirror.js 8      # médias com elencos idênticos
node dist/src/cli/diagnose.js 2    # eventos por tipo e esperado × realizado
node dist/src/cli/sim-game.js demo # súmula completa de uma partida
```

Todos os valores de balanceamento vivem em `src/core/config/tuning.ts`. Nenhum
sistema hardcoda constante de gameplay — por isso a calibração é feita mexendo
em um arquivo e rodando as ferramentas acima.
