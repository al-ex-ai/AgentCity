// Squarified treemap layout of the directory tree.

/**
 * @typedef {{ name: string, children: Map<string, Dir>, files: string[], weight?: number }} Dir
 * @typedef {{ x: number, y: number, w: number, h: number }} Rect
 */

/**
 * Build a directory tree from file paths.
 * @param {string[]} paths
 * @returns {Dir}
 */
export function buildTree(paths) {
  /** @type {Dir} */
  const root = { name: '', children: new Map(), files: [] };
  for (const p of paths) {
    const parts = p.split('/');
    let node = root;
    for (const d of parts.slice(0, -1)) {
      if (!node.children.has(d)) node.children.set(d, { name: d, children: new Map(), files: [] });
      node = /** @type {Dir} */ (node.children.get(d));
    }
    node.files.push(p);
  }
  return root;
}

/**
 * Squarified treemap (Bruls, Huizing, van Wijk) of weighted items inside a rectangle.
 * @template {{ weight: number }} T
 * @param {T[]} items
 * @param {Rect} rect
 * @returns {(Rect & { item: T })[]}
 */
export function squarify(items, rect) {
  const list = items.filter(i => i.weight > 0).sort((a, b) => b.weight - a.weight);
  const total = list.reduce((s, i) => s + i.weight, 0);
  /** @type {(Rect & { item: T })[]} */
  const out = [];
  if (!total || rect.w <= 0 || rect.h <= 0) return out;
  const scale = (rect.w * rect.h) / total;
  let { x, y, w, h } = rect;
  /** @type {T[]} */
  let row = [];

  const worst = (/** @type {T[]} */ r, /** @type {number} */ side) => {
    const areas = r.map(i => i.weight * scale);
    const s = areas.reduce((a, b) => a + b, 0);
    return Math.max((side * side * Math.max(...areas)) / (s * s), (s * s) / (side * side * Math.min(...areas)));
  };
  const place = (/** @type {T[]} */ r) => {
    const s = r.reduce((a, i) => a + i.weight * scale, 0);
    if (w >= h) {
      const cw = s / h; let cy = y;
      for (const item of r) { const ch = (item.weight * scale) / cw; out.push({ item, x, y: cy, w: cw, h: ch }); cy += ch; }
      x += cw; w -= cw;
    } else {
      const ch = s / w; let cx = x;
      for (const item of r) { const cw = (item.weight * scale) / ch; out.push({ item, x: cx, y, w: cw, h: ch }); cx += cw; }
      y += ch; h -= ch;
    }
  };

  for (const item of list) {
    const side = Math.min(w, h);
    if (!row.length || worst([...row, item], side) <= worst(row, side)) row.push(item);
    else { place(row); row = [item]; }
  }
  if (row.length) place(row);
  return out;
}

/**
 * Lay out files as buildings inside nested folder districts.
 * @param {string[]} paths
 * @param {(p: string) => number} weightOf  footprint weight per file, usually lines
 * @param {number} size side length of the city
 */
export function layoutCity(paths, weightOf, size = 1000) {
  const root = buildTree(paths);
  const weigh = (/** @type {Dir} */ d) => {
    if (d.weight !== undefined) return d.weight;
    d.weight = d.files.reduce((s, f) => s + weightOf(f), 0) + [...d.children.values()].reduce((s, c) => s + weigh(c), 0);
    return d.weight;
  };
  weigh(root);

  /** @type {{ path: string, depth: number, x: number, y: number, w: number, h: number }[]} */
  const districts = [];
  /** @type {Map<string, Rect>} */
  const files = new Map();
  const r2 = (/** @type {number} */ n) => Math.round(n * 100) / 100;

  const visit = (/** @type {Dir} */ dir, /** @type {Rect} */ rect, /** @type {number} */ depth, /** @type {string} */ path) => {
    if (depth > 0) districts.push({ path, depth, x: r2(rect.x), y: r2(rect.y), w: r2(rect.w), h: r2(rect.h) });
    const pad = depth === 0 ? 0 : Math.min(Math.min(rect.w, rect.h) * 0.04 + size * 0.002, Math.min(rect.w, rect.h) / 4);
    const inner = { x: rect.x + pad, y: rect.y + pad, w: rect.w - 2 * pad, h: rect.h - 2 * pad };
    const items = [
      ...[...dir.children.values()].map(c => ({ weight: /** @type {number} */ (c.weight), dir: c, file: '' })),
      ...dir.files.map(f => ({ weight: weightOf(f), dir: null, file: f })),
    ];
    for (const r of squarify(items, inner)) {
      if (r.item.dir) visit(r.item.dir, r, depth + 1, path ? `${path}/${r.item.dir.name}` : r.item.dir.name);
      else {
        const gap = Math.min(r.w, r.h) * 0.1;
        files.set(r.item.file, { x: r2(r.x + gap), y: r2(r.y + gap), w: r2(Math.max(0, r.w - 2 * gap)), h: r2(Math.max(0, r.h - 2 * gap)) });
      }
    }
  };
  visit(root, { x: 0, y: 0, w: size, h: size }, 0, '');
  return { size, districts, files };
}
