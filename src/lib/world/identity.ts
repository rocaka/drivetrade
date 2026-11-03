import { hash } from "./random.ts";
import type { Token } from "./types.ts";

export type TokenIdentity = { name: string; symbol: string; narrative: string };
type Word = readonly [zh: string, en: string, ticker: string];
type Culture = { label: string; words: readonly Word[] };

// Cosmetic identity has its own stateless namespace. Calling this never advances
// an economy stream, and neither names nor avatars receive latent quality data.
export const IDENTITY_CULTURES = [
  "动物模因",
  "太空漫游",
  "食物社区",
  "中文互联网",
  "AI 想象",
  "复古网络",
  "奇想日常",
  "混搭文化",
] as const;
const cultures: readonly Culture[] = [
  {
    label: IDENTITY_CULTURES[0],
    words: [
      ["水獭", "Otter", "OTR"],
      ["水豚", "Capy", "CAP"],
      ["狐狐", "Fox", "FOX"],
      ["壁虎", "Gecko", "GEK"],
      ["浣熊", "Raccoon", "RAC"],
      ["袋熊", "Wombat", "WOM"],
      ["渡鸦", "Raven", "RAV"],
      ["螳螂", "Mantis", "MNT"],
      ["海豹", "Seal", "SEA"],
      ["六角龙", "Axolotl", "AXO"],
      ["树懒", "Sloth", "SLT"],
      ["雪貂", "Ferret", "FRT"],
      ["猞猁", "Lynx", "LYX"],
      ["海雀", "Puffin", "PUF"],
      ["小鹿", "Fawn", "FAW"],
      ["蝾螈", "Newt", "NWT"],
      ["羊驼", "Alpaca", "ALP"],
      ["章鱼", "Octo", "OCT"],
      ["刺猬", "Hedgehog", "HDG"],
      ["知更鸟", "Robin", "RBN"],
      ["鲸鲨", "Whaleshark", "WSH"],
      ["飞蛾", "Moth", "MTH"],
      ["蝉", "Cicada", "CIC"],
      ["小熊猫", "Redpanda", "RDP"],
    ],
  },
  {
    label: IDENTITY_CULTURES[1],
    words: [
      ["彗星", "Comet", "CMT"],
      ["星云", "Nebula", "NEB"],
      ["脉冲星", "Pulsar", "PLS"],
      ["日蚀", "Eclipse", "ECL"],
      ["陨石", "Meteor", "MTR"],
      ["月面", "Lunar", "LUN"],
      ["轨道", "Orbit", "ORB"],
      ["类星体", "Quasar", "QSR"],
      ["天顶", "Zenith", "ZEN"],
      ["极光", "Aurora", "AUR"],
      ["远日点", "Aphelion", "APH"],
      ["光帆", "Lightsail", "LSL"],
      ["星尘", "Stardust", "STD"],
      ["木卫二", "Europa", "EUR"],
      ["火卫一", "Phobos", "PHO"],
      ["开普勒", "Kepler", "KPL"],
      ["流星雨", "Starfall", "SFL"],
      ["小行星", "Asteroid", "AST"],
      ["深空", "DeepSpace", "DSP"],
      ["黑洞", "Blackhole", "BLH"],
      ["红矮星", "RedDwarf", "RDW"],
      ["引力波", "Gravity", "GRV"],
      ["天琴", "Lyra", "LYR"],
      ["仙后", "Cassiopeia", "CAS"],
    ],
  },
  {
    label: IDENTITY_CULTURES[2],
    words: [
      ["豆腐", "Tofu", "TOF"],
      ["麻薯", "Mochi", "MOC"],
      ["乌冬", "Udon", "UDN"],
      ["饺子", "Dumpling", "DMP"],
      ["泡芙", "Puff", "PUF"],
      ["芋头", "Taro", "TAR"],
      ["奶茶", "Boba", "BOB"],
      ["椒盐卷", "Pretzel", "PRZ"],
      ["华夫", "Waffle", "WAF"],
      ["小笼包", "Bao", "BAO"],
      ["椰子", "Coconut", "COC"],
      ["开心果", "Pistachio", "PST"],
      ["桃子", "Peach", "PCH"],
      ["拿铁", "Latte", "LAT"],
      ["味噌", "Miso", "MIS"],
      ["曲奇", "Cookie", "CKI"],
      ["年糕", "Ricecake", "RCK"],
      ["布丁", "Pudding", "PUD"],
      ["海苔", "Nori", "NOR"],
      ["百吉饼", "Bagel", "BGL"],
      ["柚子", "Yuzu", "YUZ"],
      ["肉桂", "Cinnamon", "CIN"],
      ["甜豆", "Peapod", "PEA"],
      ["饭团", "Onigiri", "ONG"],
    ],
  },
  {
    label: IDENTITY_CULTURES[3],
    words: [
      ["摸鱼", "Slacker", "SLK"],
      ["躺平", "Loaf", "LOF"],
      ["吃瓜", "MelonWatch", "MLW"],
      ["下班", "Clockout", "CLK"],
      ["咸鱼", "Saltfish", "SLF"],
      ["不慌", "KeepCalm", "KCM"],
      ["早八", "EarlyClass", "ECL"],
      ["画饼", "PiePlan", "PIE"],
      ["发呆", "SpacingOut", "SPO"],
      ["慢半拍", "Laggy", "LAG"],
      ["就这样", "SoItGoes", "SIG"],
      ["歇会儿", "TakeFive", "TKF"],
      ["有空", "FreeTime", "FRT"],
      ["猫猫祟祟", "Sneaky", "SNK"],
      ["纸片人", "PaperPal", "PPL"],
      ["小透明", "Lowkey", "LOW"],
      ["好家伙", "WellThen", "WLT"],
      ["围观", "Onlooker", "ONL"],
      ["摇摆", "Wobble", "WOB"],
      ["周五", "Friday", "FRI"],
      ["随缘", "Whatever", "WTV"],
      ["路过", "PassingBy", "PSB"],
      ["啊对", "YepYep", "YEP"],
      ["不困", "WideAwake", "WAK"],
    ],
  },
  {
    label: IDENTITY_CULTURES[4],
    words: [
      ["智能体", "Agent", "AGT"],
      ["张量", "Tensor", "TNS"],
      ["提示词", "Prompt", "PRM"],
      ["神经元", "Neuron", "NRN"],
      ["内核", "Kernel", "KRN"],
      ["向量", "Vector", "VEC"],
      ["词元", "Lexeme", "LEX"],
      ["字节", "Byte", "BYT"],
      ["电路", "Circuit", "CIR"],
      ["逻辑", "Logic", "LOG"],
      ["缓存", "Cache", "CCH"],
      ["回声", "Echo", "ECH"],
      ["网格", "Mesh", "MSH"],
      ["纳米", "Nano", "NAN"],
      ["矩阵", "Matrix", "MTX"],
      ["权重", "Weight", "WGT"],
      ["分词器", "Tokenizer", "TKZ"],
      ["解码器", "Decoder", "DEC"],
      ["树莓脑", "BerryBrain", "BBR"],
      ["注意力", "Attention", "ATT"],
      ["小模型", "TinyModel", "TMD"],
      ["机器人", "Bot", "BOT"],
      ["数据包", "Packet", "PKT"],
      ["离线", "Offline", "OFL"],
    ],
  },
  {
    label: IDENTITY_CULTURES[5],
    words: [
      ["街机", "Arcade", "ARC"],
      ["磁带", "Cassette", "CST"],
      ["显像管", "CRT", "CRT"],
      ["调制猫", "Modem", "MDM"],
      ["寻呼机", "Pager", "PGR"],
      ["软盘", "Floppy", "FLP"],
      ["摇杆", "Joystick", "JOY"],
      ["录像带", "VHS", "VHS"],
      ["拨号", "Dialup", "DLP"],
      ["电子宠", "PixelPet", "PXP"],
      ["磁盘", "Diskette", "DSK"],
      ["芯片乐", "Chiptune", "CHP"],
      ["论坛", "BBS", "BBS"],
      ["掌机", "Handheld", "HHD"],
      ["雪花屏", "Static", "STC"],
      ["像素", "Pixel", "PXL"],
      ["弹珠", "Pinball", "PIN"],
      ["扫描线", "Scanline", "SCN"],
      ["收音机", "Transistor", "TRS"],
      ["打字机", "Typewriter", "TYP"],
      ["红白机", "Cartridge", "CRG"],
      ["点阵", "Dotmatrix", "DOT"],
      ["命令行", "Terminal", "TRM"],
      ["霓虹灯", "NeonSign", "NEO"],
    ],
  },
  {
    label: IDENTITY_CULTURES[6],
    words: [
      ["纸船", "Paperboat", "PBT"],
      ["泡泡", "Bubble", "BUB"],
      ["枕头", "Pillow", "PLW"],
      ["雪花", "Snowflake", "SNW"],
      ["蜡烛", "Candle", "CND"],
      ["灯笼", "Lantern", "LNT"],
      ["白日梦", "Daydream", "DAY"],
      ["邮差", "Courier", "CRR"],
      ["蘑菇", "Mushroom", "MSR"],
      ["小石头", "Pebble", "PEB"],
      ["茶杯", "Teacup", "TEA"],
      ["雨靴", "Rainboot", "RBT"],
      ["风筝", "Kite", "KIT"],
      ["纸月亮", "PaperMoon", "PPM"],
      ["玻璃海", "GlassSea", "GLS"],
      ["蒲公英", "Dandelion", "DAN"],
      ["风铃", "Windchime", "WCH"],
      ["沙漏", "Hourglass", "HRG"],
      ["小岛", "Islet", "ISL"],
      ["折纸", "Origami", "ORG"],
      ["露珠", "Dewdrop", "DEW"],
      ["蘸水笔", "Quill", "QLL"],
      ["弹簧", "Spring", "SPR"],
      ["梦游", "Sleepwalk", "SLW"],
    ],
  },
];
const modifiers: readonly Word[] = [
  ["午夜", "Midnight", "MD"],
  ["迷你", "Mini", "MN"],
  ["失眠", "Sleepless", "SL"],
  ["云上", "Cloudy", "CY"],
  ["宇宙", "Cosmic", "CO"],
  ["静音", "Silent", "SI"],
  ["弹跳", "Bouncy", "BC"],
  ["慢速", "Slow", "SW"],
  ["薄荷", "Minty", "MI"],
  ["橘色", "Tangerine", "TA"],
  ["毛绒", "Fuzzy", "FZ"],
  ["迷路", "Lost", "LO"],
  ["星期天", "Sunday", "SU"],
  ["口袋", "Pocket", "PK"],
  ["倒带", "Rewind", "RW"],
  ["远方", "Distant", "DI"],
  ["雨天", "Rainy", "RN"],
  ["玻璃", "Glass", "GL"],
  ["纸上", "Paper", "PP"],
  ["反重力", "Antigravity", "AG"],
  ["半糖", "Halfsweet", "HS"],
  ["发条", "Clockwork", "CW"],
  ["快乐", "Happy", "HP"],
  ["懒懒", "Lazy", "LZ"],
  ["漂流", "Drifting", "DF"],
  ["隐身", "Invisible", "IV"],
  ["二次元", "Anime", "AN"],
  ["黄昏", "Twilight", "TW"],
  ["野生", "Wild", "WD"],
  ["透明", "Clear", "CL"],
  ["偏心", "Offbeat", "OB"],
  ["打盹", "Napping", "NP"],
];
const collectives: readonly Word[] = [
  ["俱乐部", "Club", "C"],
  ["实验室", "Lab", "L"],
  ["小屋", "Cabin", "CB"],
  ["工坊", "Works", "W"],
  ["电台", "Radio", "R"],
  ["车站", "Station", "ST"],
  ["花园", "Garden", "G"],
  ["公会", "Guild", "GD"],
  ["剧场", "Theatre", "TH"],
  ["书店", "Bookshop", "BK"],
  ["飞船", "Shuttle", "SH"],
  ["咖啡馆", "Cafe", "CF"],
  ["岛", "Island", "IS"],
  ["档案馆", "Archive", "AR"],
  ["游乐场", "Playground", "PG"],
  ["百货店", "Bazaar", "BZ"],
  ["放映厅", "Cinema", "CN"],
  ["天文台", "Observatory", "OB"],
  ["乐队", "Band", "BD"],
  ["事务所", "Office", "OF"],
  ["走廊", "Hallway", "HW"],
  ["邮局", "Post", "PT"],
  ["航线", "Voyage", "VY"],
  ["博物馆", "Museum", "MU"],
];
const stories = [
  "社区吉祥物",
  "链上小游戏设定",
  "创作者社群",
  "数字收藏叙事",
  "社交实验",
  "网络文化共创",
  "虚构工具叙事",
  "迷因接力",
] as const;
function choice<T>(values: readonly T[], seed: string, index: number, field: string): T {
  return values[hash(`${seed}|token-identity-v1|${index}|${field}`) % values.length];
}

