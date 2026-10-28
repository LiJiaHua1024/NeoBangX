/* 轮询守卫：解决两个陈旧响应的问题。
   1) 序号：只有最新一次请求的响应可以落地，旧响应整份丢弃。
   2) 纪元：本地写过"开始/停止/回答"之后，早于这次写入的响应不再覆盖任务状态。
   （单独成模块是为了能在 node 里直接回归，workspace.js 依赖真实 DOM 无法导入。） */
export function createPollGuard() {
  let seq = 0;
  let epoch = 0;
  return {
    // 每次发起轮询时调用，拿到本次响应的"凭证"。
    begin() {
      return { seq: ++seq, epoch };
    },
    // 是否仍是最新一次轮询：false 表示有更新的请求在飞，这份响应已过期。
    accepts(claim) {
      return claim.seq === seq;
    },
    // 期间有没有本地状态写入：false 表示不要用响应覆盖状态。
    fresh(claim) {
      return claim.epoch === epoch;
    },
    // 本地写入任务状态（开始/停止/回答）时调用。
    bump() {
      epoch += 1;
    },
  };
}
