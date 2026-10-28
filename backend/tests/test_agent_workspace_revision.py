"""修订链路：写作者按依据重建会话、修改块应用与重试、出错时保留已生效的修改、审阅意见交回调度。"""
import asyncio
import json
import re

import pytest
from sqlalchemy import select

from app.database import SessionLocal
from app.agent_workspace import api, store, tools, runner, llm, writer
from app.agent_workspace.instructions import DEFAULT_BEHAVIOR, LEGACY_BEHAVIORS, WRITER_SYSTEM
from app.agent_workspace.models import WorkspaceMaterial, WorkspaceTask, WorkspaceEntry


@pytest.fixture
def identity(workspace_code):
    return workspace_code('REVISE-', quota=50)


@pytest.fixture(autouse=True)
def no_runtime_config(monkeypatch):
    monkeypatch.setattr(runner, '_load_cfg', lambda: {})


def task(identity, material='原文一。原文二。', **config):
    config = {'review': False, **config}
    with SessionLocal() as db:
        row = WorkspaceTask(id=store.uid(), owner=identity[0], title='修订测试', config=store.encode(
            api.TaskConfig(goal='根据材料分析', model='test', **config).model_dump()))
        db.add(row)
        db.commit()
        t = store.task_dict(row, True)
    m = api.add_material(identity[0], t['id'], '材料', material)
    t = store.update_task(identity[0], t['id'], t['revision'], {**t['config'], 'materials': [m['id']]})
    return t, m


def start(identity, t, mode='execute', base='', instruction='', steps=12):
    snapshot = {'model': 'test', 'limits': {'max_steps': steps, 'max_tokens': 400000, 'output_tokens': 16000, 'max_seconds': 60},
                'templates': {}}
    return store.create_run(identity[0], t['id'], store.uid(), mode, instruction, base, snapshot, True)


def scripted(replies, seen):
    """按顺序返回预设输出；回复为异常实例时抛出。记录每次请求的 messages 副本。"""
    replies = iter(replies)

    async def model(cfg, model, messages, schemas, budget, emit, **kwargs):
        seen.append([dict(m) for m in messages])
        reply = next(replies)
        if isinstance(reply, BaseException):
            raise reply
        await emit('output', reply)
        return llm.ModelResult(content=reply)
    return model


def revise_call(obj, call_id, **args):
    return obj.tool_call({'id': call_id, 'function': {'name': 'revise_document', 'arguments': json.dumps(args, ensure_ascii=False)}})


DRAFT = '原文一。原文二。分析甲。分析乙。'


# ---- 纯函数 ----

def test_parse_edits_handles_tag_newlines_fences_and_broken_blocks():
    text = ('第 1 条：采纳 —— 材料支持\n```xml\n<edit>\n<old>\n甲句。\n</old>\n<new>\n乙句。\n</new>\n</edit>\n'
            '<edit><old>缺结束标签</old><new>x</new>\n'
            '<edit><old>丙</old><new></new></edit>\n```')
    parsed = writer.parse_edits(text)
    assert parsed.explanation == '第 1 条：采纳 —— 材料支持'
    assert parsed.edits == [(1, '甲句。', '乙句。'), (3, '丙', '')]
    assert [n for n, _ in parsed.problems] == [2]
    cut = writer.parse_edits('说明\n<edit><old>完整</old><new>块</new></edit>\n<edit><old>半截', truncated=True)
    assert cut.edits == [(1, '完整', '块')]
    assert cut.problems == [(2, '输出在这一块处达到上限被截断')]


def test_apply_edits_reports_each_unlocatable_block():
    draft = '开头。学生需要先阅读材料，再回答问题。第二句。第二句。'
    edits = [(1, '开头。', '首句。'), (2, '第二句。', 'x'), (3, '学生需要先阅读材料，然后回答问题。', 'y'), (4, '', 'z'), (5, '同', '同')]
    result, applied, failures = writer.apply_edits(draft, edits)
    assert result == '首句。学生需要先阅读材料，再回答问题。第二句。第二句。'
    assert applied == 1
    assert [n for n, _ in failures] == [2, 3, 4]
    assert '2 次' in failures[0][1]
    assert '最接近的位置' in failures[1][1] and '学生需要先阅读材料，再回答' in failures[1][1]
    assert writer.apply_edits('甲\r\n乙', [(1, '甲\n乙', '丙')])[0] == '丙'


