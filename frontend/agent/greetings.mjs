/* 新任务空态的问候语。
   来源：dsh-claude-style 的 features/home/greetings.ts —— Claude 首页按时段轮换问候。
   工作台只有使用码、没有用户名，所以只保留不带称呼的句子。 */

// 夜间时段跨过午夜，小时数按 24 往后数（凌晨 1 点 = 25）。
const SLOTS = [
  { from: 5, to: 12, lines: ["早上好，今天先做什么？", "新的一天，从哪件事开始？", "早，手头有什么任务？"] },
  { from: 12, to: 14, lines: ["中午好，今天的安排是什么？", "午间小憩，还是继续推进？"] },
  { from: 14, to: 18, lines: ["下午好，接下来做什么？", "来杯咖啡，开始干活？", "今天进展如何？"] },
  { from: 18, to: 22, lines: ["晚上好，今天过得怎么样？", "收尾，还是刚刚开始？", "晚上好，还有什么要完成？"] },
  { from: 22, to: 29, lines: ["夜深了，还在忙？", "你好，夜猫子。", "挑灯夜战？"] },
];
const ANYTIME = ["这次想完成什么？", "欢迎回来。", "今天要做点什么？"];

/** 按当前时段抽一句；draw ∈ [0, 1) 由调用方持有，同一次空态内保持不变。 */
export function pickGreeting(draw = Math.random(), now = new Date()) {
  const hour = now.getHours();
  const clock = hour < 5 ? hour + 24 : hour;
  const slot = SLOTS.find((s) => clock >= s.from && clock < s.to);
  const lines = slot ? slot.lines.concat(ANYTIME) : ANYTIME;
  return lines[Math.min(lines.length - 1, Math.floor(draw * lines.length))];
}
