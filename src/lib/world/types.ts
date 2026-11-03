/** Fixed precision: all ledger amounts are integer strings, 6 teaching decimals. */
export type Atom = string;
export type ChainId = "solana" | "bnb" | "base";
export type Regime = "inflow" | "rotation" | "outflow" | "stress";
export type WorldMode = "free" | "practice" | "exam";
export type Side = "buy" | "sell";
export type EasterEggAsset = "btc" | "eth" | "sol" | "doge";
export interface ChainSpec {
  id: ChainId;
  name: string;
  native: string;
  blockSeconds: number;
  gas: Atom;
  initialUsd: number;
}
export interface PlatformSpec {
  id: string;
  name: string;
  chain: ChainId | "all";
  mechanism: "curve" | "direct";
  lockedLp: boolean;
  allowMint: boolean;
  allowFreeze: boolean;
  allowTax: boolean;
  feeBps: number;
  reference: string;
}
export interface Pool {
  kind: "curve" | "cpmm";
  token: Atom;
  quote: Atom;
  virtualToken: Atom;
  virtualQuote: Atom;
  targetQuote: Atom;
  feeBps: number;
  lpFeeBps?: number;
  lpLocked: boolean;
  migratedAt?: number;
}
export interface PricePoint {
  t: number;
  price: number;
  volume: number;
}
export interface Token {
  id: string;
  chain: ChainId;
  platformId: string;
  name: string;
  symbol: string;
  address: string;
  narrative: string;
  /** Fictional mapping on a teaching chain; never a live price or real asset balance. */
  easterEgg?: EasterEggAsset;
  bornAt: number;
  supply: Atom;
  creatorId: string;
  creatorTokens: Atom;
  pool: Pool;
  status: "curve" | "migrating" | "pool" | "dormant" | "dead";
  holders: number;
  volume: number;
  mintAuthority: boolean;
  freezeAuthority: boolean;
  taxMutable: boolean;
  sellTaxBps: number;
  frozen: boolean;
  history: PricePoint[];
  initialPrice: number;
  peakPrice: number;
  trades: number;
  lastTradeAt?: number;
  /** Simulation private state. Never reveal in UI/AI before settlement. */
  latent: {
    intent: "honest" | "dump" | "pull" | "freeze" | "tax" | "mint";
    incidentAt: number;
    fired: boolean;
    appeal: number;
    momentum: number;
  };
}
export interface Balance {
  native: Atom;
  stable: Atom;
}
export interface Position {
  tokenId: string;
  quantity: Atom;
  costUsd: Atom;
  realizedUsd: Atom;
  firstAt: number;
  stopPrice?: number;
  targetPrice?: number;
  protectionSource?: "training-preset" | "user";
}
export interface Participant {
  id: string;
  style: "community" | "momentum" | "whale" | "noise";
  balances: Record<ChainId, Atom>;
  tokens: Record<string, Atom>;
}
export interface WorldEvent {
  id: string;
  seq: number;
  at: number;
  type: string;
  message: string;
  tokenId?: string;
  chain?: ChainId;
  commandId?: string;
  amountUsd?: number;
  violation?: boolean;
  /** Executed state delta, present on new assessment incidents only. */
  effect?: {
    field: "pool_quote" | "frozen" | "sell_tax_bps" | "supply" | "creator_tokens";
    before: Atom;
    after: Atom;
  };
}
export interface Transaction {
  id: string;
  type: "buy" | "sell" | "swap" | "bridge" | "gas_topup";
  tokenId?: string;
  chain: ChainId;
  toChain?: ChainId;
  amount: Atom;
  minOut: Atom;
  note: string;
  submittedAt: number;
  executeAt: number;
  deadline?: number;
  status: "pending" | "confirmed" | "reverted" | "dropped" | "cancelled" | "expired";
  result?: string;
  feeUsd?: number;
  out?: Atom;
  /** Frozen before submission; never inferred from a later winning chart. */
  plan?: TradePlan;
  process?: TradeProcessEvidence;
  source?: "manual" | "safety" | "settlement";
  automatic?: boolean;
  gasService?: { serviceFeeUsd: Atom; gasNative: Atom; gasUsd: Atom; exchangeRate: number };
}
export interface TradePlan {
  version: "plan-v1";
  thesis: "flow" | "probe" | "scale";
  maxLossUsd: number;
  invalidationPrice: number;
  targetPrice: number;
  maxHoldSeconds: number;
  maxImpactPct: number;
  evidence: string[];
}
export interface TradeProcessEvidence {
  version: "process-v1" | "process-v2-trading";
  origin?: "automatic-snapshot";
  guide?: {
    origin: "training-preset";
    version: "guide-v1";
    stopPrice: number;
    targetPrice: number;
    maxHoldSeconds: number;
  };
  exposure?: { projectUsd: number; clusterUsd: number; totalUsd: number };
  at: number;
  price: number;
  equityUsd: number;
  amountUsd: number;
  impactPct: number;
  liquidityUsd: number;
  creatorPct: number;
  holders: number;
  momentumPct: number;
  existingQuantity: Atom;
  sellable: boolean;
  permissions: { lpLocked: boolean; mint: boolean; freeze: boolean; mutableTax: boolean };
  confirmedAt?: number;
  filledCostUsd?: number;
  filledImpactPct?: number;
  quantity?: Atom;
  remaining?: Atom;
  triggerAt?: number;
  trigger?: "stop" | "target" | "timeout";
  exitAttemptAt?: number;
  exitTransactionId?: string;
  closedAt?: number;
  closedBy?: "manual" | "safety" | "settlement";
  automaticExitAt?: number;
  automaticExitTransactionId?: string;
  buyFeesUsd?: number;
  sellFeesUsd?: number;
  manualReduced?: Atom;
  manualExitConfirmedAt?: number;
  manualExitConfirmedId?: string;
}
export interface ProcessCheck {
  id: string;
  label: string;
  passed: boolean | null;
  detail: string;
  weight: number;
  transactionId?: string;
  eventIds: string[];
}
export interface ProcessReport {
  version: "process-v1" | "process-v2-trading";
  score: number;
  decisions: number;
  checks: ProcessCheck[];
  weaknesses: string[];
}
export interface TokenOutcome {
  tokenId: string;
  symbol: string;
  classification: "quality" | "speculative" | "rug" | "dump" | "inactive" | "insufficient";
  label: string;
  reason: string;
  returnPct: number;
  peakReturnPct: number;
  ageSeconds: number;
  liquidityUsd: number;
  standardExitUsd: number;
  sellable: boolean;
  eventIds: string[];
}
export interface BridgeTransfer {
  id: string;
  from: ChainId;
  to: ChainId;
  amount: Atom;
  fee: Atom;
  dueAt: number;
  status: "in_transit" | "completed" | "refunded";
}
export type MarketVariant = "standard" | "thin" | "busy" | "costly";
/** Omitted on existing worlds: their original generation and replay stay unchanged. */
export type GenerationProfile = "mixed-v1";
export interface WorldConfig {
  seed: string;
  mode: WorldMode;
  regime: Regime;
  marketVariant?: MarketVariant;
  generationProfile?: GenerationProfile;
  /** Optional to preserve the original grades and replay of existing worlds. */
  assessmentVersion?: "process-v1" | "process-v2-trading";
  spawnPerMinute: number;
  protection: boolean;
  duration: number;
  label?: string;
  runId?: string;
}
export interface RiskEvidence {
  at: number;
  code: string;
  message: string;
  commandId: string;
}
export interface EquityPoint {
  t: number;
  equity: number;
  baseline: number;
}
export interface WorldReport {
  worldId: string;
  seed: string;
  regime: Regime;
  mode: WorldMode;
  marketVariant?: MarketVariant;
  assessmentVersion?: "process-v1" | "process-v2-trading";
  generationProfile?: GenerationProfile;
  process?: ProcessReport;
  outcomes?: TokenOutcome[];
  elapsed: number;
  completed: boolean;
  initial: number;
  final: number;
  pnl: number;
  returnPct: number;
  baselineReturnPct: number;
  excessPct: number;
  fees: number;
  trades: number;
  violations: number;
  maxDrawdownPct: number;
  residual: number;
  discipline: { risk: number; execution: number; review: number };
  events: WorldEvent[];
}
export interface World {
  version: 1;
  engineVersion: string;
  id: string;
  config: WorldConfig;
  now: number;
  nextId: number;
  phase: "running" | "paused" | "settling" | "completed";
  tokens: Token[];
  wallet: Record<ChainId, Balance>;
  initialWallet: Record<ChainId, Balance>;
  fx: Record<ChainId, number>;
  initialFx: Record<ChainId, number>;
  positions: Record<string, Position>;
  participants: Participant[];
  treasury: Record<ChainId, Balance>;
  bank: Record<ChainId, Balance>;
  burnt: Record<ChainId, Atom>;
  lockedTokens: Record<string, Atom>;
  transactions: Transaction[];
  bridges: BridgeTransfer[];
  events: WorldEvent[];
  riskEvidence: RiskEvidence[];
  equity: EquityPoint[];
  feesUsd: number;
  initialEquity: number;
  highWater: number;
  maxDrawdownPct: number;
  realizedUsd: Atom;
  processedCommands: string[];
  stopUntil: number;
  dayStartEquity: number;
  settlementStartedAt?: number;
  report?: WorldReport;
}
export interface Quote {
  ok: boolean;
  error?: string;
  amountIn: Atom;
  amountOut: Atom;
  fee: Atom;
  externalFee?: Atom;
  retainedFee?: Atom;
  gas: Atom;
  impactPct: number;
  price: number;
}
export interface GasTopupQuote {
  ok: boolean;
  error?: string;
  amountUsd: Atom;
  nativeOut: Atom;
  serviceFeeUsd: Atom;
  gasNative: Atom;
  gasUsd: Atom;
  totalFeeUsd: Atom;
}
export type WorldCommand =
  | {
      id: string;
      type: "buy" | "sell";
      tokenId: string;
      amount: Atom;
      minOut: Atom;
      note?: string;
      deadline?: number;
      stopPrice?: number;
      targetPrice?: number;
      plan?: TradePlan;
    }
  | {
      id: string;
      type: "swap";
      chain: ChainId;
      direction: "to_native" | "to_stable";
      amount: Atom;
      note: string;
    }
  | { id: string; type: "bridge"; from: ChainId; to: ChainId; amount: Atom; note: string }
  | { id: string; type: "gas_topup"; chain: ChainId; amount: Atom; note: string }
  | { id: string; type: "protect"; tokenId: string; stopPrice?: number; targetPrice?: number }
  | { id: string; type: "wait"; note: string }
  | { id: string; type: "abandon" }
  | { id: string; type: "extend" }
  | { id: string; type: "finish" };
export interface CommandResult {
  world: World;
  ok: boolean;
  error?: string;
}
