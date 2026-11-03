import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import "./training-ui.css";

export type AcademyView = "map" | "practice" | "exams" | "report";
export type MarketView = "market" | "account" | "review";
export type TrainingDestination =
  | { page: "academy"; view?: AcademyView; reviewSeed?: string }
  | { page: "market"; view?: MarketView };
type Navigation = {
  page: "academy" | "market";
  academyView: AcademyView;
  onBack: () => void;
  navigate: (target: TrainingDestination) => void;
};
const TrainingNavigation = createContext<Navigation | null>(null);
export const TrainingNavigationProvider = TrainingNavigation.Provider;
const TrainingActivity = createContext(true);
export const TrainingActivityProvider = TrainingActivity.Provider;
export const useTrainingActive = () => useContext(TrainingActivity);
export function TrainingHeader({
  title,
  kicker = "先执行规则 · 再练交易",
  children,
}: {
  title: string;
  kicker?: string;
  children?: ReactNode;
}) {
  const navigation = useContext(TrainingNavigation);
  const area =
    navigation?.page === "market"
      ? "market"
      : navigation?.academyView === "exams" || navigation?.academyView === "report"
        ? "progress"
        : "learn";
  const tabs = [
    { id: "home", label: "账本", action: () => navigation?.onBack() },
    {
      id: "learn",
      label: "学习",
      action: () => navigation?.navigate({ page: "academy", view: "map" }),
    },
    {
      id: "market",
      label: "市场",
      action: () => navigation?.navigate({ page: "market", view: "market" }),
    },
    {
      id: "progress",
      label: "进度",
      action: () => navigation?.navigate({ page: "academy", view: "exams" }),
    },
  ];
  return (
    <header className="app-poster training-header">
      <nav className="app-nav training-nav" aria-label="交易训练导航">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            aria-current={area === t.id ? "page" : undefined}
            onClick={t.action}
          >
            {t.label}
          </button>
        ))}
      </nav>
      <div className="training-header-copy">
        <p className="training-header-kicker rise-in">{kicker}</p>
        <TextReveal key={title} as="h1" text={title} className="training-header-title" />
        {children}
      </div>
    </header>
  );
}
export function TextReveal({
  text,
  as: Tag = "h2",
  className = "",
}: {
  text: string;
  as?: "h1" | "h2" | "h3" | "p";
  className?: string;
}) {
  return (
    <Tag className={`training-text-reveal ${className}`} aria-label={text.replaceAll("\n", " ")}>
      {text.split("\n").map((line, i) => (
        <span className="training-text-line mask-rise" aria-hidden="true" key={`${i}-${line}`}>
          <span style={{ animationDelay: `${i * 80}ms` }}>{line || "\u00a0"}</span>
        </span>
      ))}
    </Tag>
  );
}
export function TrainingDisclosure({
  title,
  summary,
  children,
  defaultOpen = false,
  className = "",
}: {
  title: string;
  summary?: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  className?: string;
}) {
  return (
    <details className={`training-disclosure ${className}`} open={defaultOpen || undefined}>
      <summary>
        <span>
          <strong>{title}</strong>
          {summary && <small>{summary}</small>}
        </span>
        <ChevronDown size={18} aria-hidden="true" />
      </summary>
      <div className="training-disclosure-content">{children}</div>
    </details>
  );
}
export function AnimatedValue({
  value,
  format = (n) => Math.round(n).toLocaleString("zh-CN"),
  className = "",
}: {
  value: number;
  format?: (value: number) => string;
  className?: string;
}) {
  const [shown, setShown] = useState(value);
  const previous = useRef(value);
  useEffect(() => {
    const target = Number.isFinite(value) ? value : 0;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      previous.current = target;
      setShown(target);
      return;
    }
    const from = previous.current,
      start = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / 400);
      const next = from + (target - from) * (1 - (1 - progress) ** 3);
      previous.current = next;
      setShown(next);
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value]);
  return (
    <span className={`training-animated-value ${className}`} aria-label={format(value)}>
      <span aria-hidden="true">{format(shown)}</span>
    </span>
  );
}
