import { useId } from "react";
import type { CurvePoint } from "@/lib/trading/store";

/**
 * Decorative equity sparkline for the home screen. Plain SVG so the home
 * screen does not pull the full chart library into the first load.
 */
export function EquitySpark({ data }: { data: CurvePoint[] }) {
  const gradientId = useId();
  if (data.length < 2) return null;
  const values = data.map((p) => p.equity);
  const first = values[0] ?? 0;
  const last = values[values.length - 1] ?? 0;
  const up = last >= first;
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo || 1;
  const W = 100;
  const H = 32;
  const pad = 2;
  const points = values.map((v, i) => {
    const x = (i / (values.length - 1)) * W;
    const y = pad + (1 - (v - lo) / span) * (H - pad * 2);
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });
  const line = `M${points.join(" L")}`;
  const area = `${line} L${W},${H} L0,${H} Z`;
  const color = up ? "var(--color-ok)" : "var(--color-bad)";
  return (
    <div className="pointer-events-none mt-3 h-16 w-full" aria-hidden>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-full w-full">
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.35} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <path d={area} fill={`url(#${gradientId})`} />
        <path
          d={line}
          fill="none"
          stroke={color}
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      </svg>
    </div>
  );
}
