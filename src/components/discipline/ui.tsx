import { useEffect, useState, type ButtonHTMLAttributes, type HTMLAttributes, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/cn";

type Variant = "primary" | "ghost" | "danger" | "ok";

const variants: Record<Variant, string> = {
  primary: "bg-primary text-primary-fg",
  ghost: "border border-line bg-transparent text-fg",
  danger: "bg-bad text-bg",
  ok: "bg-ok text-bg",
};

export function Overlay({
  children,
  className,
  ...props
}: HTMLAttributes<HTMLDivElement> & { children: ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return createPortal(
    <div className={className} {...props}>
      {children}
    </div>,
    document.body,
  );
}

export function Button({
  variant = "primary",
  className,
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      type={type}
      className={cn(
        "inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-full px-4 py-3 text-sm font-medium tracking-wide transition duration-300 ease-out active:not-disabled:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40",
        variants[variant],
        className,
      )}
      {...props}
    />
  );
}

export function Card({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={cn("rounded-2xl bg-surface p-5", className)}>{children}</section>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="mb-3 block">
      <span className="mb-1.5 block font-mono text-xs tracking-widest text-muted">{label}</span>
      {children}
    </label>
  );
}

export const fieldClass =
  "w-full rounded-none border-0 border-b border-line bg-transparent px-0 py-3 text-sm text-fg outline-none transition duration-300 placeholder:text-faint focus:border-primary";

const toneClass = {
  muted: "text-muted",
  ok: "text-ok",
  warn: "text-primary",
  bad: "text-bad",
} as const;

const barClass = {
  muted: "bg-faint",
  ok: "bg-ok",
  warn: "bg-primary",
  bad: "bg-bad",
} as const;

function useCount(target: number) {
  const [value, setValue] = useState(0);
  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      setValue(target);
      return;
    }
    const start = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / 720);
      const eased = 1 - (1 - progress) ** 3;
      setValue(target * eased);
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target]);
  return Math.round(value);
}

export function RateBlock({
  rate,
  tone,
  total,
  followed,
  streak,
  large = false,
  invert = false,
  poster = false,
}: {
  rate: number;
  tone: keyof typeof toneClass;
  total: number;
  followed: number;
  streak: number;
  large?: boolean;
  invert?: boolean;
  poster?: boolean;
}) {
  const shown = useCount(rate);
  return (
    <div>
      <div className={poster ? undefined : "flex items-end justify-between gap-3"}>
        <div className={poster ? "mask-rise" : undefined}>
          {poster ? null : (
            <p className={cn("text-xs text-faint", invert ? "text-primary-fg/70" : "text-faint")}>执行率</p>
          )}
          <p
            className={cn(
              "font-serif font-medium leading-none tabular-nums",
              poster ? "text-8xl whitespace-nowrap" : large ? "mt-2 text-6xl" : "mt-1 text-4xl",
              invert ? "text-primary-fg" : toneClass[tone],
            )}
          >
            {shown}
            <span className={poster ? "text-3xl" : large ? "text-2xl" : "text-lg"}>%</span>
          </p>
        </div>
        {poster ? null : (
          <div className="text-right">
            <p className={cn("text-xs", invert ? "text-primary-fg/70" : "text-muted")}>目标</p>
            <p className={cn("font-serif text-lg tabular-nums", invert ? "text-primary-fg" : "text-fg")}>80%</p>
          </div>
        )}
      </div>
      <div className={cn("mt-4 h-px overflow-hidden bg-line", invert && "bg-primary-fg/20")} aria-hidden>
        <div
          className={cn("bar-grow h-full", invert ? "bg-primary-fg" : barClass[tone])}
          style={{ width: `${total === 0 ? 0 : Math.min(rate, 100)}%` }}
        />
      </div>
      <div className={cn("mt-3 flex justify-between gap-3 text-xs", invert ? "text-primary-fg/80" : "text-muted")}>
        <span>
          按计划{" "}
          <span className={cn("font-mono font-bold tabular-nums", invert ? "text-primary-fg" : "text-fg")}>
            {followed}
          </span>
          <span className="px-1">/</span>
          共{" "}
          <span className={cn("font-mono font-bold tabular-nums", invert ? "text-primary-fg" : "text-fg")}>
            {total}
          </span>{" "}
          笔
        </span>
        <span>
          连续{" "}
          <span className={cn("font-mono font-bold tabular-nums", invert ? "text-primary-fg" : "text-fg")}>
            {streak}
          </span>
        </span>
      </div>
    </div>
  );
}