# ---- 作者会话重建 ----

def test_revision_rebuilds_author_prefix_and_saves_one_version(identity):
    t, m = task(identity)
    r = start(identity, t)
    seen = []
    edits = ('第 1 条：采纳 —— 材料支持\n<edit><old>分析甲。</old><new>分析甲（具体）。</new></edit>\n'
             '<edit><old>分析乙。</old><new>分析乙（具体）。</new></edit>')

    async def execute():
        obj = runner.Runner(r['id'], scripted([DRAFT, edits, '其他要求：已经足够具体，不再修改。'], seen))
        await obj.load()
        v = await obj.create_document({'title': '成果', 'instruction': '分析', 'material_ids': [m['id']]}, 'tool:gen')
        first = await revise_call(obj, 'rev1', version_id=v['id'], instruction='把分析写得更具体')
        second = await revise_call(obj, 'rev2', version_id=first['id'], instruction='再检查一遍')
        return v, first, second

    v, first, second = asyncio.run(execute())
    generation, revision, again = seen
    assert generation[0] == {'role': 'system', 'content': WRITER_SYSTEM}
    # 修订请求的前缀与生成请求逐字一致，稿子以作者自己的输出出现。
    assert revision[:2] == generation
    assert revision[2] == {'role': 'assistant', 'content': DRAFT}
    assert '把分析写得更具体' in revision[3]['content'] and '<edit>' in revision[3]['content']
    doc = tools.document(t['id'], first['id'])
    assert doc['content'] == '原文一。原文二。分析甲（具体）。分析乙（具体）。'
    assert doc['parent_id'] == v['id'] and writer.authored(doc)
    assert first['new_version'] and first['applied'] == 2 and '采纳' in first['explanation']
    # 第二轮仍是同一作者会话：前缀不变，稿子换成修订后的全文，并带上一轮的处理记录。
    assert again[:2] == generation and again[2]['content'] == doc['content']
    assert '<previous_rounds>' in again[3]['content'] and '把分析写得更具体' in again[3]['content']
    assert second['new_version'] is False and '不再修改' in second['explanation']
    assert len(store.task_detail(identity[0], t['id'])['versions']) == 2
    store.finish_run(r['id'], 'completed')


def test_failed_blocks_are_retried_in_the_same_session(identity):
    t, m = task(identity)
    r = start(identity, t)
    seen = []
    replies = [DRAFT,
               '第 1 条：采纳\n<edit><old>分析甲。</old><new>甲改。</new></edit>\n<edit><old>分析丙。</old><new>丙改。</new></edit>',
               '<edit><old>分析乙。</old><new>乙改。</new></edit>']

    async def execute():
        obj = runner.Runner(r['id'], scripted(replies, seen))
        await obj.load()
        v = await obj.create_document({'title': '成果', 'instruction': '分析', 'material_ids': [m['id']]}, 'tool:gen')
        return await revise_call(obj, 'rev', version_id=v['id'], instruction='修改甲和乙')

    result = asyncio.run(execute())
    retry = seen[2]
    assert retry[-2]['role'] == 'assistant' and '分析丙' in retry[-2]['content']
    assert '第 2 块' in retry[-1]['content'] and '找不到' in retry[-1]['content']
    assert tools.document(t['id'], result['id'])['content'] == '原文一。原文二。甲改。乙改。'
    assert result['unresolved'] == '' and result['applied'] == 2
    assert len(store.task_detail(identity[0], t['id'])['versions']) == 2
    store.finish_run(r['id'], 'completed')


