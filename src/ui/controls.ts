/**
 * Console rows. Every control is one line of monospace text drawn with glyphs, focusable,
 * keyboard operable (arrows adjust, Enter activates), and clickable or draggable.
 */

export interface Row {
  el: HTMLElement;
  focusable: boolean;
  update(): void;
  adjust?(dir: number, coarse: boolean): void;
  activate?(): void;
  key?(e: KeyboardEvent): boolean;
  /** Rows that update on a timer (meters, countdowns). */
  live?: boolean;
  /** Element to add to the panel, if not el itself (null: already inside another row's mount). */
  mount?: HTMLElement | null;
}

export const LABEL_W = 15;
export const BAR_W = 20;

const h = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = '') => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};

function rowEl(label: string, role: string) {
  const el = h('div', 'row');
  el.tabIndex = 0;
  el.setAttribute('role', role);
  el.setAttribute('aria-label', label);
  const lab = h('span', 'label', label.padEnd(LABEL_W).slice(0, LABEL_W));
  el.append(lab);
  return el;
}

export function bar(frac: number, width = BAR_W) {
  const k = Math.round(Math.max(0, Math.min(1, frac)) * width);
  return '█'.repeat(k) + '░'.repeat(width - k);
}

export interface SliderOpts {
  label: string;
  min: number;
  max: number;
  step?: number;
  get(): number;
  set(v: number): void;
  fmt?(v: number): string;
  /** Map between value and bar position (for nonlinear ranges). */
  toFrac?(v: number): number;
  fromFrac?(f: number): number;
}

export function slider(o: SliderOpts): Row {
  const el = rowEl(o.label, 'slider');
  const b = h('span', 'bar');
  const fill = h('span', 'fill');
  const empty = h('span', 'empty');
  b.append(fill, empty);
  const val = h('span', 'value');
  el.append(h('span', 'punct', '['), b, h('span', 'punct', '] '), val);
  const toFrac = o.toFrac ?? ((v: number) => (v - o.min) / (o.max - o.min));
  const fromFrac = o.fromFrac ?? ((f: number) => o.min + f * (o.max - o.min));
  const step = o.step ?? (o.max - o.min) / 100;
  const snap = (v: number) => {
    v = Math.max(o.min, Math.min(o.max, v));
    return Math.round(v / step) * step;
  };
  const fmt = o.fmt ?? ((v: number) => (step >= 1 ? String(Math.round(v)) : v.toFixed(2)));
  const row: Row = {
    el,
    focusable: true,
    update() {
      const v = o.get();
      const k = Math.round(Math.max(0, Math.min(1, toFrac(v))) * BAR_W);
      setMono(fill, '█'.repeat(k));
      setMono(empty, '░'.repeat(BAR_W - k));
      val.textContent = fmt(v);
      el.setAttribute('aria-valuenow', String(v));
      el.setAttribute('aria-valuetext', fmt(v));
    },
    adjust(dir, coarse) {
      const v = o.get();
      if (o.toFrac) {
        const f = toFrac(v) + dir * (coarse ? 0.1 : 0.02);
        o.set(snap(fromFrac(Math.max(0, Math.min(1, f)))));
      } else {
        o.set(snap(v + dir * step * (coarse ? 10 : Math.max(1, Math.round((o.max - o.min) / step / 50)))));
      }
      row.update();
    },
  };
  el.setAttribute('aria-valuemin', String(o.min));
  el.setAttribute('aria-valuemax', String(o.max));
  const fromPointer = (e: PointerEvent) => {
    const r = b.getBoundingClientRect();
    const f = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    o.set(snap(fromFrac(f)));
    row.update();
  };
  b.addEventListener('pointerdown', (e) => {
    b.setPointerCapture(e.pointerId);
    fromPointer(e);
  });
  b.addEventListener('pointermove', (e) => {
    if (b.hasPointerCapture(e.pointerId)) fromPointer(e);
  });
  el.addEventListener('wheel', (e) => {
    e.preventDefault();
    row.adjust!(e.deltaY < 0 ? 1 : -1, false);
  }, { passive: false });
  return row;
}

export interface ChoiceOpts<T extends string | number> {
  label: string;
  options: { id: T; label: string }[] | (() => { id: T; label: string }[]);
  get(): T;
  set(v: T): void;
}

