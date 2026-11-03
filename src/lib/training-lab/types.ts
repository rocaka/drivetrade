export type LabVersion = "lab-v1" | "lab-v2-trading";
export type LabChain = "solana" | "base";
export type LabAction =
  | { type: "inspect"; tokenId: string }
  | { type: "buy"; tokenId: string; cents: number; slippageBps: number; ttlSteps: number }
  | { type: "sell"; tokenId: string; percent: 25 | 50 | 100 }
  | { type: "fund"; chain: LabChain; cents: number }
  | { type: "bridge"; from: LabChain; to: LabChain; cents: number }
  | { type: "plan"; tokenId: string; stopPrice: number }
  | { type: "wait"; steps: number }
  | {
      type: "trade-plan";
      tokenId: string;
      entryPrice: number;
      stopPrice: number;
      targetPrice: number;
      maxCents: number;
      maxHoldSteps: number;
    }
  | { type: "journal"; phase: "before" | "after"; note: string }
  | { type: "skip"; tokenId: string }
  | { type: "finish" };
export interface LabCheck {
  id: string;
  title: string;
  passed: boolean;
  detail: string;
}
export interface LabResult {
  score: number;
  passed: boolean;
  checks: LabCheck[];
  pnlCents: number;
  feesCents: number;
  completed: boolean;
}
export interface LabRun {
  version: LabVersion;
  challengeId: string;
  seed: string;
  actions: LabAction[];
  result: LabResult;
}
export interface LabToken {
  id: string;
  name: string;
  symbol: string;
  chain: LabChain;
  address: string;
  cluster: string;
  poolCash: number;
  poolUnits: number;
  npcUnits: number;
  initialPoolUnits: number;
  lockedLP: boolean;
  frozen: boolean;
  hype: number;
  curveRemainingCents: number | null;
  initialPrice: number;
  history: { step: number; price: number }[];
}
export interface LabPosition {
  units: number;
  costCents: number;
}
export interface LabOrder {
  id: number;
  tokenId: string;
  cents: number;
  minUnits: number;
  dueStep: number;
  deadline: number;
  status: "pending" | "confirmed" | "reverted" | "expired";
  message: string;
}
export interface LabEvent {
  step: number;
  type: string;
  message: string;
  tokenId?: string;
  cents?: number;
}
export interface LabState {
  version: LabVersion;
  challengeId: string;
  seed: string;
  step: number;
  finished: boolean;
  cash: Record<LabChain, number>;
  gas: Record<LabChain, number>;
  positions: Record<string, LabPosition>;
  tokens: LabToken[];
  marketCash: Record<LabChain, number>;
  feesCents: number;
  initialEquityCents: number;
  initialConservation: number;
  bridge: {
    from: LabChain;
    to: LabChain;
    cents: number;
    dueStep: number;
    status: "pending" | "completed";
  } | null;
  orders: LabOrder[];
  events: LabEvent[];
  inspected: string[];
  stopPlans: Record<string, number>;
  trading?: TradingLabEvidence;
  facts: {
    failedAttempts: number;
    buyCount: number;
    sellCount: number;
    maxStakeCents: number;
    wrongIdentity: boolean;
    addedAfterStop: boolean;
    duplicatePending: boolean;
    capacityViolation: boolean;
    oversized: boolean;
    stopTriggeredAt: number | null;
    stopExitedAt: number | null;
  };
}
export interface LabChallenge {
  id: string;
  title: string;
  summary: string;
  goal: string;
  lessonId: string;
  maxSteps: number;
  targetId: string;
  rules: string[];
}

export interface LabTradePlan {
  source?: "system" | "manual";
  entryPrice: number;
  stopPrice: number;
  targetPrice: number;
  maxCents: number;
  maxHoldSteps: number;
  frozenAt: number;
  actionIndex: number;
}
export interface LabEntry {
  tokenId: string;
  step: number;
  actionIndex: number;
  cents: number;
  price: number;
  impactPct: number;
  estimatedCostCents: number;
  riskReward: number;
  plan: LabTradePlan | null;
}
export interface LabExit {
  tokenId: string;
  step: number;
  actionIndex: number;
  percent: number;
  remainingUnits: number;
  price: number;
  netCents: number;
  targetReached: boolean;
  stopReached: boolean;
}
export interface LabJournal {
  phase: "before" | "after";
  note: string;
  step: number;
  actionIndex: number;
  equityCents: number;
  positionUnits: number;
  buyCount: number;
  sellCount: number;
}
export interface TradingLabEvidence {
  actionCount: number;
  plans: Record<string, LabTradePlan>;
  entries: LabEntry[];
  exits: LabExit[];
  journals: LabJournal[];
  skipped: string[];
  riskBreaches: string[];
  stopAt: Record<string, number>;
  targetAt: Record<string, number>;
  dailyStopped: boolean;
  peakPositions: number;
}