def test_user_edited_draft_keeps_author_context_without_claiming_authorship(identity):
    t, m = task(identity)
    r = start(identity, t)
    seen = []
    replies = [DRAFT, '<edit><old>教师补充。</old><new>教师补充（已核对）。</new></edit>',
               '<edit><old>分析甲。</old><new>甲。</new></edit>']

    async def execute():
        obj = runner.Runner(r['id'], scripted(replies, seen))
        await obj.load()
        v = await obj.create_document({'title': '成果', 'instruction': '分析', 'material_ids': [m['id']]}, 'tool:gen')
        manual = store.save_version(t['id'], '', 'manual:' + store.uid(), '手改', DRAFT + '教师补充。', v['id'], 'manual')
        first = await revise_call(obj, 'rev1', version_id=manual['id'], instruction='核对教师补充')
        second = await revise_call(obj, 'rev2', version_id=first['id'], instruction='精简甲')
        return first, second

    first, second = asyncio.run(execute())
    for request, current in ((seen[1], DRAFT + '教师补充。'), (seen[2], DRAFT + '教师补充（已核对）。')):
        assert request[:2] == seen[0]
        # 作者看到的是自己的原稿；用户改过的当前稿单独给出，不冒充为模型输出。
        assert request[2] == {'role': 'assistant', 'content': DRAFT}
        assert '用户手动修改' in request[3]['content'] and '<current_draft>\n' + current + '\n</current_draft>' in request[3]['content']
    doc = tools.document(t['id'], first['id'])
    assert doc['content'] == DRAFT + '教师补充（已核对）。' and not writer.authored(doc)
    assert tools.document(t['id'], second['id'])['content'] == '原文一。原文二。甲。分析乙。教师补充（已核对）。'
    store.finish_run(r['id'], 'completed')


def test_version_without_writer_lineage_uses_fresh_session(identity):
    t, m = task(identity)
    r = start(identity, t)
    legacy = store.save_version(t['id'], '', 'legacy', '旧稿', '旧稿正文。', provenance={'requirements': '按旧要求分析', 'materials': [m['id']]})
    seen = []

    async def execute():
        obj = runner.Runner(r['id'], scripted(['<edit><old>旧稿正文。</old><new>新正文。</new></edit>'], seen))
        await obj.load()
        return await revise_call(obj, 'rev', version_id=legacy['id'], instruction='改写正文')

    result = asyncio.run(execute())
    messages = seen[0]
    assert len(messages) == 2 and messages[0]['content'] == WRITER_SYSTEM
    body = messages[1]['content']
    assert body.index('按旧要求分析') < body.index('不是你写的') < body.index('旧稿正文。') < body.index('改写正文')
    assert '原文一。' in body
    assert tools.document(t['id'], result['id'])['content'] == '新正文。'
    store.finish_run(r['id'], 'completed')


def test_changed_basis_falls_back_to_fresh_session(identity):
    t, m = task(identity)
    r = start(identity, t)
    seen = []

    async def execute():
        obj = runner.Runner(r['id'], scripted([DRAFT, '<edit><old>分析甲。</old><new>甲。</new></edit>'], seen))
        await obj.load()
        v = await obj.create_document({'title': '成果', 'instruction': '分析', 'material_ids': [m['id']]}, 'tool:gen')
        with SessionLocal() as db:
            db.get(WorkspaceMaterial, m['id']).content = '材料被改过'
            db.commit()
        return await revise_call(obj, 'rev', version_id=v['id'], instruction='精简')

    result = asyncio.run(execute())
    assert len(seen[1]) == 2 and '不是你写的' in seen[1][1]['content']
    assert result['new_version']
    store.finish_run(r['id'], 'completed')


# ---- 意见来源 ----

