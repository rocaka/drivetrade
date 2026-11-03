import { memo } from "react";
import { avatarSeed } from "@/lib/world/identity";
import type { Token } from "@/lib/world/types";
import type { EasterEggKind } from "./easter-egg";

export type TokenAvatarProps = {
  token: Pick<Token, "id" | "address" | "name" | "symbol"> & { easterEgg?: EasterEggKind };
  size?: number;
  className?: string;
};
type Palette = readonly [background: string, ink: string, accent: string, light: string];
const palettes: readonly Palette[] = [
  ["#14243e", "#73a7ff", "#64dfcd", "#e9f4ff"],
  ["#252039", "#c29cff", "#ffb78a", "#f8eeff"],
  ["#17332e", "#6ee0b9", "#c6ed81", "#f0fff5"],
  ["#392224", "#ff9a9c", "#ffce83", "#fff0e8"],
  ["#332b19", "#f2cd65", "#a3d9a8", "#fff9df"],
  ["#173137", "#75d9eb", "#9fa9ff", "#eafaff"],
  ["#34233d", "#ed9bd5", "#a9bcff", "#fff0fb"],
  ["#24341d", "#a9dc77", "#f0cb8a", "#f5ffe9"],
  ["#392b22", "#f2ae7a", "#efde9c", "#fff5e9"],
  ["#1c2943", "#92c6ff", "#f1a9d2", "#eff5ff"],
  ["#213a35", "#8de7d0", "#f3bfa2", "#edfff9"],
  ["#302944", "#b5abff", "#8fe0da", "#f5f1ff"],
  ["#3b252e", "#f8a7c3", "#d7c981", "#fff1f5"],
  ["#252e33", "#b5d6df", "#f2d2a9", "#f7fbff"],
  ["#202e25", "#c4e4a7", "#7fd5cc", "#f5ffed"],
  ["#31251d", "#ffc586", "#a9bcf2", "#fff7ec"],
];
const cache = new Map<number, string>();
const CACHE_LIMIT = 768;
const easterEggBodies: Record<EasterEggKind, string> = {
  btc: '<rect width="64" height="64" rx="18" fill="#f7931a"/><g transform="rotate(12 32 32)" fill="#fff"><path fill-rule="evenodd" d="M21 18h15c13 0 15 12 6 15 12 3 7 15-5 15H21V18Zm7 6v6h7c6 0 6-6 0-6h-7Zm0 12v6h8c7 0 7-6 0-6h-8Z"/><path d="M27 12h4v8h-4zm8 0h4v8h-4zm-8 34h4v7h-4zm8 0h4v7h-4z"/></g>',
  eth: '<rect width="64" height="64" rx="18" fill="#241e3b"/><path d="M32 8 16 33l16 9 16-9Z" fill="#b9b2ef"/><path d="m32 8 16 25-16 9Z" fill="#8279bb"/><path d="m16 33 16-7 16 7-16 9Z" fill="#d8d6ee"/><path d="m32 26 16 7-16 9Z" fill="#a09acb"/><path d="m16 37 16 19 16-19-16 9Z" fill="#b9b2ef"/><path d="m32 46 16-9-16 19Z" fill="#8279bb"/>',
  sol: '<defs><linearGradient id="sol" x1="14" y1="47" x2="50" y2="17" gradientUnits="userSpaceOnUse"><stop stop-color="#9945ff"/><stop offset="1" stop-color="#14f195"/></linearGradient></defs><rect width="64" height="64" rx="18" fill="#11151f"/><path d="m20 15-7 7a1 1 0 0 0 .7 1.7H44a2 2 0 0 0 1.4-.6l7-7a1 1 0 0 0-.7-1.7H21.4a2 2 0 0 0-1.4.6Zm-6.3 12.6a1 1 0 0 0-.7 1.7l7 7a2 2 0 0 0 1.4.6h30.3a1 1 0 0 0 .7-1.7l-7-7a2 2 0 0 0-1.4-.6H13.7Zm6.3 14-7 7a1 1 0 0 0 .7 1.7H44a2 2 0 0 0 1.4-.6l7-7a1 1 0 0 0-.7-1.7H21.4a2 2 0 0 0-1.4.6Z" fill="url(#sol)"/>',
  doge: '<rect width="64" height="64" rx="18" fill="#bd9d39"/><circle cx="32" cy="32" r="24" fill="none" stroke="#e5d28a" stroke-width="1.5"/><path fill-rule="evenodd" d="M23 16h11c12 0 17 7 17 16s-5 16-17 16H23V16Zm7 6v20h4c7 0 10-4 10-10s-3-10-10-10h-4Z" fill="#fff7d9"/><path d="M17 29h21v5H17z" fill="#fff7d9"/>',
};
const easterEggUrls = new Map<EasterEggKind, string>();

