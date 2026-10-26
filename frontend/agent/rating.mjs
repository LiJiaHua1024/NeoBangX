/* AA 智能指数 → 打击级别。
   对照表与前端主应用的 `frontend/script.js` 保持一致；agent 模型选择器
   只读取后端的 `aa_index`，不引入另一套评分。留空、非数字或低于 17 分
   一律未评级；59 分及以上是「未知」档。 */
export const AA_STRIKE_LEVELS = [
  { lv: 1, min: 17, max: 35, name: "常规火炮级", alias: "", color: "#64748b",
    gist: "基础逻辑与轻量文本处理；已强于绝大多数普通人，仅在领域专家面前显现智力差距" },
  { lv: 2, min: 36, max: 42, name: "温压弹级", alias: "学科满分级", color: "#d97706",
    gist: "做题家巅峰：彻底打穿人类标准化考试（如高考英语除作文满分），高阶思辨仍受限于既有框架" },
  { lv: 3, min: 43, max: 47, name: "原子弹级", alias: "曼哈顿时刻", color: "#ea580c",
    gist: "初次眩晕瘫坐：单点突破人类专家盲区，解题解析极其细腻，开始让专业学者产生压迫感" },
  { lv: 4, min: 48, max: 51, name: "氢弹级", alias: "热核聚变", color: "#dc2626",
    gist: "规模化智力溢出：从裂变跃升至聚变，在复杂长链条推理与奥赛级难题上形成无死角覆盖" },
  { lv: 5, min: 52, max: 54, name: "光粒级", alias: "恒星引爆", color: "#7c3aed",
    gist: "跨量级定点抹杀：以近光速质量点直接引爆恒星，定点攻克悬置数十年的单点数学猜想" },
  { lv: 6, min: 55, max: 58, name: "二向箔级", alias: "维度坍缩", color: "#0e7490",
    gist: "连同思考过程一起二维化：不仅给出答案，更把人类探索范式的空间彻底拍扁" },
  { lv: 0, min: 59, max: null, name: "未知", alias: "未知的未知", color: "#52525b",
    gist: "超出评级体系上限：强度不可知，故不设打击级别" },
];

export function aaLevelOf(aa) {
  const n = Number(aa);
  if (aa == null || aa === "" || !Number.isFinite(n)) return null;
  const v = Math.floor(n);
  return (
    AA_STRIKE_LEVELS.find(
      (level) => v >= level.min && (level.max == null || v <= level.max),
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
  return `AA 智能指数 ${Number(aa)}（${aaRangeText(level)}）· ${level.name}${
    level.alias ? `（${level.alias}）` : ""
  } —— ${level.gist}`;
}