def test_review_issues_are_quoted_from_archive_and_respect_ignored(identity):
    t, m = task(identity)
    v = store.save_version(t['id'], '', 'base', '成果', DRAFT)
    r = start(identity, t, mode='revise', base=v['id'], instruction='用户选择修订：补充出处')
    issues = [{'quote': '分析甲。', 'problem': '缺出处甲', 'evidence': '材料第一句', 'fix': '补出处', 'certainty': 'confirmed'},
              {'quote': '分析乙。', 'problem': '用户已忽略乙', 'evidence': '', 'fix': '', 'certainty': 'uncertain'},
              {'quote': '', 'problem': '整体缺结论丙', 'evidence': '', 'fix': '补结论', 'certainty': 'uncertain'}]
    entry = store.start_entry(t['id'], r['id'], 'review-x', 'review', '开放式审阅')
    store.append_chunks(entry['id'], {'review': store.encode({'summary': '有三处问题', 'issues': issues})})
    store.finish_entry(entry['id'], 'done', {'version_id': v['id'], 'issues': 3, 'ignored': [1]})
    other = store.start_entry(t['id'], r['id'], 'tool-x', 'tool', 'read_material')
    seen = []

    async def execute():
        obj = runner.Runner(r['id'], scripted(['第 1 条：不采纳 —— 已有出处'], seen))
        await obj.load()
        errors = [await revise_call(obj, 'e1', version_id=v['id'], instruction='改', issues=[1]),
                  await revise_call(obj, 'e2', version_id=v['id'], instruction='改', review_id=entry['id'], issues=[4]),
                  await revise_call(obj, 'e3', version_id=v['id'], instruction='改', review_id=other['id']),
                  await revise_call(obj, 'e4', version_id=v['id'], instruction=' ', review_id=entry['id'], issues=[2])]
        ok = await revise_call(obj, 'ok', version_id=v['id'], instruction='按用户选择处理', review_id=entry['id'],
                               issues=[1, 2, 3], include_user_request=True)
        return errors, ok

    errors, ok = asyncio.run(execute())
    assert all(e.get('unchanged') and e.get('error') for e in errors)
    assert 'review_id' in errors[0]['error'] and '共 3 条' in errors[1]['error']
    assert '已被用户忽略' in errors[3]['error']
    request = seen[0][-1]['content']
    assert '1. [已核实] 缺出处甲' in request and '原文：「分析甲。」' in request
    assert '3. [待核实] 整体缺结论丙' in request and '用户已忽略乙' not in request
    assert '用户原话：\n用户选择修订：补充出处' in request and '按用户选择处理' in request
    assert ok['new_version'] is False
    assert len(store.task_detail(identity[0], t['id'])['versions']) == 1
    store.finish_run(r['id'], 'completed')


def test_incomplete_version_is_not_revised(identity):
    t, m = task(identity)
    v = store.save_version(t['id'], '', 'part', '半成品', '未完', complete=False)
    r = start(identity, t)
    seen = []

    async def execute():
        obj = runner.Runner(r['id'], scripted([], seen))
        await obj.load()
        return await revise_call(obj, 'rev', version_id=v['id'], instruction='改')

    result = asyncio.run(execute())
    assert result['unchanged'] and '尚未完整' in result['error'] and not seen
    store.finish_run(r['id'], 'completed')


# ---- 出错时的行为 ----

def generate_then(identity, replies):
    t, m = task(identity)
    r = start(identity, t)
    seen = []
    obj = runner.Runner(r['id'], scripted([DRAFT] + replies, seen))

    async def prepare():
        await obj.load()
        return await obj.create_document({'title': '成果', 'instruction': '分析', 'material_ids': [m['id']]}, 'tool:gen')
    v = asyncio.run(prepare())
    return t, r, obj, v, seen


def test_writer_calls_are_marked_apart_from_scheduler_steps(identity):
    """对话只铺开调度 Agent 的消息；写作者的生成与修订按 role 识别，按 source 归并续写。"""
    t, r, obj, v, seen = generate_then(identity, ['第 1 条：采纳\n<edit><old>分析甲。</old><new>甲改。</new></edit>', '好的'])

    async def follow():
        await revise_call(obj, 'rev', version_id=v['id'], instruction='修改')
        await obj.call('执行步骤 9', [{'role': 'user', 'content': '继续'}])
    asyncio.run(follow())
    with SessionLocal() as db:
        rows = db.scalars(select(WorkspaceEntry).where(WorkspaceEntry.run_id == r['id'], WorkspaceEntry.kind == 'model')).all()
        details = {row.label: store.decode(row.details) for row in rows}
    assert details['成果']['role'] == 'writer' and details['成果']['source'] == 'tool:gen'
    assert details['修订《成果（修订）》']['role'] == 'writer' and details['修订《成果（修订）》']['source'] == 'tool:rev'
    assert details['执行步骤 9']['role'] == 'agent' and 'source' not in details['执行步骤 9']
    # 调用进行中的用量估算：上下文在开始时记下，输出随每次落盘累加。
    assert all(d['context_tokens'] > 0 and d['live_tokens'] > 0 for d in details.values())
    store.finish_run(r['id'], 'completed')


