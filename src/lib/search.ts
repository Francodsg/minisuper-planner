/** Normaliza texto: minúsculas, sin acentos/diacríticos, espacios colapsados. */
export function normalize(text: string | null | undefined): string {
  return (text ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Clave para detectar duplicados exactos: nombre|marca|presentación. */
export function dedupeKey(name: string, brand?: string | null, presentation?: string | null): string {
  return [normalize(name), normalize(brand), normalize(presentation)].join('|');
}

/** Todas las palabras de la consulta deben aparecer (como fragmento) en algún campo. */
export function matchesQuery(query: string, fields: Array<string | null | undefined>): boolean {
  const q = normalize(query);
  if (!q) return true;
  const hay = normalize(fields.filter(Boolean).join(' '));
  return q.split(' ').every((token) => hay.includes(token));
}

/** Puntuación sencilla de relevancia (mayor = mejor). */
export function relevance(query: string, name: string, others: Array<string | null | undefined>): number {
  const q = normalize(query);
  if (!q) return 0;
  const n = normalize(name);
  if (n === q) return 100;
  if (n.startsWith(q)) return 80;
  if (n.includes(q)) return 60;
  return matchesQuery(q, [name, ...others]) ? 30 : 0;
}

/** Detecta posibles duplicados (mismo nombre normalizado o nombre muy parecido). */
export function similarity(a: string, b: string): number {
  const x = normalize(a), y = normalize(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  const bigrams = (s: string) => {
    const out: string[] = [];
    for (let i = 0; i < s.length - 1; i++) out.push(s.slice(i, i + 2));
    return out;
  };
  const bx = bigrams(x), by = bigrams(y);
  const pool = [...by];
  let hits = 0;
  for (const g of bx) {
    const idx = pool.indexOf(g);
    if (idx >= 0) { hits++; pool.splice(idx, 1); }
  }
  return (2 * hits) / (bx.length + by.length || 1);
}
