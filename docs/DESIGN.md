# Decisões de design

Este documento explica **por que** cada sistema é do jeito que é. Onde houve
escolha, o trade-off está declarado.

---

## 1. O input não define a velocidade

O comando do analógico define a velocidade **desejada**. Entre o desejo e o
corpo existem quatro filtros:

1. **Aceleração limitada** pelo atributo e pela fadiga.
2. **Inércia** derivada da massa efetiva e da agilidade.
3. **Atrito disponível** no pé plantado (`μ ≈ 1,62 × g`), que é um teto duro.
4. **Equilíbrio**, que reduz a força de apoio quando o corpo está torto.

Consequência: um pivô de 120 kg não inverte a direção como um armador de 85 kg,
e pedir mais atrito do que o solado oferece faz o atleta escorregar — o excesso
vira deslizamento e perda de equilíbrio, nunca teleporte.

**Trade-off:** o jogo é menos "responsivo" no sentido arcade. Foi deliberado:
a seção 126 do escopo pede que o comando atravesse corpo, pé, momentum e bola.

---

## 2. Foot planting é um portão físico, não um detalhe visual

Cada pé tem posição própria no mundo. A passada avança por fase, e quando um pé
pousa, ele **fica onde pousou**. O orçamento de aceleração é multiplicado pela
eficiência da planta: cortar no meio do voo da passada custa quase metade da
força disponível.

Isso resolve dois problemas de uma vez: elimina o corte "flutuante" e dá ao
renderizador posições reais para desenhar as pernas, o que remove a patinação
sem precisar de sistema de animação.

---

## 3. Ankle breaker é geometria, não sorteio

A maioria das implementações sorteia uma animação quando um drible "acerta".
Aqui o sistema mede:

```
leverage = −(peso comprometido do defensor) · (direção de saída do atacante)
```

Se o defensor não se comprometeu, `leverage ≈ 0` e **não existe quebra**, por
melhor que seja o move. Se ele jogou o peso para a esquerda e o atacante sai
pela direita em velocidade, a quebra é quase certa. Momentum bruto, proximidade,
capacidade de recuperação lateral e habilidade do atacante entram como termos
separados.

O teste `ankle breaker nao acontece contra defensor que nao se comprometeu`
trava esse comportamento.

---

## 4. O sorteio do arremesso acontece uma vez, e a física encena

Cada arremesso passa por contest multinível → janela verde → probabilidade com
dez termos → **um sorteio** → construção da trajetória.

A trajetória é resolvida com um solver que considera arrasto e efeito Magnus
(a fórmula balística pura erra ~40 cm em 7 m). Um erro recebe desvio coerente
com a causa: curto por fadiga, longo por soltar tarde, lateral por marcação de
lado. A bola então bate no aro, no vidro ou passa reto — de verdade.

**Trade-off:** a bola não decide sozinha se entra. Em troca, a estatística é
calibrável e a trajetória continua fisicamente correta. Sem isso, calibrar
aproveitamento seria impossível e o jogo produziria 20% de acerto (foi
exatamente o que aconteceu antes da correção — ver `docs/CALIBRACAO.md`).

---

## 5. Badges descrevem situações, não atributos

Uma badge genérica ("melhora arremesso") é um atributo disfarçado. Aqui cada
badge declara a **situação** em que atua, e o sistema só consulta a chave de
efeito naquele contexto:

```ts
if (attempt.type === 'catch_and_shoot') badgeBonus += bv(a, 'shot.catchShoot');
if (attempt.type === 'pullup')          badgeBonus += bv(a, 'shot.offDribble');
```

O teste `badge de catch-and-shoot nao melhora arremesso apos drible` garante
que a especialização não vaze.

As fichas de badge são pré-compiladas uma vez por atleta (`compileBadges`)
porque somar efeitos a 120 Hz custava mais que a física inteira.

---

## 6. O físico muda o custo, nunca o atributo

No builder, altura, peso e envergadura alteram:

- a **física** (alcance, massa, inércia, centro de massa);
- o **custo** de cada atributo.

Nunca o valor do atributo. Um pivô de 2,16 m paga ~2× mais caro por controle de
bola e ~40% mais barato por toco. É o tradeoff real da seção 42, e está coberto
por teste.

---

## 7. A IA decide por valor esperado, não por árvore de regras

Com a bola, a IA compara arremessar, penetrar, passar, criar e postar. Cada
opção produz um valor que combina qualidade, risco e **tendência pessoal**.
Dois atletas com atributos idênticos e tendências diferentes jogam diferente.

Sem bola, cada um executa seu papel na jogada chamada — mas **abandona o papel**
quando lê vantagem melhor: defensor de costas vira corte backdoor; penetração
vindo na direção vira reposicionamento.

---

## 8. Dificuldade muda inteligência, não números

Os cinco níveis alteram tempo de reação, qualidade de leitura, consistência de
timing, disciplina e adaptabilidade da IA, além da assistência dada ao humano.
Nenhum nível infla atributos da CPU. É a seção 83 levada a sério.

---

## 9. Tudo que balanceia vive em um arquivo

`src/core/config/tuning.ts` concentra ~150 constantes. Nenhum sistema hardcoda
valor de gameplay. Isso é o que torna possível: sliders, presets de dificuldade,
modo simulação/arcade, **eras históricas** (cada uma é um patch de tuning) e o
ciclo de calibração inteiro.

---

## 10. O núcleo não conhece o cliente

`src/core/` não importa nada de `src/client/` e não toca em DOM. Por isso a
mesma simulação roda no navegador e em um processo Node headless — o que
permitiu rodar milhares de posses para calibrar e manter uma suíte de testes de
integração que joga partidas inteiras.

---

## 11. Integração simultânea

Todas as intenções de movimento são calculadas sobre o mesmo instante e só
depois os corpos avançam. Integrar ator por ator na ordem da lista dava
vantagem sistemática ao time que vinha depois (ele reagia a posições já
atualizadas). O teste de espelho encontrou isso.

---

## 12. O que foi deliberadamente deixado de fora

| Não implementado | Por quê |
|---|---|
| Sistema de animação com rig, blending e IK | Exige pipeline de assets 3D; o projeto entrega movimento derivado da física e desenho procedural. |
| Render fotorrealista | Canvas 2D sem assets. A escolha foi legibilidade espacial em vez de fidelidade. |
| Multiplayer e netcode | Exige servidor autoritativo; nada de meia-boca foi colocado no lugar. |
| Hub aberto, rua, coleção de cartas | Escopo de conteúdo, não de sistema. Preferiu-se profundidade no que existe. |

Nenhum desses aparece como botão decorativo no menu. A seção 135 do escopo é
explícita: se não está implementado, não finge que está.