export function choice<T extends string | number>(o: ChoiceOpts<T>): Row {
  const el = rowEl(o.label, 'listbox');
  const prev = h('span', 'arrow', '‹ ');
  const val = h('span', 'value choice');
  const next = h('span', 'arrow', ' ›');
  el.append(prev, val, next);
  const opts = () => (typeof o.options === 'function' ? o.options() : o.options);
  const row: Row = {
    el,
    focusable: true,
    update() {
      const cur = opts().find((x) => x.id === o.get());
      val.textContent = cur?.label ?? String(o.get());
    },
    adjust(dir) {
      const list = opts();
      const i = list.findIndex((x) => x.id === o.get());
      o.set(list[(i + dir + list.length) % list.length].id);
      row.update();
    },
    activate() {
      row.adjust!(1, false);
    },
  };
  prev.addEventListener('click', (e) => {
    e.stopPropagation();
    row.adjust!(-1, false);
  });
  next.addEventListener('click', (e) => {
    e.stopPropagation();
    row.adjust!(1, false);
  });
  val.addEventListener('click', () => row.adjust!(1, false));
  return row;
}

export function toggle(label: string, get: () => boolean, set: (v: boolean) => void, note?: () => string): Row {
  const el = rowEl(label, 'switch');
  const box = h('span', 'value');
  const extra = h('span', 'note');
  el.append(box, extra);
  const row: Row = {
    el,
    focusable: true,
    live: !!note,
    update() {
      const on = get();
      setMono(box, on ? '[■] on ' : '[ ] off');
      el.setAttribute('aria-checked', String(on));
      extra.textContent = note ? `  ${note()}` : '';
    },
    adjust(dir) {
      set(dir > 0);
      row.update();
    },
    activate() {
      set(!get());
      row.update();
    },
  };
  box.addEventListener('click', () => row.activate!());
  return row;
}

export function button(label: string, action: () => void, hint = ''): Row {
  const el = h('div', 'row');
  el.tabIndex = 0;
  el.setAttribute('role', 'button');
  el.setAttribute('aria-label', label);
  const b = h('span', 'button', `[ ${label} ]`);
  el.append(b);
  if (hint) el.append(h('span', 'note', `  ${hint}`));
  el.addEventListener('click', action);
  return { el, focusable: true, update() {}, activate: action };
}

export function buttons(items: { label: string; action: () => void }[]): Row[] {
  // A line of several buttons; each is its own focus stop.
  const line = h('div', 'row-group');
  return items.map((it, i) => {
    const el = h('span', 'button inline', `[ ${it.label} ]`);
    el.tabIndex = 0;
    el.setAttribute('role', 'button');
    el.addEventListener('click', it.action);
    line.append(el);
    // The first button mounts the whole line; the rest live inside it.
    return { el, mount: i === 0 ? line : null, focusable: true, update() {}, activate: it.action };
  });
}

export function info(text: () => string, cls = 'info', live = false): Row {
  const el = h('div', `row static ${cls}`);
  return {
    el,
    focusable: false,
    live,
    update() {
      setMono(el, text());
    },
  };
}

export function heading(text: string): Row {
  const el = monoEl('div', 'row static heading', `── ${text} `.padEnd(62, '─'));
  return { el, focusable: false, update() {} };
}

export function colorRow(label: string, get: () => string, set: (hex: string) => void): Row {
  const el = rowEl(label, 'button');
  const sw = monoEl('span', 'swatch', '██');
  const val = h('span', 'value');
  const input = h('input');
  input.type = 'color';
  input.className = 'hidden-color';
  input.tabIndex = -1;
  input.addEventListener('input', () => {
    set(input.value);
    row.update();
  });
  el.append(sw, h('span', '', ' '), val, input);
  const row: Row = {
    el,
    focusable: true,
    update() {
      const c = get();
      sw.style.color = c;
      val.textContent = c;
      input.value = c;
    },
    activate() {
      input.click();
    },
  };
  el.addEventListener('click', () => row.activate!());
  return row;
}

export { h };

// The bundled font subset covers Latin and General Punctuation, not box drawing, blocks or
// shapes. Those fall back to other fonts with different advances, which would break the
// console's character grid, so each one is boxed into exactly one character cell.
const covered = (cp: number) => cp < 0x2100 || cp === 0x2191 || cp === 0x2193 || cp === 0x2122 || cp === 0x2212 || cp === 0x2215;

export function setMono(el: HTMLElement, text: string) {
  let plain = true;
  for (const ch of text) {
    if (!covered(ch.codePointAt(0)!)) {
      plain = false;
      break;
    }
  }
  if (plain) {
    if (el.textContent !== text) el.textContent = text;
    return;
  }
  const frag = document.createDocumentFragment();
  let buf = '';
  for (const ch of text) {
    if (covered(ch.codePointAt(0)!)) {
      buf += ch;
      continue;
    }
    if (buf) frag.append(buf);
    buf = '';
    const s = document.createElement('span');
    s.className = 'g';
    s.textContent = ch;
    frag.append(s);
  }
  if (buf) frag.append(buf);
  el.replaceChildren(frag);
}

/** Create an element whose text is laid out on a strict character grid. */
export function monoEl<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text: string) {
  const e = h(tag, cls);
  setMono(e, text);
  return e;
}