HALF = '第 1 条：采纳\n<edit><old>分析甲。</old><new>甲改。</new></edit>\n<edit><old>不存在的句子。</old><new>x</new></edit>'


def test_budget_during_retry_keeps_applied_edits_as_partial_version(identity):
    t, r, obj, v, seen = generate_then(identity, [HALF, runner.BudgetReached('预算用尽')])
    with pytest.raises(runner.BudgetReached):
        asyncio.run(revise_call(obj, 'rev', version_id=v['id'], instruction='修改'))
    versions = store.task_detail(identity[0], t['id'])['versions']
    assert len(versions) == 2 and '部分修改' in versions[-1]['title'] and versions[-1]['complete']
    doc = tools.document(t['id'], versions[-1]['id'])
    assert doc['content'] == '原文一。原文二。甲改。分析乙。'
    assert doc['provenance']['revisions'][-1]['status'] == 'partial'
    with SessionLocal() as db:
        tool = db.scalar(select(WorkspaceEntry).where(WorkspaceEntry.run_id == r['id'], WorkspaceEntry.kind == 'tool'))
    assert tool.status == 'incomplete'
    store.finish_run(r['id'], 'incomplete')


def test_model_error_during_retry_returns_saved_partial_to_orchestrator(identity):
    t, r, obj, v, seen = generate_then(identity, [HALF, RuntimeError('服务异常')])
    result = asyncio.run(revise_call(obj, 'rev', version_id=v['id'], instruction='修改'))
    assert result['new_version'] and '已保存出错前完成的修改' in result['error']
    assert tools.document(t['id'], result['id'])['content'] == '原文一。原文二。甲改。分析乙。'
    assert result['id'] in obj.created_versions
    store.finish_run(r['id'], 'completed')


def test_model_error_before_any_edit_changes_nothing(identity):
    t, r, obj, v, seen = generate_then(identity, [RuntimeError('服务异常')])
    result = asyncio.run(revise_call(obj, 'rev', version_id=v['id'], instruction='修改'))
    assert result['unchanged'] and result['error']
    assert len(store.task_detail(identity[0], t['id'])['versions']) == 1
    store.finish_run(r['id'], 'completed')


def test_disconnect_applies_complete_blocks_without_retrying(identity):
    partial = llm.PartialResponseError(llm.ModelResult(content='说明\n<edit><old>分析甲。</old><new>甲改。</new></edit>\n<edit><old>分析'),
                                       ConnectionError('offline'))
    t, r, obj, v, seen = generate_then(identity, [partial])
    result = asyncio.run(revise_call(obj, 'rev', version_id=v['id'], instruction='修改'))
    assert len(seen) == 2
    assert result['new_version'] and '连接中断' in result['notice'] and '截断' in result['unresolved']
    doc = tools.document(t['id'], result['id'])
    assert doc['content'] == '原文一。原文二。甲改。分析乙。'
    assert doc['provenance']['revisions'][-1]['status'] == 'interrupted'
    store.finish_run(r['id'], 'completed')


def test_output_limit_without_text_stops_with_budget_message(identity):
    t, m = task(identity)
    r = start(identity, t)

    async def model(cfg, model, messages, schemas, budget, emit, **kwargs):
        if len(messages) == 2:
            await emit('output', DRAFT)
            return llm.ModelResult(content=DRAFT)
        await emit('reasoning', '想了很久')
        return llm.ModelResult(finish_reason='length')

    async def execute():
        obj = runner.Runner(r['id'], model)
        await obj.load()
        v = await obj.create_document({'title': '成果', 'instruction': '分析', 'material_ids': [m['id']]}, 'tool:gen')
        await revise_call(obj, 'rev', version_id=v['id'], instruction='修改')

    with pytest.raises(runner.BudgetReached, match='没有给出修改'):
        asyncio.run(execute())
    assert len(store.task_detail(identity[0], t['id'])['versions']) == 1
    store.finish_run(r['id'], 'incomplete')


