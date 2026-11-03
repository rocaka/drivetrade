import type { ChainId, ChainSpec, EasterEggAsset, PlatformSpec } from "./types.ts";

/** Game settings, independent of real-world prices, networks and circulating supply. */
export const EASTER_EGG_ASSETS: readonly {
  id: EasterEggAsset;
  name: string;
  symbol: string;
  chain: ChainId;
  supply: string;
  priceUsd: readonly [number, number];
  liquidityUsd: readonly [number, number];
}[] = [
  {
    id: "btc",
    name: "比特币模拟映射",
    symbol: "BTC",
    chain: "base",
    supply: "21000000",
    priceUsd: [35000, 85000],
    liquidityUsd: [2000000, 4000000],
  },
  {
    id: "eth",
    name: "以太坊模拟映射",
    symbol: "ETH",
    chain: "base",
    supply: "120000000",
    priceUsd: [1500, 4500],
    liquidityUsd: [900000, 2000000],
  },
  {
    id: "sol",
    name: "Solana 模拟映射",
    symbol: "SOL",
    chain: "solana",
    supply: "500000000",
    priceUsd: [70, 220],
    liquidityUsd: [250000, 600000],
  },
  {
    id: "doge",
    name: "狗狗币模拟映射",
    symbol: "DOGE",
    chain: "bnb",
    supply: "150000000000",
    priceUsd: [0.04, 0.3],
    liquidityUsd: [100000, 250000],
  },
];

export const CHAINS: ChainSpec[] = [
  { id: "solana", name: "Solana", native: "SOL", blockSeconds: 1, gas: "12000", initialUsd: 100 },
  { id: "bnb", name: "BNB Chain", native: "BNB", blockSeconds: 3, gas: "1800", initialUsd: 500 },
  { id: "base", name: "Base", native: "ETH", blockSeconds: 2, gas: "140", initialUsd: 2500 },
];
export const PLATFORMS: PlatformSpec[] = [
  {
    id: "curve-harbor",
    name: "曲线港",
    chain: "solana",
    mechanism: "curve",
    lockedLp: true,
    allowMint: false,
    allowFreeze: false,
    allowTax: false,
    feeBps: 100,
    reference: "Pump 类曲线与销毁 LP 的教学原型",
  },
  {
    id: "seed-lab",
    name: "种子工坊",
    chain: "solana",
    mechanism: "curve",
    lockedLp: true,
    allowMint: false,
    allowFreeze: false,
    allowTax: false,
    feeBps: 80,
    reference: "可配置发射与锁定 LP 的教学原型",
  },
  {
    id: "spark-forge",
    name: "火种台",
    chain: "bnb",
    mechanism: "curve",
    lockedLp: true,
    allowMint: false,
    allowFreeze: false,
    allowTax: false,
    feeBps: 100,
    reference: "BNB 发射过程的 CPMM 教学近似",
  },
  {
    id: "social-yard",
    name: "社交铸币站",
    chain: "base",
    mechanism: "direct",
    lockedLp: true,
    allowMint: false,
    allowFreeze: false,
    allowTax: false,
    feeBps: 70,
    reference: "社交铸币过程的 CPMM 教学近似，非真实 v4",
  },
  {
    id: "open-market",
    name: "开放池市集",
    chain: "all",
    mechanism: "direct",
    lockedLp: false,
    allowMint: true,
    allowFreeze: true,
    allowTax: true,
    feeBps: 120,
    reference: "开放权限与自建池教学生态",
  },
];
export const ENGINE_VERSION = "world-2.0.0";
/** Legacy assessments keep ENGINE_VERSION and their frozen generation distribution. */
export const MIXED_ENGINE_VERSION = "world-2.1.0-mixed-v1";
export const chainSpec = (id: string) => CHAINS.find((c) => c.id === id)!;
export const platformSpec = (id: string) => PLATFORMS.find((p) => p.id === id)!;
