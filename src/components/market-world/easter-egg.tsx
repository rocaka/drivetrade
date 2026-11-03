import "./easter-egg.css";

export type EasterEggKind = "btc" | "eth" | "sol" | "doge";
type EasterEggToken = { easterEgg?: EasterEggKind };

const referenceAssets = {
  btc: { symbol: "BTC", name: "Bitcoin" },
  eth: { symbol: "ETH", name: "Ethereum" },
  sol: { symbol: "SOL", name: "Solana" },
  doge: { symbol: "DOGE", name: "Dogecoin" },
} as const;

function referenceAsset(token: EasterEggToken) {
  return token.easterEgg ? referenceAssets[token.easterEgg] : undefined;
}

function referenceDescription(asset: { name: string; symbol: string }) {
  return `${asset.name}（${asset.symbol}）彩蛋：模拟参考资产，非真实链上代币；价格由本地市场模拟，非实时行情。`;
}

export function EasterEggBadge({ token }: { token: EasterEggToken }) {
  const asset = referenceAsset(token);
  if (!asset) return null;
  const description = referenceDescription(asset);
  return (
    <span className="mw-easter-egg-badge" title={description} aria-label={description}>
      彩蛋 · {asset.symbol}
    </span>
  );
}

export function EasterEggInfo({ token }: { token: EasterEggToken }) {
  const asset = referenceAsset(token);
  if (!asset) return null;
  const description = referenceDescription(asset);
  return (
    <p className="mw-easter-egg-info" role="note" title={description} aria-label={description}>
      <span>{asset.symbol} 参考资产</span>
      <span aria-hidden="true">·</span>
      <span>本地模拟价格，非实时行情</span>
    </p>
  );
}