# ---- 调度与审阅 ----

def flow_model(review_texts, observed):
    """调度：生成 → 收到自动审阅后按编号修订 → 结束。写作者：初稿 → 修改块。"""
    reviews, drafts = iter(review_texts), iter([DRAFT, '第 1 条：采纳\n<edit><old>分析甲。</old><new>甲（有出处）。</new></edit>'])

    async def model(cfg, model, messages, schemas, budget, emit, response_format=None):
        if response_format:
            observed['review'].append(messages)
            text = next(reviews)
        elif not schemas:
            observed['writer'].append(messages)
            text = next(drafts)
        else:
            observed['orchestrator'].append([dict(m) for m in messages])
            last = messages[-1]
            if len(observed['orchestrator']) == 1:
                args = {'title': '成果', 'instruction': '分析', 'material_ids': []}
                return llm.ModelResult(calls=[{'id': 'gen', 'type': 'function', 'function': {'name': 'create_document', 'arguments': json.dumps(args)}}])
            found = re.search(r'审阅编号 (\w+)', last['content'] or '') if last['role'] == 'user' else None
            if found:
                version = re.search(r'版本 (\w+)', last['content'])[1]
                args = {'version_id': version, 'instruction': '采纳第 1 条', 'review_id': found[1], 'issues': [1]}
                return llm.ModelResult(calls=[{'id': 'rev', 'type': 'function', 'function': {'name': 'revise_document', 'arguments': json.dumps(args)}}])
            text = '已完成。'
        await emit('output', text)
        return llm.ModelResult(content=text)
    return model


def review_json(problem):
    return json.dumps({'summary': '需要补出处', 'issues': [{'quote': '分析甲。', 'problem': problem, 'evidence': '材料',
                                                            'fix': '补出处', 'certainty': 'confirmed'}]}, ensure_ascii=False)


def test_auto_review_hands_issues_to_orchestrator_and_respects_rounds(identity):
    t, m = task(identity, review=True, auto_improve=True, review_rounds=1)
    r = start(identity, t)
    observed = {'review': [], 'writer': [], 'orchestrator': []}
    asyncio.run(runner.execute_run(r['id'], flow_model([review_json('缺出处'), review_json('仍可更具体')], observed)))
    saved = store.load_run(r['id'])
    assert saved['status'] == 'completed', saved['error']
    versions = store.task_detail(identity[0], t['id'])['versions']
    assert len(versions) == 2 and versions[1]['parent_id'] == versions[0]['id']
    assert tools.document(t['id'], versions[1]['id'])['content'] == '原文一。原文二。甲（有出处）。分析乙。'
    # 每个新版本审一次；第二次审阅只汇报，不再交回调度。
    assert len(observed['review']) == 2 and len(observed['orchestrator']) == 4
    final = observed['orchestrator'][-1]
    assert sum('[自动审阅]' in (msg.get('content') or '') for msg in final) == 1
    assert '缺出处' in observed['writer'][1][-1]['content']


def test_review_without_auto_improve_only_reports(identity):
    t, m = task(identity, review=True, auto_improve=False)
    r = start(identity, t)
    observed = {'review': [], 'writer': [], 'orchestrator': []}
    asyncio.run(runner.execute_run(r['id'], flow_model([review_json('缺出处')], observed)))
    assert store.load_run(r['id'])['status'] == 'completed'
    assert len(observed['review']) == 1 and len(observed['orchestrator']) == 2
    assert not any('[自动审阅]' in (msg.get('content') or '') for msgs in observed['orchestrator'] for msg in msgs)
    assert len(store.task_detail(identity[0], t['id'])['versions']) == 1


# ---- 兼容 ----

