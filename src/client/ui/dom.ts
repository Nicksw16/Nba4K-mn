/** Utilitarios minimos de DOM para as telas (sem framework). */

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> & { class?: string; text?: string; html?: string } = {},
  children: (Node | string | null | undefined)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null) continue;
    if (k === 'class') node.className = String(v);
    else if (k === 'text') node.textContent = String(v);
    else if (k === 'html') node.innerHTML = String(v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    else if (k in node) (node as unknown as Record<string, unknown>)[k] = v;
    else node.setAttribute(k, String(v));
  }
  for (const c of children) {
    if (c === null || c === undefined) continue;
    node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}

export function clear(node: HTMLElement): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

export function card(title: string, description: string, onClick: () => void): HTMLElement {
  return el('button', { class: 'card', onclick: onClick }, [
    el('h3', { text: title }),
    el('p', { text: description }),
  ]);
}

export function sliderRow(
  label: string,
  value: number,
  min: number,
  max: number,
  step: number,
  format: (v: number) => string,
  onChange: (v: number) => void,
): HTMLElement {
  const out = el('span', { class: 'value', text: format(value) });
  const input = el('input', {
    type: 'range',
    min: String(min),
    max: String(max),
    step: String(step),
    value: String(value),
    oninput: (e: Event) => {
      const v = Number((e.target as HTMLInputElement).value);
      out.textContent = format(v);
      onChange(v);
    },
  });
  return el('div', { class: 'row' }, [el('label', { text: label }), input, out]);
}

export function selectRow<T extends string>(
  label: string,
  value: T,
  options: { value: T; label: string }[],
  onChange: (v: T) => void,
): HTMLElement {
  const select = el('select', {
    onchange: (e: Event) => onChange((e.target as HTMLSelectElement).value as T),
  }, options.map((o) => el('option', { value: o.value, text: o.label, selected: o.value === value })));
  return el('div', { class: 'row' }, [el('label', { text: label }), select]);
}

export function textRow(label: string, value: string, onChange: (v: string) => void): HTMLElement {
  return el('div', { class: 'row' }, [
    el('label', { text: label }),
    el('input', { type: 'text', value, oninput: (e: Event) => onChange((e.target as HTMLInputElement).value) }),
  ]);
}

export function table(headers: string[], rows: (string | number)[][], highlight?: (row: number) => boolean): HTMLElement {
  return el('table', {}, [
    el('thead', {}, [el('tr', {}, headers.map((h) => el('th', { text: h })))]),
    el('tbody', {}, rows.map((r, i) => el('tr', { class: highlight?.(i) ? 'me' : '' }, r.map((c) => el('td', { text: String(c) }))))),
  ]);
}
