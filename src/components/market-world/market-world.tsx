import { TrainingSelect } from "@/components/training-select";
import { useEffect, useMemo, useRef, useState } from "react";
import { Line, LineChart, ResponsiveContainer, YAxis } from "recharts";
import {
  Activity,
  ArrowRight,
  BookOpen,
  ChevronRight,
  Flag,
  Globe2,
  Layers,
  LockKeyhole,
  Pause,
  Play,
  Plus,
  Search,
  Shield,
  Sparkles,
  Star,
  StepForward,
  X,
} from "lucide-react";
import { useWorld } from "@/lib/world/store";
import { CHAINS, PLATFORMS } from "@/lib/world/config";
import { liquidationValue, quoteTrade, tokenPrice } from "@/lib/world/engine";
import { compact, currencyCompact, money, units } from "@/lib/world/amount";
import type { ChainId, Regime, Token, World, WorldConfig } from "@/lib/world/types";
import {
  ActionButton,
  ChainBadge,
  EmptyState,
  Metric,
  Price,
  ageLabel,
  chainSpec,
  platformName,
  simTime,
  statusLabel,
} from "./shared";
import { TokenDetail } from "./token-detail";
import { TransactionsPanel, WalletPanel } from "./wallet";
import { ReviewPanel } from "./review";
import { MarketNews } from "./market-news";
import { TokenAvatar } from "./token-avatar";
import { AccountOverview } from "./account-overview";
import { EasterEggBadge } from "./easter-egg";
import {
  AnimatedValue,
  TextReveal,
  TrainingDisclosure,
  TrainingHeader,
} from "@/components/training-ui";
import "./world.css";

