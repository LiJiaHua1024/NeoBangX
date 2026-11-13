/* AAII v5.0.1 智能指数 → 打击级别。
   对照表与前端主应用的 `frontend/script.js` 保持一致；agent 模型选择器
   只读取后端的 `aa_index`，不引入另一套评分。原始浮点分先四舍五入到整数；
   低于 6 分或未录入一律未评级，66 分及以上是「未知」档。 */
export const AAII_V501_RATING_TIERS = [
  { level: 0, code: "unrated", label: "未评级", shortLabel: "未评级",
    min: -Infinity, max: 5, displayRange: "< 6 分", color: "#a1a1aa", gist: "尚未形成可展示的评级" },
  { level: 1, code: "artillery", label: "Lv.1 常规火炮级", shortLabel: "常规火炮",
    min: 6, max: 22, displayRange: "6–22 分", color: "#64748b",
    gist: "基础逻辑与轻量文本处理；已强于绝大多数普通人，仅在领域专家面前显现智力差距" },
  { level: 2, code: "thermobaric", label: "Lv.2 温压弹级", subLabel: "学科满分级", shortLabel: "温压弹",
    min: 23, max: 33, displayRange: "23–33 分", color: "#d97706",
    gist: "做题家巅峰：彻底打穿人类标准化考试（如高考英语除作文满分），高阶思辨仍受限于既有框架" },
  { level: 3, code: "atomic", label: "Lv.3 原子弹级", subLabel: "曼哈顿时刻", shortLabel: "原子弹",
    min: 34, max: 43, displayRange: "34–43 分", color: "#ea580c",
    gist: "初次眩晕瘫坐：单点突破人类专家盲区，解题解析极其细腻，开始让专业学者产生压迫感" },
  { level: 4, code: "hydrogen", label: "Lv.4 氢弹级", subLabel: "热核聚变", shortLabel: "氢弹",
    min: 44, max: 51, displayRange: "44–51 分", color: "#dc2626",
    gist: "规模化智力溢出：从裂变跃升至聚变，在复杂长链条推理与奥赛级难题上形成无死角覆盖" },
  { level: 5, code: "photoid", label: "Lv.5 光粒级", subLabel: "恒星引爆", shortLabel: "光粒",
    min: 52, max: 58, displayRange: "52–58 分", color: "#7c3aed",
    gist: "跨量级定点抹杀：以近光速质量点直接引爆恒星，定点攻克悬置数十年的单点数学猜想" },
  { level: 6, code: "dual_vector_foil", label: "Lv.6 二向箔级", subLabel: "维度坍缩", shortLabel: "二向箔",
    min: 59, max: 65, displayRange: "59–65 分", color: "#0e7490",
    gist: "连同思考过程一起二维化：不仅给出答案，更把人类探索范式的空间彻底拍扁" },
  { level: 7, code: "unknown", label: "未知", subLabel: "未知的未知", shortLabel: "未知",
    min: 66, max: Infinity, displayRange: "66 分及以上", color: "#52525b",
    gist: "超出评级体系上限：强度不可知，故不设打击级别" },
];

export const AA_STRIKE_LEVELS = AAII_V501_RATING_TIERS
  .filter((tier) => tier.code !== "unrated")
  .map((tier) => ({
    lv: tier.level,
    min: tier.min,
    max: Number.isFinite(tier.max) ? tier.max : null,
    name: tier.label.replace(/^Lv\.\d+\s*/, ""),
    alias: tier.subLabel || "",
    color: tier.color,
    gist: tier.gist,
  }));

export function aaLevelOf(aa) {
  const n = Number(aa);
  if (aa == null || aa === "" || !Number.isFinite(n)) return null;
  const rounded = Math.round(n);
  return (
    AA_STRIKE_LEVELS.find(
      (level) => rounded >= level.min && (level.max == null || rounded <= level.max),
    ) || null
  );
}

export function aaRangeText(level) {
  return level.max == null
    ? `${level.min} 分及以上`
    : `${level.min}–${level.max} 分`;
}

export function strikeTip(aa) {
  const level = aaLevelOf(aa);
  if (!level) return "";
  return `AA 智能指数 ${Number(aa)}（${aaRangeText(level)}），${level.name}${
    level.alias ? `（${level.alias}）` : ""
  } —— ${level.gist}`;
}
