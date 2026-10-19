"""三层决策骨架（app.services.decision）的回归测试。

覆盖：
1. 精确判定命中时**不问 Jev**（省一次往返与费用）；
2. Jev 可用且回包可解析时以 Jev 为准（可覆盖机械兜底的相反结论）；
3. Jev 不可用 / 抛错 / 回包无法解析 / 未配齐 → 一律回退机械兜底，且 `source` 如实标注；
4. `decide()` 永不抛异常：精确判定、兜底、可用性检查三处自身出错都不许把主链路拖下水；
5. state 构造拿到调用方传入的上下文；`spec.timeout` 能覆盖配置里的超时。

这些不变量是三处调用方（Provider 切换、标题任务重试、报错解读的降级判定）共同依赖的，
所以单独测骨架本身，而不是只从调用方侧面覆盖。
"""
import anyio
import pytest

from app.services.decision import (
    SOURCE_CERTAIN,
    SOURCE_HEURISTIC,
    SOURCE_JEV,
    DecisionSpec,
    decide,
)

_JEV_ON = {"enabled": True, "base_url": "https://jev.invalid/v1/systemone", "api_key": "k", "model": "jev-latest"}


class _Boom(Exception):
    """通用异常，用来模拟各处抛错。"""


async def _async_answers(payload: dict) -> dict:
    return payload


async def _async_raise(error: BaseException) -> dict:
    raise error


def _spec(
    *,
    certain=None,
    heuristic=None,
    combine=None,
    ask=None,
    usable=None,
    build_state=None,
    timeout=None,
) -> DecisionSpec:
    return DecisionSpec(
        key="test",
        questions={"q": {"type": "noul"}},
        certain=certain or (lambda exc: None),
        heuristic=heuristic or (lambda exc: True),
        combine=combine or (lambda answers: True),
        ask=ask or (lambda cfg, state, questions: _async_answers({"q": {"noul": 1.0}})),
        usable=usable or (lambda cfg: True),
        build_state=build_state,
        timeout=timeout,
    )


def _certain(value):
    return lambda exc: value


def test_certain_hit_skips_jev():
    """精确判定命中 → 直接返回，一次 Jev 都不问。"""
    calls = []

    def ask(cfg, state, questions):
        calls.append(1)
        return _async_answers({})

    spec = _spec(certain=_certain(False), ask=ask)
    result = anyio.run(decide, spec, _Boom("x"), _JEV_ON)
    assert result.verdict is False
    assert result.source == SOURCE_CERTAIN
    assert result.decided_certainly is True
    assert calls == [], "精确判定命中时不该发 Jev 请求"


def test_jev_verdict_overrides_heuristic():
    """Jev 给了结论就以它为准，哪怕与机械兜底相反。"""
    spec = _spec(
        heuristic=lambda exc: True,
        combine=lambda answers: False,
        ask=lambda cfg, state, questions: _async_answers({"q": {"noul": 0.9}}),
    )
    result = anyio.run(decide, spec, _Boom("x"), _JEV_ON)
    assert result.verdict is False
    assert result.source == SOURCE_JEV
    assert result.decided_by_jev is True


def test_jev_unusable_uses_heuristic_without_asking():
    calls = []

    def ask(cfg, state, questions):
        calls.append(1)
        return _async_answers({})

    spec = _spec(heuristic=lambda exc: True, ask=ask, usable=lambda cfg: bool(cfg))
    result = anyio.run(decide, spec, _Boom("x"), None)
    assert result.verdict is True
    assert result.source == SOURCE_HEURISTIC
    assert result.detail == "jev-unusable"
    assert calls == [], "Jev 没配齐就不该发请求"


@pytest.mark.parametrize("cfg", [
    {"enabled": False, "base_url": "u", "api_key": "k", "model": "m"},
    {"enabled": True, "base_url": "", "api_key": "k", "model": "m"},
])
def test_jev_incomplete_config_is_unusable(cfg):
    """真实可用性判据（未启用 / 缺地址）都走兜底。"""
    from app.services.jev_judge import _jev_usable

    spec = _spec(usable=_jev_usable, heuristic=lambda exc: True)
    result = anyio.run(decide, spec, _Boom("x"), cfg)
    assert result.source == SOURCE_HEURISTIC


