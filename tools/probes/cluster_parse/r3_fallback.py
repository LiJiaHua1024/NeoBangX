# -*- coding: utf-8 -*-
"""R3: fallback 场景（a 失败→b 成功）后，第 2 轮 providers 顺序是否把失败者排最前。"""
import asyncio
import re
import sys
from pathlib import Path

sys.path.insert(0, "D:/PycharmProject/NeoBangX/backend")
from app.services import visual_paper_parallel as vpp
from app.services.prompt_loader import PromptLoader

LOADER = PromptLoader(Path("D:/PycharmProject/NeoBangX/prompts"))


def skeleton(n):
    return (f"@@TOTAL@@ {n}\n@@PAPER@@ T\n@@GROUP@@ grammar|G|\n@@PASSAGE_DEF@@ P1\nb\n"
            + "".join(f"@@Q@@ {i}\n@@PASSAGE_REF@@ P1\n@@STEM@@\ns{i}\n@@END_Q@@\n" for i in range(1, n + 1)))


async def main():
    jobs = vpp.plan_explanations(skeleton(2), LOADER, 1)
    print("jobs:", [j.nos for j in jobs])
    trace = []
    fail_once = {"a": True}

    good = ("@@QTYPE@@ blank\n@@ANSWER@@ a\n@@EVIDENCE@@ e\n@@REASON@@ r\n@@DISTRACTOR@@ d\n"
            "@@PITFALLS@@ t::d\n@@PATTERN_NAME@@ n\n@@PATTERN_STEPS@@ s\n@@TRANSFER_PASSAGE@@ p\n"
            "@@TRANSFER_STEM@@ s\n@@TRANSFER_ANSWER@@ a\n@@TRANSFER_EXPL@@ e\n")

    class FakeLLM:
        """模拟 LLMRouter：按 self.providers 顺序尝试，a 首轮抛错后 fallback 到 b。"""

        def __init__(self):
            self.providers = [{"id": "a"}, {"id": "b"}, {"id": "c"}]
            self.provider_used = None
            self.last_provider = None

        async def chat_stream_with_stop(self, *, user_prompt, usage_out, providers_override=None, **kw):
            nos = tuple(re.search(r"完整讲解：([\d,]+)。", user_prompt)[1].split(","))
            # 尊重 providers_override：执行器现在传局部顺序而不是就地改 self.providers
            if providers_override:
                self.providers = list(providers_override)
            entered_order = [p["id"] for p in self.providers]
            self.last_provider = self.providers[0]
            chosen = None
            parts = []
            try:
                if fail_once["a"] and self.providers[0]["id"] == "a":
                    raise RuntimeError("provider a is down")
                # 第 2 轮开始 a 不再失败
                fail_once["a"] = False
                for no in nos:
                    parts.append("@@Q@@ %s\n%s@@END_Q@@\n" % (no, good))
                chosen = self.providers[0]
                self.provider_used = chosen
                usage_out.update(prompt_tokens=1, completion_tokens=1, total_tokens=2)
                for p in parts:
                    yield p
            except RuntimeError as e:
                trace.append((nos[0], entered_order, "EXC", self.providers[0]["id"], str(e)[:20]))
                raise

    events = []
    async for ev, payload in vpp.stream_explanations(
        jobs, build_llm=FakeLLM, stop_event=asyncio.Event(), transfer_count=1, stream_kwargs={}, retry_delay=0,
    ):
        events.append((ev, payload))

    print()
    print("调用时序:")
    for j in jobs:
        for i, call in enumerate(j.attempts, 1):
            print(f"  job{j.id} nos={call['nos']} round={call['round']} state={call['state']} err={call['error'][:40]!r}")
    print()
    print("第一轮 providers 顺序（初始）:", [p["id"] for p in jobs[0].attempts[0]["llm"].providers])
    if len(jobs[0].attempts) > 1:
        print("第二轮 providers 顺序:", [p["id"] for p in jobs[0].attempts[1]["llm"].providers])
    print()
    print("→ 上一轮 a 失败（last_provider=a），previous_provider 取 last_provider='a'，")
    print("  sorted(key=id=='a') 把 a 排最后 → 第二轮从 b 开始（避开失败者，符合注释）")
    print()
    print("=== 但 fallback 成功场景：a 失败→b 成功，previous_provider=b → 排 b 最后、a 最前 ===")
    fail_once["a"] = True
    jobs2 = vpp.plan_explanations(skeleton(2), LOADER, 1)

    class FakeLLM2(FakeLLM):
        async def chat_stream_with_stop(self, *, user_prompt, usage_out, **kw):
            nos = tuple(re.search(r"完整讲解：([\d,]+)。", user_prompt)[1].split(","))
            entered = [p["id"] for p in self.providers]
            self.last_provider = self.providers[0]
            if self.providers[0]["id"] == "a" and fail_once["a"]:
                fail_once["a"] = False
                trace.append((nos[0], entered, "a 抛错"))
                raise RuntimeError("provider a is down")
            # b 成功但只输出不完整块 → 触发重试
            usage_out.update(prompt_tokens=1, completion_tokens=1, total_tokens=2)
            self.provider_used = self.providers[0]
            trace.append((nos[0], entered, "成功(不完整)", self.providers[0]["id"]))
            if fail_once.get("first_done"):
                for no in nos:
                    yield "@@Q@@ %s\n%s@@END_Q@@\n" % (no, good)
            else:
                fail_once["first_done"] = True
                yield "@@Q@@ %s\n@@ANSWER@@ a\n@@END_Q@@\n" % nos[0]

    trace.clear()
    async for ev, payload in vpp.stream_explanations(
        jobs2, build_llm=FakeLLM2, stop_event=asyncio.Event(), transfer_count=1, stream_kwargs={}, retry_delay=0,
    ):
        pass
    print("  时序:")
    for t in trace:
        print("   ", t)
    print("  jobs2[0].attempts:")
    for i, call in enumerate(jobs2[0].attempts, 1):
        print(f"    round={call['round']} nos={call['nos']} providers_order={call.get('providers')}")
    print()
    print("  → 第一轮 entered order=['a','b','c']，a 抛错→b 成功(不完整)")
    print("  → 第二轮 providers order 若为 ['a','c','b'] = b 排最后、a(刚失败者)排最前 → R 成立")


asyncio.run(main())
