/* 输入框草稿：已执行任务的补充要求不进任务 config，只能按"用户 + 任务"单独存，
   否则切任务或刷新就会静默丢掉写了一半的内容。单独成模块是为了能在 node 里回归。 */
export function messageKey(userId, taskId) {
  return userId && taskId ? `nbx_agent_msg_${userId}_${taskId}` : "";
}

export function readMessage(storage, key) {
  try {
    return (key && storage.getItem(key)) || "";
  } catch {
    return "";
  }
}

export function writeMessage(storage, key, text) {
  try {
    if (!key) return;
    if (text) storage.setItem(key, text);
    else storage.removeItem(key);
  } catch {}
}