function easterEggDataUrl(kind: EasterEggKind): string {
  const found = easterEggUrls.get(kind);
  if (found) return found;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">${easterEggBodies[kind]}</svg>`;
  const url = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  easterEggUrls.set(kind, url);
  return url;
}
function generator(seed: number) {
  let state = seed || 0x9e3779b9;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
}
const n = (value: number) => Number(value.toFixed(2));
const circle = (x: number, y: number, radius: number, fill: string) =>
  `<circle cx="${n(x)}" cy="${n(y)}" r="${n(radius)}" fill="${fill}"/>`;
function pixelMirror(random: () => number, colors: Palette) {
  let output = "";
  for (let row = 0; row < 7; row++)
    for (let column = 0; column < 4; column++) {
      if (random() < 0.28 && !(row === 3 && column === 3)) continue;
      const ink = random() < 0.68 ? colors[1] : colors[2];
      const y = 11 + row * 6;
      output += `<rect x="${11 + column * 6}" y="${y}" width="6" height="6" rx="1" fill="${ink}"/>`;
      if (column < 3)
        output += `<rect x="${11 + (6 - column) * 6}" y="${y}" width="6" height="6" rx="1" fill="${ink}"/>`;
    }
  return output;
}
function orbits(random: () => number, colors: Palette) {
  const angle = Math.floor(random() * 12) * 15;
  let output = `<g transform="rotate(${angle} 32 32)"><ellipse cx="32" cy="32" rx="23" ry="11" fill="none" stroke="${colors[1]}" stroke-width="2.5"/><ellipse cx="32" cy="32" rx="11" ry="23" fill="none" stroke="${colors[2]}" stroke-width="2.5"/>`;
  const satellites = 3 + Math.floor(random() * 3);
  for (let i = 0; i < satellites; i++) {
    const a = (i / satellites + random() * 0.15) * Math.PI * 2;
    output += circle(
      32 + Math.cos(a) * 23,
      32 + Math.sin(a) * 11,
      2.5 + random(),
      colors[(i % 2) + 1],
    );
  }
  output += circle(32, 32, 6 + random() * 3, colors[3]);
  return output + "</g>";
}
function constellation(random: () => number, colors: Palette) {
  const cells = Array.from({ length: 9 }, (_, i) => i);
  for (let i = cells.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [cells[i], cells[j]] = [cells[j], cells[i]];
  }
  const count = 5 + Math.floor(random() * 4);
  const points = cells
    .slice(0, count)
    .map((cell) => ({
      x: 15 + (cell % 3) * 17 + random() * 4 - 2,
      y: 15 + Math.floor(cell / 3) * 17 + random() * 4 - 2,
    }));
  let output = "";
  for (let i = 1; i < points.length; i++)
    output += `<line x1="${n(points[i - 1].x)}" y1="${n(points[i - 1].y)}" x2="${n(points[i].x)}" y2="${n(points[i].y)}" stroke="${colors[1]}" stroke-width="1.3" opacity="0.5"/>`;
  for (let i = 0; i < points.length; i++) {
    const { x, y } = points[i],
      radius = 2.8 + random() * 2.6;
    output +=
      i === 0
        ? `<polygon points="${n(x)},${n(y - radius - 2)} ${n(x + radius + 2)},${n(y)} ${n(x)},${n(y + radius + 2)} ${n(x - radius - 2)},${n(y)}" fill="${colors[3]}"/>`
        : circle(x, y, radius, colors[(i % 2) + 1]);
  }
  return output;
}
function tiles(random: () => number, colors: Palette) {
  let output = "";
  for (let row = 0; row < 2; row++)
    for (let column = 0; column < 2; column++) {
      const x = 10 + column * 24,
        y = 10 + row * 24,
        ink = colors[1 + ((row + column) % 2)];
      const shape = Math.floor(random() * 4),
        rotation = Math.floor(random() * 4) * 90;
      output += `<g transform="rotate(${rotation} ${x + 10} ${y + 10})">`;
      if (shape === 0)
        output +=
          `<rect x="${x}" y="${y}" width="20" height="20" rx="6" fill="${ink}"/>` +
          circle(x + 10, y + 10, 4, colors[0]);
      else if (shape === 1)
        output += `<polygon points="${x + 10},${y} ${x + 20},${y + 20} ${x},${y + 20}" fill="${ink}"/>`;
      else if (shape === 2)
        output +=
          circle(x + 10, y + 10, 10, ink) +
          `<rect x="${x + 10}" y="${y}" width="10" height="10" fill="${colors[0]}"/>`;
      else
        output += `<rect x="${x + 6}" y="${y}" width="8" height="20" rx="3" fill="${ink}"/><rect x="${x}" y="${y + 6}" width="20" height="8" rx="3" fill="${ink}"/>`;
      output += "</g>";
    }
  return output;
}
function rings(random: () => number, colors: Palette) {
  let output = "";
  for (let i = 0; i < 3; i++) {
    const radius = 11 + i * 7,
      count = 2 + Math.floor(random() * 5),
      circumference = Math.PI * radius * 2;
    const dash = (circumference / count) * (0.45 + random() * 0.3);
    output += `<circle cx="32" cy="32" r="${radius}" fill="none" stroke="${colors[(i % 2) + 1]}" stroke-width="3.5" stroke-linecap="round" stroke-dasharray="${n(dash)} ${n(circumference / count - dash)}" transform="rotate(${Math.floor(random() * 360)} 32 32)"/>`;
  }
  return (
    output +
    `<rect x="28" y="28" width="8" height="8" rx="2" fill="${colors[3]}" transform="rotate(45 32 32)"/>`
  );
}
function mosaic(random: () => number, colors: Palette) {
  let output = "";
  for (let row = 0; row < 4; row++)
    for (let column = 0; column < 4; column++) {
      const x = 8 + column * 12,
        y = 8 + row * 12;
      const ink = colors[random() < 0.5 ? 1 : 2];
      output +=
        random() < 0.5
          ? `<polygon points="${x},${y} ${x + 12},${y} ${x},${y + 12}" fill="${ink}"/>`
          : `<polygon points="${x + 12},${y} ${x + 12},${y + 12} ${x},${y + 12}" fill="${ink}"/>`;
      if (random() < 0.25) output += circle(x + 6, y + 6, 2, colors[3]);
    }
  return output;
}
const templates = [pixelMirror, orbits, constellation, tiles, rings, mosaic] as const;