def test_jev_error_falls_back():
    spec = _spec(
        heuristic=lambda exc: True,
        ask=lambda cfg, state, questions: _async_raise(TimeoutError("t")),
    )
    result = anyio.run(decide, spec, _Boom("x"), _JEV_ON)
    assert result.verdict is True
    assert result.source == SOURCE_HEURISTIC
    assert result.detail.startswith("jev-error")


def test_unparseable_answer_falls_back():
    spec = _spec(heuristic=lambda exc: False, combine=lambda answers: None)
    result = anyio.run(decide, spec, _Boom("x"), _JEV_ON)
    assert result.verdict is False
    assert result.source == SOURCE_HEURISTIC
    assert result.detail == "jev-unparseable"


def test_non_dict_answer_falls_back():
    spec = _spec(
        heuristic=lambda exc: True,
        ask=lambda cfg, state, questions: _async_answers(["not", "a", "dict"]),
    )
    result = anyio.run(decide, spec, _Boom("x"), _JEV_ON)
    assert result.source == SOURCE_HEURISTIC


def test_certain_raising_still_reaches_jev():
    """精确判定自己抛错时不能中断流程：转去问 Jev。"""
    def certain(exc):
        raise _Boom("certain broke")

    spec = _spec(certain=certain, combine=lambda answers: True)
    result = anyio.run(decide, spec, _Boom("x"), _JEV_ON)
    assert result.verdict is True
    assert result.source == SOURCE_JEV


def test_heuristic_raising_never_propagates():
    """兜底自己抛错也不许外泄：按「不做」处理并如实标注来源。"""
    def heuristic(exc):
        raise _Boom("heuristic broke")

    # 关掉 Jev（usable 为假）才能走到兜底那一步
    spec = _spec(heuristic=heuristic, usable=lambda cfg: False)
    result = anyio.run(decide, spec, _Boom("x"), _JEV_ON)
    assert result.verdict is False
    assert result.source == SOURCE_HEURISTIC


def test_usable_raising_treated_as_unusable():
    def usable(cfg):
        raise _Boom("usable broke")

    spec = _spec(usable=usable, heuristic=lambda exc: True)
    result = anyio.run(decide, spec, _Boom("x"), _JEV_ON)
    assert result.verdict is True
    assert result.source == SOURCE_HEURISTIC


def test_build_state_receives_context():
    """调用方的上下文（模型名、provider 标签等）要进 state，问 Jev 时才能点名判定。"""
    seen = {}

    def build_state(exc, **context):
        seen.update(context)
        return {"error_message": str(exc), **context}

    def ask(cfg, state, questions):
        seen["state"] = state
        return _async_answers({"q": {"noul": 1.0}})

    spec = _spec(build_state=build_state, ask=ask)
    anyio.run(lambda: decide(spec, _Boom("boom"), _JEV_ON, model_id="m1", provider_label="p1"))
    assert seen["model_id"] == "m1"
    assert seen["provider_label"] == "p1"
    assert seen["state"]["error_message"] == "boom"


def test_spec_timeout_overrides_config():
    """交互路径要能压短 Jev 等待：spec.timeout 覆盖配置里的值。"""
    seen = {}

    def ask(cfg, state, questions):
        seen["timeout"] = cfg.get("timeout")
        return _async_answers({"q": {"noul": 1.0}})

    anyio.run(decide, _spec(ask=ask, timeout=1.5), _Boom("x"), {**_JEV_ON, "timeout": 30})
    assert seen["timeout"] == 1.5
    # 不覆盖时原样透传（不污染调用方传进来的配置字典）
    cfg = {**_JEV_ON, "timeout": 30}
    anyio.run(decide, _spec(ask=ask), _Boom("x"), cfg)
    assert seen["timeout"] == 30
    assert cfg["timeout"] == 30

