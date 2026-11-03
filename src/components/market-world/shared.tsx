import type { ButtonHTMLAttributes, ReactNode } from "react";
import { ArrowLeft, LoaderCircle } from "lucide-react";
import { CHAINS, PLATFORMS } from "@/lib/world/config";
import type { ChainId, Token } from "@/lib/world/types";
import { PriceValue } from "./price-value";
import { Button } from "@/components/discipline/ui";

export const chainSpec = (id: ChainId) => CHAINS.find((chain) => chain.id === id)!;
export const platformName = (id: string) =>
  PLATFORMS.find((platform) => platform.id === id)?.name ?? id;
export function simTime(seconds: number) {
  const s = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(s / 3600)).padStart(2, "0")}:${String(Math.floor(s / 60) % 60).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}
export function ageLabel(now: number, born: number) {
  const age = Math.max(0, now - born);
  return age < 60
    ? `${Math.floor(age)} 秒`
    : age < 3600
      ? `${Math.floor(age / 60)} 分钟`
      : `${(age / 3600).toFixed(1)} 小时`;
}
export function statusLabel(token: Token) {
  return {
    curve: "曲线交易",
    migrating: "迁移中",
    pool: "池上交易",
    dormant: "低活跃",
    dead: "无有效流动性",
  }[token.status];
}
export function ChainBadge({ id, short = false }: { id: ChainId; short?: boolean }) {
  const chain = chainSpec(id);
  return (
    <span className={`mw-chain-badge mw-chain-${id}`}>
      <span aria-hidden="true">{id === "solana" ? "S" : id === "bnb" ? "B" : "b"}</span>
      {short ? chain.native : chain.name}
    </span>
  );
}
export function ActionButton({
  children,
  busy = false,
  secondary = false,
  danger = false,
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
  busy?: boolean;
  secondary?: boolean;
  danger?: boolean;
}) {
  return (
    <Button
      variant={danger ? "danger" : secondary ? "ghost" : "primary"}
      className={`mw-button ${secondary ? "mw-button-secondary" : ""} ${danger ? "mw-button-danger" : ""} ${className}`}
      {...props}
      disabled={props.disabled || busy}
    >
      {busy ? <LoaderCircle size={16} className="mw-spin" /> : null}
      {children}
    </Button>
  );
}
export function BackButton({
  onClick,
  children = "返回市场",
}: {
  onClick: () => void;
  children?: ReactNode;
}) {
  return (
    <button className="mw-back" type="button" onClick={onClick}>
      <ArrowLeft size={16} />
      {children}
    </button>
  );
}
export function Metric({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: "ok" | "bad";
}) {
  return (
    <div className="mw-metric">
      <span>{label}</span>
      <strong className={tone ? `mw-${tone}` : ""}>{value}</strong>
      {sub ? <small>{sub}</small> : null}
    </div>
  );
}
export function Price({ value }: { value: number }) {
  return <PriceValue value={value} currency />;
}
export function EmptyState({
  icon,
  title,
  children,
}: {
  icon: ReactNode;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="mw-empty">
      <div className="mw-empty-icon">{icon}</div>
      <h3>{title}</h3>
      {children ? <p>{children}</p> : null}
    </div>
  );
}