@pytest.mark.parametrize('behavior,expected', [(next(iter(LEGACY_BEHAVIORS)), DEFAULT_BEHAVIOR), ('自定义策略', '自定义策略')])
def test_saved_legacy_default_behavior_is_upgraded(identity, behavior, expected):
    t, m = task(identity, behavior=behavior)
    r = start(identity, t)

    async def execute():
        obj = runner.Runner(r['id'], scripted([], []))
        await obj.load()
        return obj.messages[0]['content']

    assert asyncio.run(execute()) == expected
    store.finish_run(r['id'], 'completed')


def test_claim_of_adoption_without_edit_blocks_is_a_format_problem():
    """整篇重写却说"采纳"：不能当成"无需修改"，否则用户看到的还是旧稿。"""
    parsed = writer.parse_edits('第 1 条：采纳 —— 材料支持这个说法，整篇重写如下。\n\n' + DRAFT)
    assert parsed.edits == []
    assert [n for n, _ in parsed.problems] == [0]
    assert '没有按格式给出修改块' in parsed.problems[0][1]
    # 明确不改的两种说法都不算格式失败。
    assert writer.parse_edits('第 1 条：不采纳 —— 材料里没有这个说法。').problems == []
    assert writer.parse_edits('其他要求：已经足够具体，不再修改。').problems == []
    # 截断时按截断处理，不叠加格式失败。
    assert writer.parse_edits('第 1 条：采纳 —— 理由', truncated=True).problems == []


def test_apply_edits_refuses_to_blank_the_document():
    draft, applied, failures = writer.apply_edits('原文一。', [(1, '原文一。', '')])
    assert draft == '原文一。' and applied == 0
    assert failures == [(1, '该修改会让成果变为空文档，已拒绝')]
    # 只留空白同样算清空。
    assert writer.apply_edits('原文一。', [(1, '原文一。', '  \n ')])[1] == 0


def test_rewritten_draft_without_blocks_triggers_a_retry(identity):
    t, m = task(identity)
    r = start(identity, t)
    seen = []
    replies = [DRAFT,
               '第 1 条：采纳 —— 材料支持这个说法，整篇重写如下。\n\n' + DRAFT.replace('分析甲。', '分析甲（有据）。'),
               '<edit><old>分析甲。</old><new>分析甲（有据）。</new></edit>']

    async def execute():
        obj = runner.Runner(r['id'], scripted(replies, seen))
        await obj.load()
        v = await obj.create_document({'title': '成果', 'instruction': '分析', 'material_ids': [m['id']]}, 'tool:gen')
        return await revise_call(obj, 'rev', version_id=v['id'], instruction='把分析补上依据')

    result = asyncio.run(execute())
    assert len(seen) == 3, "没有给出修改块时应再要一次"
    assert '没有按格式给出修改块' in seen[2][-1]['content']
    assert tools.document(t['id'], result['id'])['content'] == '原文一。原文二。分析甲（有据）。分析乙。'
    assert result['new_version'] and result['applied'] == 1
    store.finish_run(r['id'], 'completed')


def test_blank_edit_is_refused_and_retried(identity):
    t, m = task(identity)
    r = start(identity, t)
    seen = []
    replies = [DRAFT,
               '第 1 条：采纳 —— 这段分析没有依据，删掉。\n<edit><old>' + DRAFT + '</old><new></new></edit>',
               '<edit><old>分析甲。</old><new>甲。</new></edit>']

    async def execute():
        obj = runner.Runner(r['id'], scripted(replies, seen))
        await obj.load()
        v = await obj.create_document({'title': '成果', 'instruction': '分析', 'material_ids': [m['id']]}, 'tool:gen')
        return await revise_call(obj, 'rev', version_id=v['id'], instruction='删掉没有依据的分析')

    result = asyncio.run(execute())
    assert '空文档' in seen[2][-1]['content']
    doc = tools.document(t['id'], result['id'])
    assert doc['content'] == '原文一。原文二。甲。分析乙。'
    assert doc['complete'] is True
    store.finish_run(r['id'], 'completed')