type View = "market" | "account" | "review";
type AccountView = "overview" | "holdings" | "wallet" | "transactions";
type MarketFilters = {
  chain: "all" | ChainId;
  platform: string;
  stage: string;
  search: string;
  sort: string;
  archived: boolean;
  page: number;
};
const MARKET_PAGE_SIZE = 24;
export function MarketWorld({
  onBack,
  onAcademy,
  initialView,
  navigationKey,
  onViewChange,
}: {
  onBack: () => void;
  onAcademy: (reviewSeed?: string) => void;
  initialView?: View;
  navigationKey?: object;
  onViewChange?: (view: View) => void;
}) {
  const {
    world,
    reports,
    hydrated,
    busy,
    advancing,
    playing,
    speed,
    selectedId,
    error,
    readOnly,
    create,
    dispatch,
    advance,
    setPlaying,
    setSpeed,
    select,
    clearError,
    takeOver,
  } = useWorld();
  const [view, setView] = useState<View>(initialView ?? "market");
  const [accountView, setAccountView] = useState<AccountView>("overview");
  const mainRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (mainRef.current) mainRef.current.scrollTop = 0;
  }, [selectedId, view, accountView]);
  const [setup, setSetup] = useState(false);
  const [finishConfirm, setFinishConfirm] = useState(false);
  const [abandoning, setAbandoning] = useState(false);
  const [watched, setWatched] = useState<string[]>([]);
  const [marketScope, setMarketScope] = useState<"all" | "watch" | "eggs">("all");
  const watchedOnly = marketScope === "watch";
  const [marketFilters, setMarketFilters] = useState<MarketFilters>({
    chain: "all",
    platform: "all",
    stage: "all",
    search: "",
    sort: "new",
    archived: false,
    page: 1,
  });
  useEffect(() => {
    if (initialView) {
      setView(initialView);
      select(null);
    }
  }, [initialView, navigationKey, select]);
  useEffect(() => {
    if (!world) return;
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(`td-watch-${world.id}`) ?? "[]");
      setWatched(
        Array.isArray(saved)
          ? saved.filter((item): item is string => typeof item === "string")
          : [],
      );
    } catch {
      setWatched([]);
    }
  }, [world?.id]);
  useEffect(() => {
    if (world?.phase === "completed") {
      setView("review");
      onViewChange?.("review");
      select(null);
      setPlaying(false);
    }
  }, [world?.phase, select, setPlaying]);
  function toggleWatch(id: string) {
    const next = watched.includes(id) ? watched.filter((item) => item !== id) : [...watched, id];
    setWatched(next);
    if (world)
      try {
        localStorage.setItem(`td-watch-${world.id}`, JSON.stringify(next));
      } catch {
        /* Optional preference. */
      }
  }
  function navigate(next: View) {
    setView(next);
    select(null);
    onViewChange?.(next);
  }
  async function start(config: Partial<WorldConfig>) {
    const created = await create(config);
    if (created && useWorld.getState().world && !useWorld.getState().error) {
      setSetup(false);
      setView("market");
      onViewChange?.("market");
      select(null);
    }
  }
  async function finish() {
    if (
      await dispatch({
        id: crypto.randomUUID(),
        type: abandoning ? "abandon" : "finish",
      })
    ) {
      setFinishConfirm(false);
      setPlaying(!abandoning);
      select(null);
    }
  }
  const selected =
    view === "market" ? world?.tokens.find((token) => token.id === selectedId) : undefined;
  const pending = world?.transactions.filter((tx) => tx.status === "pending").length ?? 0;
  const equity = useMemo(
    () =>
      world?.phase === "completed" && world.report
        ? world.report.final
        : world
          ? liquidationValue(world)
          : 10000,
    [world],
  );
  const canFinish = Boolean(
    world &&
    world.phase !== "completed" &&
    world.phase !== "settling" &&
    (world.config.mode !== "exam" || world.now >= world.config.duration),
  );
  const title =
    selected?.name ??
    (!world || setup
      ? "多链市场"
      : { market: "多链市场", account: "训练账户", review: "本场复盘" }[view]);
  return (
    <div
      className={`app-shell mw-app ${selected ? "mw-token-open" : ""}`}
      data-testid="market-world-screen"
    >
      <TrainingHeader
        title={title}
        kicker={
          world?.config.mode === "exam" && world.phase !== "completed"
            ? "正式考核 · 固定120模拟分钟"
            : "虚拟资金 · 先执行再谈钱"
        }
      />
      <main className="app-scroll mw-main" ref={mainRef}>
        <div className="mw-main-column">
          {!hydrated ? (
            <EmptyState icon={<Globe2 size={24} />} title="正在恢复训练世界">
              载入已保存的资金、项目与事件。
            </EmptyState>
          ) : (
            <>
              {readOnly && (
                <div className="mw-notice mw-notice-danger">
                  <LockKeyhole size={18} />
                  <span>另一标签正在训练，本页为只读。</span>
                  <button type="button" onClick={() => void takeOver()}>
                    接管
                  </button>
                </div>
              )}
              {error && (
                <div className="mw-notice mw-notice-danger" role="alert">
                  <span>{error}</span>
                  <button type="button" aria-label="关闭错误提示" onClick={clearError}>
                    <X size={18} />
                  </button>
                </div>
              )}
              {world && !setup && (
                <>
                  <nav className="mw-view-tabs" aria-label="市场页面">
                    {(
                      [
                        ["market", "市场"],
                        ["account", "账户"],
                        ["review", "复盘"],
                      ] as const
                    ).map(([id, label]) => (
                      <button
                        type="button"
                        key={id}
                        className={view === id && !selected ? "is-active" : ""}
                        aria-current={view === id && !selected ? "page" : undefined}
                        onClick={() => navigate(id)}
                      >
                        {label}
                        {id === "account" && pending > 0 && (
                          <span className="mw-count">{pending}</span>
                        )}
                      </button>
                    ))}
                  </nav>
                  <section className="mw-session-bar" aria-label="世界状态">
                    <div>
                      <span className="mw-muted">
                        {world.phase === "completed" ? "结算总权益" : "账户总权益"}
                      </span>
                      <strong>
                        <AnimatedValue value={equity} format={(value) => `$${money(value)}`} />
                      </strong>
                    </div>
                    <div className="mw-session-time">
                      <time>
                        {simTime(world.now)}
                        {world.config.mode === "exam" && world.phase !== "completed" ? (
                          <small className="mw-duration"> / {simTime(world.config.duration)}</small>
                        ) : null}
                      </time>
                      <span className="mw-muted">
                        {world.phase === "completed"
                          ? "已结算"
                          : playing
                            ? `模拟已运行 · ${speed}×`
                            : "模拟已暂停"}
                      </span>
                    </div>
                    <div className="mw-clock-controls">
                      <button
                        className="mw-control-button"
                        type="button"
                        onClick={() => setPlaying(!playing)}
                        disabled={readOnly || world.phase === "completed"}
                        aria-label={playing ? "暂停模拟市场" : "继续模拟市场"}
                      >
                        {playing ? <Pause size={16} /> : <Play size={16} />}{" "}
                        {playing ? "暂停" : "继续"}
                      </button>
                      <label className="mw-speed-label">
                        <span className="mw-sr-only">模拟倍速</span>
                        <TrainingSelect
                          value={String(speed)}
                          onValueChange={(value) => setSpeed(Number(value))}
                          options={[1, 10, 30, 60].map((value) => ({
                            value: String(value),
                            label: `${value}×`,
                          }))}
                          aria-label="模拟倍速"
                          disabled={readOnly}
                          className="mw-speed-select"
                        />
                      </label>
                      <button
                        className="mw-control-button"
                        type="button"
                        title="暂停时推进一分钟"
                        disabled={
                          playing || busy || advancing || readOnly || world.phase === "completed"
                        }
                        onClick={() => void advance(60)}
                      >
                        <StepForward size={16} />
                        +1 分钟
                      </button>
                    </div>
                  </section>
                  {world.phase === "settling" && (
                    <div className="mw-notice">
                      <span>正在统一结算。取消新增风险，按实际退出条件处理持仓与既有桥接。</span>
                      {!playing && (
                        <button type="button" onClick={() => setPlaying(true)}>
                          继续结算
                        </button>
                      )}
                    </div>
                  )}
                  {world.stopUntil > world.now && (
                    <div className="mw-notice mw-notice-danger">
                      <Shield size={18} />
                      <span>停止线已触发。到 {simTime(world.stopUntil)} 前只允许减险。</span>
                    </div>
                  )}
                </>
              )}
              {!world || setup ? (
                view === "review" && reports.length > 0 && !setup ? (
                  <ReviewPanel world={null} onAcademy={onAcademy} />
                ) : (
                  <WorldSetup
                    busy={busy}
                    hasWorld={Boolean(world)}
                    canCreate={!world || world.phase === "completed"}
                    onStart={start}
                    onCancel={() => setSetup(false)}
                    onAcademy={() => onAcademy()}
                  />
                )
              ) : (
                <>
                  <div className="screen-in" key={selected?.id ?? `${view}-${accountView}`}>
                    {selected ? (
                      <TokenDetail
                        key={selected.id}
                        world={world}
                        token={selected}
                        watched={watched.includes(selected.id)}
                        onWatch={() => toggleWatch(selected.id)}
                        onBack={() => select(null)}
                      />
                    ) : view === "market" ? (
                      <>
                        <div className="mw-market-scope">
                          <button
                            type="button"
                            className={marketScope === "all" ? "is-active" : ""}
                            onClick={() => setMarketScope("all")}
                          >
                            全部项目
                          </button>
                          <button
                            type="button"
                            className={watchedOnly ? "is-active" : ""}
                            onClick={() => setMarketScope("watch")}
                          >
                            <Star size={16} />
                            我的关注 {watched.length || ""}
                          </button>
                          <button
                            type="button"
                            className={marketScope === "eggs" ? "is-active" : ""}
                            onClick={() => setMarketScope("eggs")}
                          >
                            <Sparkles size={16} />
                            彩蛋
                          </button>
                        </div>
                        <MarketList
                          world={world}
                          watched={watched}
                          watchedOnly={watchedOnly}
                          easterEggOnly={marketScope === "eggs"}
                          onWatch={toggleWatch}
                          onSelect={select}
                          filters={marketFilters}
                          onFilters={setMarketFilters}
                        />
                        <TrainingDisclosure title="市场动态" summary="公开消息、已发生事件与异常">
                          <WorldEvents world={world} onSelect={select} />
                        </TrainingDisclosure>
                      </>
                    ) : view === "account" ? (
                      <>
                        <div className="mw-subnav" aria-label="账户内容">
                          {(
                            [
                              ["overview", "总览"],
                              ["holdings", "持仓"],
                              ["wallet", "资金"],
                              ["transactions", "记录"],
                            ] as const
                          ).map(([id, label]) => (
                            <button
                              type="button"
                              key={id}
                              className={accountView === id ? "is-active" : ""}
                              aria-current={accountView === id ? "page" : undefined}
                              onClick={() => setAccountView(id)}
                            >
                              {label}
                              {id === "transactions" && pending > 0 ? ` ${pending}` : ""}
                            </button>
                          ))}
                        </div>
                        {accountView === "overview" ? (
                          <AccountOverview world={world} />
                        ) : accountView === "holdings" ? (
                          <Holdings world={world} onSelect={select} />
                        ) : accountView === "wallet" ? (
                          <WalletPanel world={world} />
                        ) : (
                          <TransactionsPanel world={world} />
                        )}
                      </>
                    ) : (
                      <ReviewPanel world={world} onAcademy={onAcademy} />
                    )}
                  </div>
                  <TrainingDisclosure
                    title="本场设置"
                    summary={
                      world.config.mode === "exam"
                        ? `正式观察 · 固定 ${Math.floor(world.config.duration / 60)} 分钟`
                        : undefined
                    }
                  >
                    <dl className="mw-session-settings">
                      <div>
                        <dt>模式</dt>
                        <dd>{world.config.mode === "exam" ? "正式考核" : "自由练习"}</dd>
                      </div>
                      <div>
                        <dt>交易时长</dt>
                        <dd>
                          {Math.floor(world.config.duration / 3600) > 0
                            ? `${Math.floor(world.config.duration / 3600)} 小时`
                            : `${Math.floor(world.config.duration / 60)} 分钟`}
                        </dd>
                      </div>
                    </dl>
                    {world.config.mode === "free" && world.phase === "running" && (
                      <>
                        <ActionButton
                          secondary
                          busy={busy}
                          disabled={readOnly || world.config.duration >= 7 * 86400}
                          onClick={async () => {
                            if (
                              await dispatch({
                                id: crypto.randomUUID(),
                                type: "extend",
                              })
                            )
                              setPlaying(false);
                          }}
                        >
                          续接一天
                        </ActionButton>
                      </>
                    )}
                    {world.phase === "completed" ? (
                      <ActionButton onClick={() => setSetup(true)}>
                        <Plus size={16} />
                        生成新世界
                      </ActionButton>
                    ) : (
                      <ActionButton
                        secondary
                        disabled={
                          readOnly ||
                          (!canFinish && world.config.mode !== "exam") ||
                          world.phase === "settling"
                        }
                        onClick={() => {
                          setPlaying(false);
                          setAbandoning(world.config.mode === "exam");
                          setFinishConfirm(true);
                        }}
                      >
                        <Flag size={16} />
                        {world.config.mode === "exam" ? "放弃本场（保留未完成记录）" : "结束并复盘"}
                      </ActionButton>
                    )}
                    <details className="mw-training-details">
                      <summary>训练信息</summary>
                      <dl>
                        <dt>世界种子</dt>
                        <dd>
                          {world.config.mode === "exam" && world.phase !== "completed"
                            ? "结算后披露"
                            : world.config.seed}
                        </dd>
                        <dt>模拟引擎</dt>
                        <dd>{world.engineVersion}</dd>
                      </dl>
                      <p>时钟是累计模拟时长。+1 分钟推进 60 个模拟秒；切换页面或进入后台会暂停。</p>
                      <p>
                        进度保存在本机。自由练习可续接，最多七个模拟日；续接保留当前资金与市场。
                      </p>
                    </details>
                  </TrainingDisclosure>
                  <p className="mw-footnote">虚拟资金 · 本机保存</p>
                </>
              )}
            </>
          )}
        </div>
      </main>
      {finishConfirm && (
        <div
          className="mw-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="mw-finish-title"
        >
          <div className="mw-modal">
            <h2 id="mw-finish-title" className="mask-rise">
              <span>{abandoning ? "放弃这场正式考核？" : "结束这个训练世界？"}</span>
            </h2>
            <p>
              {abandoning
                ? "本次尝试会保留为未完成记录，不能提前锁定盈利。也可以返回，暂停后继续。"
                : "取消排队买入，按统一规则退出与结算。不能退出的资产仍保留数量和原因。"}
            </p>
            <div className="mw-modal-actions">
              <ActionButton secondary onClick={() => setFinishConfirm(false)}>
                返回并保留暂停
              </ActionButton>
              <ActionButton busy={busy} onClick={finish}>
                {abandoning ? "确认放弃并保留记录" : "确认结束并结算"}
              </ActionButton>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function WorldSetup({
  busy,
  hasWorld,
  canCreate,
  onStart,
  onCancel,
  onAcademy,
}: {
  busy: boolean;
  hasWorld: boolean;
  canCreate: boolean;
  onStart: (config: Partial<WorldConfig>) => Promise<void>;
  onCancel: () => void;
  onAcademy: () => void;
}) {
  const [seed, setSeed] = useState("");
  const [density, setDensity] = useState("6");
  const [protection, setProtection] = useState(true);
  const [environment, setEnvironment] = useState<"random" | Regime>("random");
  const [starting, setStarting] = useState(false);
  async function start() {
    setStarting(true);
    try {
      const finalSeed = seed.trim() || `world-${crypto.randomUUID().slice(0, 8)}`;
      const hash = Array.from(finalSeed).reduce(
        (value, char) => (value * 31 + char.charCodeAt(0)) >>> 0,
        17,
      );
      const regime =
        environment === "random"
          ? (["inflow", "rotation", "outflow", "stress"] as const)[hash % 4]
          : environment;
      await onStart({
        seed: finalSeed,
        mode: "free",
        regime,
        spawnPerMinute: Number(density),
        protection,
        duration: 24 * 3600,
      });
    } finally {
      setStarting(false);
    }
  }
  return (
    <div className="mw-setup">
      <section className="mw-intro">
        <TextReveal as="h2" text="先在这里，练好每次决定。" />
        <p>三条模拟链，五类发射平台。新币不断出现，用虚拟资金观察、买卖，也练习等待。</p>
      </section>
      <section className="mw-panel">
        <div className="mw-setup-capital">
          <span>初始虚拟资金</span>
          <strong>$10,000</strong>
        </div>
        <label className="mw-check-label">
          <input
            type="checkbox"
            checked={protection}
            onChange={(event) => setProtection(event.target.checked)}
          />
          <span>
            <strong>教学风险保护</strong>
            <span className="mw-muted">避免单次投入过多，保留退出空间</span>
          </span>
        </label>
        <ActionButton busy={busy || starting} disabled={!canCreate} onClick={start}>
          <Play size={18} />
          生成世界，开始自主交易
        </ActionButton>
        {hasWorld && (
          <ActionButton secondary onClick={onCancel}>
            返回当前世界
          </ActionButton>
        )}
        {!canCreate && (
          <p className="mw-inline-error">先结算当前世界，再生成新世界，保留全部尝试。</p>
        )}
      </section>
      <TrainingDisclosure title="世界参数" summary="可选种子、市场环境和发行密度">
        <label className="mw-label">
          世界种子
          <input
            value={seed}
            maxLength={80}
            onChange={(event) => setSeed(event.target.value)}
            placeholder="留空生成新种子"
            aria-label="世界种子"
          />
        </label>
        <label className="mw-label">
          市场环境
          <TrainingSelect
            value={environment}
            onValueChange={(value) => setEnvironment(value as "random" | Regime)}
            options={[
              { value: "random", label: "随机未知" },
              { value: "inflow", label: "资金流入实验" },
              { value: "rotation", label: "震荡轮动实验" },
              { value: "outflow", label: "资金流出实验" },
              { value: "stress", label: "拥堵与风险实验" },
            ]}
            aria-label="市场环境"
          />
        </label>
        <label className="mw-label">
          发行密度
          <TrainingSelect
            value={density}
            onValueChange={setDensity}
            options={[
              { value: "2", label: "慢 · 约 2 个 / 分钟" },
              { value: "6", label: "标准 · 约 6 个 / 分钟" },
              { value: "10", label: "密集 · 约 10 个 / 分钟" },
            ]}
            aria-label="发行密度"
          />
        </label>
      </TrainingDisclosure>
      <TrainingDisclosure title="三链与五类平台" summary="Solana · BNB Chain · Base">
        <div className="mw-line-list">
          {CHAINS.map((chain) => (
            <div className="mw-chain-description" key={chain.id}>
              <ChainBadge id={chain.id} />
              <p>
                {PLATFORMS.filter(
                  (platform) => platform.chain === chain.id || platform.chain === "all",
                )
                  .map((platform) => platform.name)
                  .join(" · ")}
              </p>
              <p className="mw-muted">{chain.native} 支付本链 gas，余额独立记账</p>
            </div>
          ))}
        </div>
      </TrainingDisclosure>
      <p className="mw-footnote">
        所有资产与地址均为模拟。无需真实钱包或 AI，自由成绩不替代正式考核。
      </p>
      <button className="mw-text-link" type="button" onClick={onAcademy}>
        <BookOpen size={18} />
        从买卖练起
      </button>
    </div>
  );
}

function MarketList({
  world,
  watched,
  watchedOnly,
  easterEggOnly,
  onWatch,
  onSelect,
  filters,
  onFilters,
}: {
  world: World;
  watched: string[];
  watchedOnly: boolean;
  easterEggOnly: boolean;
  onWatch: (id: string) => void;
  onSelect: (id: string) => void;
  filters: MarketFilters;
  onFilters: (filters: MarketFilters) => void;
}) {
  const { chain, platform, stage, search, sort, archived } = filters;
  function update(change: Partial<MarketFilters>) {
    onFilters({ ...filters, ...change, page: change.page ?? 1 });
  }
  const tokens = useMemo(
    () =>
      world.tokens
        .filter(
          (token) =>
            (!watchedOnly || watched.includes(token.id)) &&
            (!easterEggOnly || Boolean(token.easterEgg)) &&
            (chain === "all" || token.chain === chain) &&
            (platform === "all" || token.platformId === platform) &&
            (stage === "all" || token.status === stage) &&
            (archived ||
              Boolean(token.easterEgg) ||
              (token.status !== "dead" && token.status !== "dormant")) &&
            `${token.name} ${token.symbol} ${token.address}`
              .toLowerCase()
              .includes(search.toLowerCase()),
        )
        .sort((a, b) =>
          sort === "depth"
            ? units(b.pool.quote) * world.fx[b.chain] - units(a.pool.quote) * world.fx[a.chain]
            : sort === "change"
              ? tokenPrice(b) / (b.initialPrice || 1) - tokenPrice(a) / (a.initialPrice || 1)
              : b.bornAt - a.bornAt || b.id.localeCompare(a.id),
        ),
    [world, watchedOnly, easterEggOnly, watched, chain, platform, stage, archived, search, sort],
  );
  const active = world.tokens.filter(
    (token) => token.status !== "dead" && token.status !== "dormant",
  ).length;
  const pages = Math.max(1, Math.ceil(tokens.length / MARKET_PAGE_SIZE));
  const page = Math.max(1, Math.min(filters.page, pages));
  const first = (page - 1) * MARKET_PAGE_SIZE;
  const visible = tokens.slice(first, first + MARKET_PAGE_SIZE);
  return (
    <div
      data-testid="market-list"
      data-total-count={world.tokens.length}
      data-active-count={active}
      data-match-count={tokens.length}
      data-rendered-count={visible.length}
      data-page-size={MARKET_PAGE_SIZE}
      data-page={page}
      data-simulation-time={world.now}
    >
      <div className="mw-chain-filters">
        <button
          type="button"
          className={chain === "all" ? "is-active" : ""}
          onClick={() => update({ chain: "all" })}
        >
          全部链
        </button>
        {CHAINS.map((item) => (
          <button
            type="button"
            key={item.id}
            className={chain === item.id ? "is-active" : ""}
            onClick={() => update({ chain: item.id })}
          >
            <ChainBadge id={item.id} />
          </button>
        ))}
      </div>
      <div className="mw-market-search">
        <label className="mw-search">
          <Search size={18} />
          <input
            value={search}
            onChange={(event) => update({ search: event.target.value })}
            placeholder="搜索项目或模拟地址"
            aria-label="搜索项目"
          />
        </label>
        <TrainingSelect
          value={sort}
          onValueChange={(value) => update({ sort: value })}
          options={[
            { value: "new", label: "最新出现" },
            { value: "depth", label: "池深度" },
            { value: "change", label: "当前涨幅" },
          ]}
          aria-label="项目排序"
        />
      </div>
      <TrainingDisclosure
        title="更多筛选"
        summary={`${tokens.length} 个结果 · ${active} 个活跃项目`}
      >
        <div className="mw-two-fields">
          <label className="mw-label">
            发射平台
            <TrainingSelect
              value={platform}
              onValueChange={(value) => update({ platform: value })}
              options={[
                { value: "all", label: "全部平台" },
                ...PLATFORMS.map((item) => ({
                  value: item.id,
                  label: item.name,
                })),
              ]}
              aria-label="筛选发射平台"
            />
          </label>
          <label className="mw-label">
            交易阶段
            <TrainingSelect
              value={stage}
              onValueChange={(value) => update({ stage: value })}
              options={[
                { value: "all", label: "全部阶段" },
                { value: "curve", label: "曲线交易" },
                { value: "pool", label: "池上交易" },
                { value: "migrating", label: "迁移中" },
              ]}
              aria-label="筛选交易阶段"
            />
          </label>
        </div>
        <label className="mw-check-label">
          <input
            type="checkbox"
            checked={archived}
            onChange={(event) => update({ archived: event.target.checked })}
          />
          <span>包含沉寂与死亡项目</span>
        </label>
        <p className="mw-caption">总共 {world.tokens.length} 个出生记录，只显示已发生信息。</p>
      </TrainingDisclosure>
      {tokens.length ? (
        <>
          <div className="mw-token-grid">
            {visible.map((token) => (
              <TokenCard
                key={token.id}
                token={token}
                world={world}
                watched={watched.includes(token.id)}
                onSelect={() => onSelect(token.id)}
                onWatch={() => onWatch(token.id)}
              />
            ))}
          </div>
          <div className="mw-pagination" aria-label="项目分页">
            <span>
              {first + 1}–{Math.min(first + MARKET_PAGE_SIZE, tokens.length)} / {tokens.length}
            </span>
            <div>
              <button
                type="button"
                data-testid="market-page-prev"
                disabled={page === 1}
                onClick={() => update({ page: page - 1 })}
              >
                上一页
              </button>
              <strong aria-live="polite">
                {page} / {pages}
              </strong>
              <button
                type="button"
                data-testid="market-page-next"
                disabled={page === pages}
                onClick={() => update({ page: page + 1 })}
              >
                下一页
              </button>
            </div>
          </div>
        </>
      ) : (
        <EmptyState
          icon={watchedOnly ? <Star size={24} /> : <Search size={24} />}
          title={
            watchedOnly
              ? "暂无符合筛选的关注项目"
              : easterEggOnly
                ? "本场暂无符合筛选的彩蛋"
                : "暂时没有符合筛选的项目"
          }
        >
          {watchedOnly
            ? "在项目行上点星标，留下观察名单。"
            : easterEggOnly
              ? "清除筛选，或在新的自由世界中寻找彩蛋。"
              : "更改筛选，或等待市场继续发行。"}
        </EmptyState>
      )}
    </div>
  );
}

function TokenCard({
  token,
  world,
  watched,
  onSelect,
  onWatch,
}: {
  token: Token;
  world: World;
  watched: boolean;
  onSelect: () => void;
  onWatch: () => void;
}) {
  const price = tokenPrice(token),
    change = token.initialPrice > 0 ? (price / token.initialPrice - 1) * 100 : 0;
  return (
    <article className="mw-token-card">
      <button
        className="mw-card-open"
        type="button"
        onClick={onSelect}
        data-testid="market-token-card"
      >
        <div className="mw-card-top">
          <div className="mw-card-identity">
            <TokenAvatar token={token} size={36} />
            <div className="mw-card-copy">
              <h3>
                {token.name} <span className="mw-symbol">{token.symbol}</span>
              </h3>
              <div className="mw-card-badges">
                <ChainBadge id={token.chain} short />
                <EasterEggBadge token={token} />
                <span>
                  {token.easterEgg ? "模拟参考池" : platformName(token.platformId)} ·{" "}
                  {statusLabel(token)}
                </span>
              </div>
            </div>
          </div>
          <div className="mw-card-price">
            <span className="mw-muted">市值</span>
            <strong>{currencyCompact(units(token.supply) * price * world.fx[token.chain])}</strong>
            <span className={change >= 0 ? "mw-ok" : "mw-bad"}>
              {change >= 0 ? "+" : ""}
              {change.toFixed(1)}%
            </span>
          </div>
        </div>
        <div className="mw-card-bottom">
          <div className="mw-card-facts">
            <span>
              单价{" "}
              <strong>
                <Price value={price * world.fx[token.chain]} />
              </strong>
            </span>
            <span>
              池深度{" "}
              <strong>{currencyCompact(units(token.pool.quote) * world.fx[token.chain])}</strong>
            </span>
            <span>
              {token.holders} 持币地址 · {ageLabel(world.now, token.bornAt)}
            </span>
          </div>
          <div className="mw-sparkline">
            {token.history.length > 1 ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={token.history.slice(-28)}>
                  <YAxis hide domain={["dataMin", "dataMax"]} />
                  <Line
                    type="linear"
                    dataKey="price"
                    dot={false}
                    stroke={change >= 0 ? "var(--color-ok)" : "var(--color-bad)"}
                    strokeWidth={1.5}
                    isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            ) : null}
          </div>
        </div>
      </button>
      <button
        type="button"
        className={`mw-card-watch ${watched ? "mw-starred" : ""}`}
        onClick={onWatch}
        aria-label={`${watched ? "取消关注" : "关注"} ${token.symbol}`}
      >
        <Star size={18} fill={watched ? "currentColor" : "none"} />
      </button>
    </article>
  );
}

function Holdings({ world, onSelect }: { world: World; onSelect: (id: string) => void }) {
  const held = Object.values(world.positions).filter((position) => BigInt(position.quantity) > 0n);
  const totalCost = held.reduce((sum, position) => sum + units(position.costUsd), 0);
  return (
    <div>
      <div className="mw-view-heading">
        <div>
          <span className="mw-eyebrow">组合观察</span>
          <TextReveal as="h2" text="我的持仓" />
          <p>退出价值已计入池深度与费用。权限受限时，屏幕市值不等于回款。</p>
        </div>
        <Layers size={28} />
      </div>
      <div className="mw-panel mw-holding-summary">
        <Metric label="持有项目" value={`${held.length} 个`} />
        <Metric label="余仓投入成本" value={`$${money(totalCost)}`} />
        <Metric label="已记总费用" value={`$${money(world.feesUsd)}`} />
        <Metric
          label="风险越界证据"
          value={world.riskEvidence.length}
          tone={world.riskEvidence.length ? "bad" : undefined}
        />
      </div>
      {held.length ? (
        <div className="mw-holdings-list">
          {held.map((position) => {
            const token = world.tokens.find((item) => item.id === position.tokenId);
            if (!token) return null;
            const quote = quoteTrade(world, token.id, "sell", position.quantity);
            const exit =
              quote.ok &&
              BigInt(world.wallet[token.chain].native) >= BigInt(quote.gas) &&
              BigInt(quote.amountOut) > BigInt(quote.gas)
                ? Math.max(0, (units(quote.amountOut) - units(quote.gas)) * world.fx[token.chain])
                : 0;
            const cost = units(position.costUsd);
            return (
              <button
                className="mw-panel mw-holding"
                type="button"
                key={token.id}
                onClick={() => onSelect(token.id)}
              >
                <div className="mw-holding-title">
                  <TokenAvatar token={token} size={40} />
                  <div>
                    <h3>{token.name}</h3>
                    <ChainBadge id={token.chain} short />
                  </div>
                  <ChevronRight size={17} />
                </div>
                <div className="mw-holding-metrics">
                  <Metric
                    label="持有数量"
                    value={compact(units(position.quantity))}
                    sub={token.symbol}
                  />
                  <Metric label="余仓成本" value={`$${money(cost)}`} />
                  <Metric label="预计净退出" value={`$${money(exit)}`} />
                  <Metric
                    label="相对成本"
                    value={`${exit >= cost ? "+" : "−"}$${money(Math.abs(exit - cost))}`}
                    tone={exit >= cost ? "ok" : "bad"}
                  />
                </div>
                {!quote.ok ? (
                  <p className="mw-inline-error">
                    {quote.error ?? "当前无法退出"} · 未按参考价伪造卖出
                  </p>
                ) : null}
                <div className="mw-holding-note">
                  <span>失效价 {position.stopPrice ? compact(position.stopPrice) : "未设"}</span>
                  <span>
                    目标价 {position.targetPrice ? compact(position.targetPrice) : "未设"}
                  </span>
                  <span>{chainSpec(token.chain).native} 计价</span>
                </div>
              </button>
            );
          })}
        </div>
      ) : (
        <EmptyState icon={<Layers size={27} />} title="目前没有持仓">
          保持空仓不会扣纪律分；找到符合自己条件的机会再行动。
        </EmptyState>
      )}
    </div>
  );
}

function WorldEvents({ world, onSelect }: { world: World; onSelect: (id: string) => void }) {
  const [onlyRisk, setOnlyRisk] = useState(false);
  const events = world.events
    .filter(
      (event) =>
        event.at <= world.now &&
        (!onlyRisk ||
          event.violation ||
          /风险|权限|冻结|流动性|失败|回退|停止/.test(event.message)),
    )
    .slice()
    .reverse();
  return (
    <div>
      <div className="mw-view-heading">
        <div>
          <span className="mw-eyebrow">已发生的世界</span>
          <h2>热点在流动，证据留在这里。</h2>
          <p>项目出生、迁移、交易与异常按模拟时间记录。事件不提前揭示未来结局。</p>
        </div>
        <Activity size={28} />
      </div>
      <MarketNews world={world} onSelect={onSelect} />
      <div className="mw-filter-tabs">
        <button
          type="button"
          className={!onlyRisk ? "is-active" : ""}
          onClick={() => setOnlyRisk(false)}
        >
          全部事件
        </button>
        <button
          type="button"
          className={onlyRisk ? "is-active" : ""}
          onClick={() => setOnlyRisk(true)}
        >
          风险与执行异常
        </button>
      </div>
      <section className="mw-panel mw-world-events">
        {events.length ? (
          events.slice(0, 160).map((event) => (
            <div
              className={`mw-world-event ${event.violation ? "mw-event-violation" : ""}`}
              key={event.id}
            >
              <div className="mw-event-marker">
                <span />
              </div>
              <time>{simTime(event.at)}</time>
              <div>
                <p>{event.message}</p>
                <div className="mw-inline">
                  {event.chain ? <ChainBadge id={event.chain} short /> : null}
                  {event.tokenId ? (
                    <button
                      type="button"
                      className="mw-text-link"
                      onClick={() => onSelect(event.tokenId!)}
                    >
                      查看项目
                      <ArrowRight size={12} />
                    </button>
                  ) : null}
                </div>
              </div>
              {event.violation ? <Shield size={16} className="mw-bad" /> : null}
            </div>
          ))
        ) : (
          <EmptyState icon={<Activity size={25} />} title="暂无符合条件的事件">
            市场继续推进后，新事件会保存在这里。
          </EmptyState>
        )}
      </section>
    </div>
  );
}
