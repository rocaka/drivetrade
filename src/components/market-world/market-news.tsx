import { useMemo } from "react";
import { MessageCircle, Radio, ShieldCheck } from "lucide-react";
import type { Token, World, WorldEvent } from "@/lib/world/types";
import { hash } from "@/lib/world/random";
import { ChainBadge, platformName, simTime } from "./shared";

type PublicMessage = {
  id: string;
  at: number;
  text: string;
  source: string;
  kind: "confirmed" | "inferred";
  token?: Token;
};

const PUBLIC_EVENTS = new Set([
  "token_born",
  "migration_pending",
  "migrated",
  "liquidity_removed",
  "permission_used",
  "tax_changed",
  "supply_changed",
  "pool_exhausted",
]);

function eventMessage(event: WorldEvent, token?: Token): PublicMessage {
  return {
    id: event.id,
    at: event.at,
    text: event.message,
    source: "模拟链已确认事件",
    kind: "confirmed",
    token,
  };
}

/** Discussion uses only public identity and a public time bucket, never latent intent. */
function discussion(token: Token, now: number): PublicMessage {
  const bucket = Math.floor(now / 180);
  const templates = [
    `虚构群聊有人说“${token.symbol} 可能是下一个热点”。这是未经核实的观点，讨论不能替代实际买盘。`,
    `虚构观察者正在讨论 ${token.symbol} 的叙事。认同叙事不等于有足够流动性供你退出。`,
    `虚构群聊对 ${token.symbol} 看法分歧。有人想追，有人继续等；双方都没有未来行情证据。`,
    `虚构频道转发了 ${token.symbol} 的名字。重复出现可能只是传播，不能据此确认项目质量。`,
    `虚构讨论提醒先核对 ${token.symbol} 的地址和权限。提醒本身不是风险扫描或安全认证。`,
  ];
  return {
    id: `discussion-${token.id}-${bucket}`,
    at: Math.max(token.bornAt, bucket * 180),
    text: templates[hash(`${token.address}:${bucket}`) % templates.length],
    source: "合成社区频道 · 虚构发言",
    kind: "inferred",
    token,
  };
}

export function MarketNews({
  world,
  tokenId,
  onSelect,
  compact = false,
}: {
  world: World;
  tokenId?: string;
  onSelect?: (id: string) => void;
  compact?: boolean;
}) {
  const messages = useMemo(() => {
    const tokens = tokenId
      ? world.tokens.filter((token) => token.id === tokenId)
      : world.tokens;
    const selected = new Map(tokens.map((token) => [token.id, token]));
    const events = world.events
      .filter(
        (event) =>
          event.at <= world.now &&
          PUBLIC_EVENTS.has(event.type) &&
          (!tokenId || event.tokenId === tokenId),
      )
      .slice(-8)
      .map((event) =>
        eventMessage(
          event,
          event.tokenId ? selected.get(event.tokenId) : undefined,
        ),
      );
    const chatter = tokens
      .filter((token) => token.bornAt <= world.now && token.status !== "dead")
      .slice(-3)
      .map((token) => discussion(token, world.now));
    return [...events, ...chatter]
      .sort((a, b) => b.at - a.at || a.id.localeCompare(b.id))
      .slice(0, compact ? 3 : 9);
  }, [world, tokenId, compact]);

  return (
    <section
      className={`mw-panel mw-news ${compact ? "mw-news-compact" : ""}`}
      data-testid="market-public-news"
    >
      <div className="mw-panel-title">
        <h3>
          <Radio size={17} />
          市场广播
        </h3>
        <span className="mw-tag">全部为模拟信息</span>
      </div>
      <p className="mw-panel-description">
        链上事实与社区观点分开看。虚构讨论不预测未来，也不代表独立的人或新增资金。
      </p>
      <div className="mw-news-list">
        {messages.length ? (
          messages.map((message) => {
            const age = Math.max(0, world.now - message.at);
            const fresh = age <= 180;
            return (
              <article
                className={`mw-news-item ${message.kind}`}
                key={message.id}
                data-evidence-status={message.kind}
              >
                <div className="mw-news-meta">
                  {message.kind === "confirmed" ? (
                    <ShieldCheck size={14} />
                  ) : (
                    <MessageCircle size={14} />
                  )}
                  <strong>
                    {message.kind === "confirmed" ? "已确认事实" : "未核实观点"}
                  </strong>
                  <time>{simTime(message.at)}</time>
                  {message.token && (
                    <ChainBadge id={message.token.chain} short />
                  )}
                </div>
                <p>{message.text}</p>
                <div className="mw-evidence-meta">
                  <span>来源：{message.source}</span>
                  <span>
                    新鲜度：{fresh ? "近期" : `${Math.floor(age / 60)} 分钟前`}
                  </span>
                  <span>
                    证据置信：
                    {message.kind === "confirmed"
                      ? "高 · 事件记录"
                      : "低 · 不作交易依据"}
                  </span>
                </div>
                {message.token && onSelect ? (
                  <button
                    className="mw-text-link"
                    type="button"
                    onClick={() => onSelect(message.token!.id)}
                  >
                    查看 {message.token.symbol} ·{" "}
                    {platformName(message.token.platformId)}
                  </button>
                ) : null}
              </article>
            );
          })
        ) : (
          <p className="mw-muted">暂无已发生的公开消息。</p>
        )}
      </div>
    </section>
  );
}
