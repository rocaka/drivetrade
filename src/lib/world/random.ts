/** Stateless indexed randomness: UI calls and rejected orders never consume a stream. */
export function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  return (h ^ (h >>> 16)) >>> 0;
}
export function random(seed: string, stream: string, index: number | string): number {
  return hash(`${seed}|${stream}|${index}`) / 4294967296;
}
export function pick<T>(
  items: readonly T[],
  seed: string,
  stream: string,
  index: number | string,
): T {
  return items[Math.min(items.length - 1, Math.floor(random(seed, stream, index) * items.length))];
}