/** Local SVGs use public identity only; ordinary tokens retain their address identicon. */
export function tokenAvatarDataUrl(
  token: Pick<Token, "id" | "address"> & { easterEgg?: EasterEggKind },
): string {
  if (token.easterEgg && Object.hasOwn(easterEggBodies, token.easterEgg))
    return easterEggDataUrl(token.easterEgg);
  const seed = avatarSeed(token);
  const found = cache.get(seed);
  if (found) return found;
  const random = generator(seed ^ 0xa5b35705);
  const colors = palettes[(seed >>> 8) % palettes.length];
  const body = templates[seed % templates.length](random, colors);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><rect width="64" height="64" rx="18" fill="${colors[0]}"/>${body}</svg>`;
  const url = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value!);
  cache.set(seed, url);
  return url;
}

export const TokenAvatar = memo(
  function TokenAvatar({ token, size = 36, className = "" }: TokenAvatarProps) {
    const dimension = Number.isFinite(size) ? Math.max(16, Math.min(128, Math.round(size))) : 36;
    return (
      <img
        src={tokenAvatarDataUrl(token)}
        alt={`${token.name}（${token.symbol}）代币图标`}
        width={dimension}
        height={dimension}
        className={className}
        style={{ width: dimension, height: dimension, borderRadius: "30%", flexShrink: 0 }}
        decoding="async"
        loading="lazy"
        draggable={false}
      />
    );
  },
  (before, after) =>
    before.size === after.size &&
    before.className === after.className &&
    before.token.id === after.token.id &&
    before.token.address === after.token.address &&
    before.token.name === after.token.name &&
    before.token.symbol === after.token.symbol &&
    before.token.easterEgg === after.token.easterEgg,
);