export function deriveIdentity(seed: string, index: number): TokenIdentity {
  if (!Number.isSafeInteger(index) || index < 0)
    throw new RangeError("Token identity index must be a non-negative safe integer");
  const cultureIndex =
    hash(`${seed}|token-identity-v1|${index}|culture`) % IDENTITY_CULTURES.length;
  const culture =
    cultureIndex === 7 ? choice(cultures, seed, index, "mix-culture") : cultures[cultureIndex];
  const motif = choice(culture.words, seed, index, "motif");
  const modifier = choice(modifiers, seed, index, "modifier");
  const group = choice(collectives, seed, index, "collective");
  const form = hash(`${seed}|token-identity-v1|${index}|form`) % 8;
  let name: string;
  let ticker = modifier[2] + motif[2] + group[2];
  let topic = motif[0];
  if (cultureIndex === 7) {
    const otherCulture = choice(
      cultures.filter((c) => c !== culture),
      seed,
      index,
      "partner-culture",
    );
    const other = choice(otherCulture.words, seed, index, "partner-motif");
    const combinations = [
      `${modifier[0]}${motif[0]}与${other[0]}`,
      `${modifier[1]} ${motif[1]} ${other[1]}`,
      `${motif[0]}×${other[1]}${group[0]}`,
      `${modifier[0]}${motif[1]}${other[0]}`,
      `${motif[1]} & ${other[1]} ${group[1]}`,
      `${other[0]}${motif[0]}${group[0]}`,
      `${modifier[1]} ${motif[0]}×${other[1]}`,
      `${motif[1]} ${other[0]} ${group[1]}`,
    ];
    name = combinations[form];
    ticker = modifier[2] + motif[2] + other[2];
    topic = `${motif[0]}与${other[0]}`;
  } else {
    const forms = [
      `${modifier[0]}${motif[0]}${group[0]}`,
      `${modifier[1]} ${motif[1]} ${group[1]}`,
      `${modifier[0]}${motif[1]}${group[0]}`,
      `${modifier[1]} ${motif[0]} ${group[1]}`,
      `${motif[0]}的${modifier[0]}${group[0]}`,
      `${motif[1]} ${modifier[1]} ${group[1]}`,
      `${modifier[0]}${motif[0]} ${group[1]}`,
      `${modifier[1]} ${motif[1]}${group[0]}`,
    ];
    name = forms[form];
  }
  return {
    name,
    symbol: ticker.slice(0, 10),
    narrative: `${IDENTITY_CULTURES[cultureIndex]} · ${topic}主题的${choice(stories, seed, index, "story")}`,
  };
}

/** An address is the public identity. Name changes and hidden risk never recolor it. */
export function avatarSeed(identity: Pick<Token, "id" | "address">): number {
  return hash(`token-avatar-v1|${identity.address.trim() || identity.id}`);
}
