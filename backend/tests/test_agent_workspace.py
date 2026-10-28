import asyncio
import json
import time
from datetime import timedelta
from unittest.mock import AsyncMock

import httpx
import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.database import SessionLocal
from app.models import UsageCode, UsageLog, utcnow
from app.agent_workspace import api, store, tools, mcp, runner, llm
from app.agent_workspace.models import WorkspaceRun, WorkspaceEntry, WorkspaceTask
from app.agent_workspace.settings import WorkspaceSettings


@pytest.fixture
def identity(workspace_code):
    return workspace_code('WORKSPACE-', quota=20)


@pytest.fixture
def client(identity):
    app=FastAPI();app.include_router(api.router)
    return TestClient(app,headers={'Authorization':'Bearer '+identity[1]})


def task(identity, **config):
    with SessionLocal() as db:
        row=WorkspaceTask(id=store.uid(),owner=identity[0],title='测试任务',config=store.encode(api.TaskConfig(goal='仅根据提供的材料分析',model='test',review=False,**config).model_dump()))
        db.add(row);db.commit()
        return store.task_dict(row,True)


def run(identity,t,mode='execute',base='',key=None):
    snapshot={'model':'test','limits':{'max_steps':4,'max_tokens':200000,'output_tokens':16000,'max_seconds':60},'templates':{}}
    return store.create_run(identity[0],t['id'],key or store.uid(),mode,'',base,snapshot,True)


def test_catalog_and_exhausted_login(client,identity):
    r=client.get('/api/workspace/catalog')
    assert r.status_code==200,r.text
    assert r.json()['user']['id']==identity[0]
    assert r.json()['official_templates']
    assert 'mcp_token' not in r.text and 'mcp_url' not in r.text
    with SessionLocal() as db:
        row=db.get(UsageCode,identity[0]);row.quota=0;code=row.code;db.commit()
    login=client.post('/api/workspace/login',json={'code':code})
    assert login.status_code==200
    assert login.json().get('token','').count('.')==2, "登录必须返回可用的 JWT"
    assert client.get('/api/workspace/tasks').status_code==200


def test_owner_and_config_cas(client,identity):
    t=task(identity)
    body={'title':'新名称','revision':1,'config':t['config']}
    assert client.put('/api/workspace/tasks/'+t['id'],json=body).status_code==200
    assert client.put('/api/workspace/tasks/'+t['id'],json=body).status_code==409
    with pytest.raises(HTTPException) as denied:store.task_detail(identity[0]+1000,t['id'])
    assert denied.value.status_code==404
    assert store.task_detail(identity[0],t['id'])['title']=='新名称'


def test_idempotent_run_atomic_charge_and_refund(identity):
    t=task(identity);r=run(identity,t,key='idempotent1');again=run(identity,t,key='idempotent1')
    assert r['id']==again['id']
    with SessionLocal() as db:assert db.get(UsageCode,identity[0]).used_count==1
    with SessionLocal() as db:
        row=db.get(UsageCode,identity[0]);row.used_count=row.quota;db.commit()
    # 新任务没有在途轮次，才会走到额度校验
    with pytest.raises(HTTPException) as exhausted:run(identity,task(identity))
    assert exhausted.value.status_code==403, "额度已用尽时必须是 403"
    with SessionLocal() as db:
        row=db.get(UsageCode,identity[0]);row.used_count=0;db.commit()
    store.finish_run(r['id'],'stopped');store.finish_run(r['id'],'stopped')
    with SessionLocal() as db:assert db.get(UsageCode,identity[0]).used_count==0


def test_free_limit_reserved_in_database(identity):
    t=task(identity);snap={'model':'test'}
    entry={'is_free':True,'free_limits':{'minute':1}}
    r=store.create_run(identity[0],t['id'],store.uid(),'execute','','',snap,False,entry)
    store.finish_run(r['id'],'completed')
    with pytest.raises(HTTPException) as e:store.create_run(identity[0],t['id'],store.uid(),'execute','','',snap,False,entry)
    assert e.value.status_code==429


def test_versions_and_adoption_conflict(client,identity):
    t=task(identity);a=store.save_version(t['id'],'','a','原稿','完整原文，不能删除。')
    b=store.save_version(t['id'],'','b','候选','修改内容',a['id'])
    assert store.task_detail(identity[0],t['id'])['adopted_version']==a['id']
    assert tools.document(t['id'],a['id'])['content']=='完整原文，不能删除。'
    endpoint=f"/api/workspace/tasks/{t['id']}/versions/{b['id']}/adopt"
    assert client.post(endpoint,json={'expected':''}).status_code==409
    assert client.post(endpoint,json={'expected':a['id']}).status_code==200
    partial=store.save_version(t['id'],'','c','部分','未完成',b['id'],complete=False)
    assert client.post(f"/api/workspace/tasks/{t['id']}/versions/{partial['id']}/adopt",json={'expected':b['id']}).status_code==400


def test_long_content_not_in_poll_and_download_exact(client,identity):
    t=task(identity);r=run(identity,t);e=store.start_entry(t['id'],r['id'],'long','model','长思考')
    text=('完整中文 reasoning 😀\n'*50000)+'末尾不能丢失'
    store.append_chunks(e['id'],{'reasoning':text})
    res=client.get(f"/api/workspace/tasks/{t['id']}/events")
    assert len(res.content)<5000
    endpoint=f"/api/workspace/tasks/{t['id']}/entries/{e['id']}/content?kind=reasoning"
    first=client.get(endpoint).json();assert len(first['chunks'])==24 and first['has_more']
    download=client.get(endpoint+'&download=true');assert download.text==text
    store.finish_run(r['id'],'stopped')


def test_material_scope_regex_and_preservation(identity):
    t=task(identity);m=api.add_material(identity[0],t['id'],'试卷','第一题 A\n第二题 B\n听力原文未提供')
    cfg={**t['config'],'materials':[m['id']]}
    result=asyncio.run(tools.execute_readonly(t['id'],cfg,'search_material',{'query':'第.题','regex':True}))
    assert len(result['matches'])==2
    assert tools.materials(t['id'],[m['id']])[0]['content'].endswith('未提供')
    with pytest.raises(ValueError):asyncio.run(tools.execute_readonly(t['id'],{**cfg,'materials':[]},'read_material',{'material_id':m['id']}))
    with pytest.raises(ValueError):tools.search_materials([{'id':'x','content':'a'*50000+'!','name':'x'}],'(a+)+$',True)


def test_file_parser_no_silent_truncation():
    content='题目\n'*20000
    assert tools.parse_upload('材料.txt',content.encode())==content
    with pytest.raises(ValueError):tools.parse_upload('huge.txt',('x'*2000001).encode())
    with pytest.raises(ValueError):tools.parse_upload('empty.txt',b'')


def test_resume_and_stop(identity):
    t=task(identity);r=run(identity,t)
    with SessionLocal() as db:
        row=db.get(WorkspaceRun,r['id']);row.status='running';row.lease=utcnow()-timedelta(seconds=1);db.commit()
    store.recover_runs()
    with SessionLocal() as db:
        row=db.get(WorkspaceRun,r['id']);assert row.status=='queued';row.stop=True;db.commit()
    mock=AsyncMock();asyncio.run(runner.execute_run(r['id'],mock));mock.assert_not_called()
    assert store.load_run(r['id'])['status']=='stopped'


def test_runner_tool_execution_and_unmodified_material(identity,monkeypatch):
    t=task(identity);m=api.add_material(identity[0],t['id'],'试卷','题一原文\n题二原文\n听力未提供')
    t=store.update_task(identity[0],t['id'],1,{**t['config'],'materials':[m['id']]})
    r=run(identity,t)
    monkeypatch.setattr(runner,'_load_cfg',lambda:{})
    calls=[]
    async def model(cfg,model,messages,schemas,budget,emit,**kwargs):
        calls.append(messages)
        if len(calls)==1:return llm.ModelResult(calls=[{'id':'c1','type':'function','function':{'name':'create_document','arguments':json.dumps({'title':'成果','instruction':'保留全部原文，不补写听力','material_ids':[m['id']]})}}])
        text='题一原文\n题二原文\n听力未提供' if len(calls)==2 else '已生成完整分析。'
        await emit('output',text);return llm.ModelResult(content=text,tokens=100)
    asyncio.run(runner.execute_run(r['id'],model))
    result=store.task_detail(identity[0],t['id'])
    assert result['status']=='completed'
    assert len(result['versions'])==1
    assert '题二原文' in calls[1][1]['content']
    assert tools.materials(t['id'],[m['id']])[0]['content']=='题一原文\n题二原文\n听力未提供'


def test_patch_tool_removed_never_rewrites(identity,monkeypatch):
    t=task(identity);v=store.save_version(t['id'],'','base','原稿','重复 重复')
    r=run(identity,t);obj=runner.Runner(r['id']);monkeypatch.setattr(runner,'_load_cfg',lambda:{})
    async def execute():
        await obj.load()
        return await obj.tool_call({'id':'p1','function':{'name':'patch_document','arguments':json.dumps({'version_id':v['id'],'old':'重复','new':'丢内容'})}})
    result=asyncio.run(execute());assert result['unchanged'] and '不在本轮允许范围' in result['error']
    assert len(store.task_detail(identity[0],t['id'])['versions'])==1
    store.finish_run(r['id'],'completed')


@pytest.mark.parametrize('sse',[False,True])
def test_mcp_lifecycle_json_and_sse(sse):
    methods=[]
    async def handler(request):
        if request.method=='DELETE':return httpx.Response(204)
        data=json.loads(request.content);methods.append(data['method'])
        assert request.headers['authorization']=='Bearer secret'
        if data['method']=='notifications/initialized':return httpx.Response(202)
        if data['method']=='initialize':result={'protocolVersion':'2025-06-18','capabilities':{'tools':{}},'serverInfo':{'name':'test','version':'1'}}
        else:
            assert request.headers['mcp-session-id']=='session'
            result={'tools':[{'name':'search','inputSchema':{'type':'object'}}]}
        reply={'jsonrpc':'2.0','id':data['id'],'result':result}
        if sse:return httpx.Response(200,headers={'content-type':'text/event-stream','mcp-session-id':'session'},text='data: {"jsonrpc":"2.0","method":"notifications/progress"}\n\ndata: '+json.dumps(reply)+'\n\n')
        return httpx.Response(200,headers={'mcp-session-id':'session'},json=reply)
    async def execute():
        async with mcp.connection(WorkspaceSettings(mcp_url='https://example.test/mcp',mcp_token='secret'),httpx.MockTransport(handler)) as c:
            assert (await c.list_tools())[0]['name']=='search'
    asyncio.run(execute())
    assert methods==['initialize','notifications/initialized','tools/list']


def test_mcp_error_does_not_leak_credentials():
    with pytest.raises(mcp.MCPError) as e:mcp.MCPClient.result({'error':{'code':-1,'message':'https://private?token=SECRET'}})
    assert 'SECRET' not in str(e.value)


def test_native_tool_stream_fragmented(monkeypatch):
    from app.services.llm import LLMService
    service=LLMService(api_key='test',default_model='test',base_url='https://example.test')
    monkeypatch.setattr(llm,'_build_llm',lambda cfg,model:service)
    async def stream(**kwargs):
        async def chunks():
            yield {'choices':[{'delta':{'tool_calls':[{'index':0,'id':'call1','function':{'name':'read_material','arguments':'{"material_'}}]}}]}
            yield {'choices':[{'delta':{'tool_calls':[{'index':0,'function':{'arguments':'id":"abc"}'}}]},'finish_reason':'tool_calls'}]}
        return chunks()
    monkeypatch.setattr(llm,'acompletion',stream)
    result=asyncio.run(llm.complete({},'test',[],[],100,AsyncMock()))
    assert result.calls[0]['function']['arguments']=='{"material_id":"abc"}'
    assert result.calls[0]['id']=='call1'


def test_midstream_disconnect_keeps_partial(monkeypatch):
    from app.services.llm import LLMService
    monkeypatch.setattr(llm,'_build_llm',lambda *_:LLMService(api_key='test',default_model='test'))
    async def complete(**kwargs):
        async def chunks():
            yield {'choices':[{'delta':{'content':'已生成的正文'}}]}
            raise ConnectionError('offline')
        return chunks()
    monkeypatch.setattr(llm,'acompletion',complete)
    with pytest.raises(llm.PartialResponseError) as e:asyncio.run(llm.complete({},'test',[],[],100,AsyncMock()))
    assert e.value.result.content=='已生成的正文'


def test_missing_finish_marker_is_not_complete(monkeypatch):
    from app.services.llm import LLMService
    monkeypatch.setattr(llm,'_build_llm',lambda *_:LLMService(api_key='test',default_model='test'))
    async def complete(**kwargs):
        async def chunks():yield {'choices':[{'delta':{'content':'未收到结束标记'}}]}
        return chunks()
    monkeypatch.setattr(llm,'acompletion',complete)
    with pytest.raises(llm.PartialResponseError):asyncio.run(llm.complete({},'test',[],[],100,AsyncMock()))


def test_review_receives_generation_scope_and_flags_unlocated_quote(identity,monkeypatch):
    t=task(identity);r=run(identity,t)
    v=store.save_version(t['id'],r['id'],'scope','分析','阅读题分析',provenance={'requirements':'排除听力，不补写听力原文','materials':[]})
    observed=[]
    async def model(cfg,model,messages,schemas,budget,emit,**kwargs):
        observed.append(messages)
        text=json.dumps({'summary':'需要核实','issues':[{'quote':'不存在的原文','problem':'建议补充','evidence':'猜测','fix':'核实','certainty':'confirmed'}]})
        await emit('output',text);return llm.ModelResult(content=text)
    monkeypatch.setattr(runner,'_load_cfg',lambda:{})
    async def execute():
        obj=runner.Runner(r['id'],model);await obj.load();return await obj.review(v['id'])
    result=asyncio.run(execute())
    assert '排除听力' in observed[0][1]['content']
    assert result['issues'][0]['certainty']=='uncertain'
    store.finish_run(r['id'],'completed')


def test_generation_continues_length_and_keeps_scope(identity,monkeypatch):
    t=task(identity,teaching_tools={'1':'仅处理阅读，排除听力。{{user_input}}'})
    r=run(identity,t);answers=iter([('第一段','length'),('第二段','stop')])
    async def model(cfg,model,messages,schemas,budget,emit,**kwargs):
        content,finish=next(answers);await emit('output',content);return llm.ModelResult(content=content,finish_reason=finish)
    monkeypatch.setattr(runner,'_load_cfg',lambda:{})
    async def execute():
        obj=runner.Runner(r['id'],model);await obj.load();return await obj.create_document({'title':'完整成果','instruction':'分析阅读','material_ids':[],'teaching_tool':'1'},'full')
    v=asyncio.run(execute());doc=tools.document(t['id'],v['id']);assert doc['content']=='第一段第二段' and doc['complete']
    assert '排除听力' in doc['provenance']['requirements']
    store.finish_run(r['id'],'completed')


def test_tool_close_blocks_pending_call_and_notes_stay_in_context(identity,monkeypatch):
    t=task(identity);r=run(identity,t)
    from app.agent_workspace.models import WorkspaceNote
    cfg={**t['config'],'tools':[]}
    with SessionLocal() as db:
        db.add(WorkspaceNote(task_id=t['id'],run_id=r['id'],text='不要使用检索',config=store.encode(cfg)));db.commit()
    monkeypatch.setattr(runner,'_load_cfg',lambda:{})
    async def execute():
        obj=runner.Runner(r['id']);await obj.load()
        result=await obj.tool_call({'id':'search','function':{'name':'search_material','arguments':'{"query":"x"}'}})
        assert result['unchanged'];await obj.notes();assert obj.messages[-1]['content']=='不要使用检索'
    asyncio.run(execute());assert not store.take_notes(r['id']);store.finish_run(r['id'],'completed')


def test_stop_during_generation_persists_received_content(identity,monkeypatch):
    t=task(identity);r=run(identity,t)
    monkeypatch.setattr(runner,'_load_cfg',lambda:{})
    async def execute():
        started=asyncio.Event()
        async def model(cfg,model,messages,schemas,budget,emit,**kwargs):
            await emit('reasoning','停止前的完整内容');started.set();await asyncio.sleep(30)
        job=asyncio.create_task(runner.execute_run(r['id'],model));await started.wait()
        with SessionLocal() as db:db.get(WorkspaceRun,r['id']).stop=True;db.commit()
        await asyncio.wait_for(job,4)
    asyncio.run(execute())
    assert store.load_run(r['id'])['status']=='stopped'
    with SessionLocal() as db:e=db.scalar(select(WorkspaceEntry).where(WorkspaceEntry.run_id==r['id']))
    assert store.entry_text(e.id,'reasoning')=='停止前的完整内容'
    assert e.status == 'stopped'
    assert json.loads(e.details)['error_code'] == 'user_stop'


def test_stop_running_cancels_without_waiting_for_heartbeat(identity, monkeypatch):
    """进程内停止信号必须在心跳兜底之前生效；否则 0.75s 的轮询就是延迟下限。"""
    t = task(identity)
    r = run(identity, t)
    with SessionLocal() as db:
        db.get(WorkspaceRun, r['id']).status = 'running'
        db.get(WorkspaceTask, t['id']).status = 'running'
        db.commit()
    monkeypatch.setattr(runner, '_load_cfg', lambda: {})
    monkeypatch.setattr(runner, 'HEARTBEAT_SECONDS', 30)

    async def execute():
        started, cancelled = asyncio.Event(), asyncio.Event()

        async def model(cfg, model, messages, schemas, budget, emit, **kwargs):
            await emit('output', '停止前的正文')
            started.set()
            try:
                await asyncio.sleep(30)
            except asyncio.CancelledError:
                cancelled.set()
                raise

        job = asyncio.create_task(runner.execute_run(r['id'], model))
        await asyncio.wait_for(started.wait(), 5)
        t0 = time.monotonic()
        data = api.stop_run(t['id'], identity[0])
        await asyncio.wait_for(job, 2)
        return data, time.monotonic() - t0, cancelled.is_set()

    data, elapsed, cancelled = asyncio.run(execute())
    assert data['received'] is True and data['status'] == 'stopping'
    assert cancelled is True
    assert elapsed < 1
    assert store.load_run(r['id'])['status'] == 'stopped'
    with SessionLocal() as db:
        e = db.scalar(select(WorkspaceEntry).where(WorkspaceEntry.run_id == r['id']))
    assert e.status == 'stopped'
    assert json.loads(e.details)['error_code'] == 'user_stop'
    assert store.entry_text(e.id, 'output') == '停止前的正文'


def test_stop_queued_run_is_immediate_and_refunds(identity):
    """排队中还没有在途调用：停止应直接落终态，不能等 worker 槽位。"""
    t = task(identity)
    r = run(identity, t)
    with SessionLocal() as db:
        assert db.get(UsageCode, identity[0]).used_count == 1
    data = api.stop_run(t['id'], identity[0])
    assert data['received'] is True and data['status'] == 'stopped'
    assert data['run']['status'] == 'stopped'
    assert store.load_run(r['id'])['status'] == 'stopped'
    detail = store.task_detail(identity[0], t['id'])
    assert detail['status'] == 'stopped' and detail['active_run'] == ''
    with SessionLocal() as db:
        assert db.get(UsageCode, identity[0]).used_count == 0


def test_stop_waiting_round_reports_not_received(identity):
    """等待补充不是执行中：接口不能返回虚假的成功，页面也不该显示停止按钮。"""
    t = task(identity)
    r = run(identity, t)
    store.finish_run(r['id'], 'waiting')
    assert api.stop_run(t['id'], identity[0]) == {'received': False, 'status': 'waiting'}
    assert store.load_run(r['id'])['status'] == 'waiting'


def test_stop_grace_marks_terminal_when_cleanup_ignores_cancel(identity, monkeypatch):
    """收尾不理会取消时，先按上限落终态，避免一直停在 stopping。"""
    t = task(identity)
    r = run(identity, t)
    with SessionLocal() as db:
        db.get(WorkspaceRun, r['id']).status = 'running'
        db.get(WorkspaceTask, t['id']).status = 'running'
        db.commit()
    monkeypatch.setattr(runner, '_load_cfg', lambda: {})
    monkeypatch.setattr(runner, 'HEARTBEAT_SECONDS', 30)
    monkeypatch.setattr(runner, 'STOP_GRACE_SECONDS', 0.2)

    async def execute():
        started = asyncio.Event()

        async def model(cfg, model, messages, schemas, budget, emit, **kwargs):
            started.set()
            try:
                await asyncio.sleep(30)
            except asyncio.CancelledError:
                await asyncio.sleep(0.6)  # 模拟卡住的 close
                raise

        job = asyncio.create_task(runner.execute_run(r['id'], model))
        await asyncio.wait_for(started.wait(), 5)
        t0 = time.monotonic()
        api.stop_run(t['id'], identity[0])
        await asyncio.wait_for(job, 2)
        return time.monotonic() - t0

    assert asyncio.run(execute()) < 0.6
    assert store.load_run(r['id'])['status'] == 'stopped'


def test_tool_result_replay_does_not_duplicate_json(identity):
    t=task(identity);r=run(identity,t);entry=store.start_entry(t['id'],r['id'],'same','tool','read_material')
    store.finish_tool(entry['id'],{'text':'完整结果'});store.finish_tool(entry['id'],{'text':'完整结果'})
    assert json.loads(store.entry_text(entry['id'],'output'))=={'text':'完整结果'}
    store.finish_run(r['id'],'completed')


def test_continuation_preserves_question_and_user_requirements(identity):
    t=task(identity);r=run(identity,t);e=store.start_entry(t['id'],r['id'],'question','tool','ask_user')
    store.finish_entry(e['id'],'waiting',{'question':'请提供第二篇原文'})
    store.finish_run(r['id'],'waiting');next_run=run(identity,t,mode='continue')
    history=store.conversation_history(t['id'],next_run['id'])
    assert history[-1]['content']=='请提供第二篇原文'
    store.finish_run(next_run['id'],'completed')


@pytest.mark.parametrize('finish,status,code', [
    ('length', 'incomplete', 'output_limit'),
    ('max_tokens', 'incomplete', 'output_limit'),
    ('stop', 'failed', 'empty_response'),
    (None, 'failed', 'missing_finish_reason'),
    ('content_filter', 'failed', 'model_finish_error'),
])
def test_reasoning_only_response_preserves_real_end_reason(identity, monkeypatch, finish, status, code):
    from app.services.llm import LLMService
    t = task(identity)
    r = run(identity, t)
    reasoning = '思' * 47980
    monkeypatch.setattr(runner, '_load_cfg', lambda: {})
    monkeypatch.setattr(llm, '_build_llm', lambda *_: LLMService(api_key='test', default_model='test'))
    requests = []

    async def stream(**kwargs):
        requests.append(kwargs)
        async def chunks():
            yield {'choices': [{'delta': {'reasoning_content': reasoning}}]}
            if finish:
                yield {'choices': [{'delta': {}, 'finish_reason': finish}],
                       'usage': {'prompt_tokens': 100, 'completion_tokens': 16000, 'total_tokens': 16100}}
        return chunks()

    monkeypatch.setattr(llm, 'acompletion', stream)
    asyncio.run(runner.execute_run(r['id']))
    saved = store.load_run(r['id'])
    assert saved['status'] == status
    assert len(requests) == 1
    assert not saved['versions']
    with SessionLocal() as db:
        entry = db.scalar(select(WorkspaceEntry).where(WorkspaceEntry.run_id == r['id']))
        details = json.loads(entry.details)
    assert details['finish_reason'] == finish
    assert details['error_code'] == code
    assert details['output_tokens'] == 16000
    assert store.entry_text(entry.id, 'reasoning') == reasoning
    assert store.entry_text(entry.id, 'output') == ''
    if finish:
        assert saved['tokens'] == 16100
        assert details['usage']['completion_tokens'] == 16000
    if status == 'incomplete':
        assert entry.status == 'incomplete'
        assert '单次输出上限' in saved['error']
    elif code == 'empty_response':
        assert entry.status == 'failed'
        assert '没有返回正文或工具调用' in saved['error']


def test_timeout_reason_does_not_hide_or_discard_partial_content(identity, monkeypatch):
    from app.services.llm import LLMService
    t = task(identity)
    r = run(identity, t)
    monkeypatch.setattr(runner, '_load_cfg', lambda: {})
    monkeypatch.setattr(llm, '_build_llm', lambda *_: LLMService(api_key='test', default_model='test'))

    async def stream(**kwargs):
        async def chunks():
            yield {'choices': [{'delta': {'content': '完整保留这段已生成内容'}}]}
            raise TimeoutError('https://private.example/?token=secret-value')
        return chunks()

    monkeypatch.setattr(llm, 'acompletion', stream)
    asyncio.run(runner.execute_run(r['id']))
    with SessionLocal() as db:
        entry = db.scalar(select(WorkspaceEntry).where(WorkspaceEntry.run_id == r['id']))
        details = json.loads(entry.details)
    assert details['error_code'] == 'model_timeout'
    assert details['finish_reason'] is None
    assert '超时' in store.load_run(r['id'])['error']
    assert 'secret-value' not in json.dumps(details)
    assert store.entry_text(entry.id, 'output') == '完整保留这段已生成内容'


@pytest.mark.parametrize('prefix', ['', '已生成的正文'])
def test_generation_does_not_retry_reasoning_only_limit(identity, monkeypatch, prefix):
    t = task(identity)
    r = run(identity, t)
    monkeypatch.setattr(runner, '_load_cfg', lambda: {})
    calls = []

    async def model(cfg, model, messages, schemas, budget, emit, **kwargs):
        calls.append(messages)
        text = prefix if len(calls) == 1 else ''
        await emit('reasoning', '完整思考')
        if text:
            await emit('output', text)
        return llm.ModelResult(content=text, finish_reason='length')

    async def execute():
        obj = runner.Runner(r['id'], model)
        await obj.load()
        return await obj.create_document({'title': '测试成果', 'instruction': '', 'material_ids': []}, 'limit')

    if prefix:
        version = asyncio.run(execute())
        assert not version['complete']
        assert tools.document(t['id'], version['id'])['content'] == prefix
        assert len(calls) == 2
    else:
        with pytest.raises(runner.BudgetReached, match='没有生成正文'):
            asyncio.run(execute())
        assert len(calls) == 1
        assert not store.task_detail(identity[0], t['id'])['versions']
    store.finish_run(r['id'], 'incomplete')


def test_backend_worker_finishes_after_request_client_closes(identity, monkeypatch):
    t = task(identity)
    cfg = {'models': [{'id': 'test', 'enabled': True, 'user_usable': True}], 'default_model': 'test'}
    monkeypatch.setattr(api, '_load_cfg', lambda: cfg)
    monkeypatch.setattr(api, '_validate_model', lambda *_: None)
    monkeypatch.setattr(api, 'official_templates', lambda: [])
    monkeypatch.setattr(runner, '_load_cfg', lambda: cfg)
    app = FastAPI()
    app.include_router(api.router)

    async def execute():
        started, release = asyncio.Event(), asyncio.Event()
        async def model(*args, **kwargs):
            started.set()
            await release.wait()
            await args[5]('output', '后台任务已完成')
            return llm.ModelResult(content='后台任务已完成')
        monkeypatch.setattr(llm, 'complete', model)
        worker = asyncio.create_task(runner.worker())
        try:
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test',
                                        headers={'Authorization': 'Bearer ' + identity[1]}) as client:
                response = await client.post(f"/api/workspace/tasks/{t['id']}/runs", json={'request_key': store.uid()})
                assert response.status_code == 202, response.text
                run_id = response.json()['id']
                await asyncio.wait_for(started.wait(), 5)
            assert client.is_closed
            assert store.load_run(run_id)['status'] == 'running'
            release.set()
            async def finished():
                while store.load_run(run_id)['status'] in store.ACTIVE:
                    await asyncio.sleep(.05)
            await asyncio.wait_for(finished(), 5)
            saved = store.load_run(run_id)
            assert saved['status'] == 'completed'
            assert tools.document(t['id'], saved['versions'][0])['content'] == '后台任务已完成'
        finally:
            release.set()
            worker.cancel()
            await asyncio.gather(worker, return_exceptions=True)
    asyncio.run(execute())


def test_worker_shutdown_requeues_with_explicit_reason(identity, monkeypatch):
    t = task(identity)
    r = run(identity, t)
    monkeypatch.setattr(runner, '_load_cfg', lambda: {})

    async def execute():
        started = asyncio.Event()
        async def model(*args, **kwargs):
            await args[5]('reasoning', '重启前的记录')
            started.set()
            await asyncio.Event().wait()
        job = asyncio.create_task(runner.execute_run(r['id'], model))
        await asyncio.wait_for(started.wait(), 5)
        job.cancel()
        with pytest.raises(asyncio.CancelledError):
            await job

    asyncio.run(execute())
    assert store.load_run(r['id'])['status'] == 'queued'
    with SessionLocal() as db:
        entry = db.scalar(select(WorkspaceEntry).where(WorkspaceEntry.run_id == r['id']))
    assert json.loads(entry.details)['error_code'] == 'worker_shutdown'
    assert store.entry_text(entry.id, 'reasoning') == '重启前的记录'
    store.finish_run(r['id'], 'stopped')


def test_review_limit_preserves_version_without_claiming_complete(identity, monkeypatch):
    t = task(identity)
    v = store.save_version(t['id'], '', 'review-base', '原稿', '保留的完整正文')
    r = run(identity, t, mode='review', base=v['id'])
    monkeypatch.setattr(runner, '_load_cfg', lambda: {})

    async def model(*args, **kwargs):
        await args[5]('reasoning', '未完成的审阅思考')
        return llm.ModelResult(finish_reason='length')

    asyncio.run(runner.execute_run(r['id'], model))
    assert store.load_run(r['id'])['status'] == 'incomplete'
    assert tools.document(t['id'], v['id'])['content'] == '保留的完整正文'
    with SessionLocal() as db:
        entry = db.scalar(select(WorkspaceEntry).where(WorkspaceEntry.run_id == r['id']))
    assert entry.status == 'incomplete'
    assert 'review_summary' not in json.loads(entry.details)


@pytest.mark.parametrize('mode', ['execute', 'continue'])
@pytest.mark.parametrize('goal,instruction', [('', ''), (' \n ', ' \t '), ('本轮额外目标', ''), ('', '本轮额外要求')])
def test_optional_goal_runs_task_prompt_and_keeps_budget_snapshot(client, identity, monkeypatch, mode, goal, instruction):
    from app.agent_workspace.instructions import DEFAULT_EXECUTION_REQUEST
    t = task(identity)
    prompt = '分析所选材料的语篇结构。'
    t = store.update_task(identity[0], t['id'], 1, {**t['config'], 'goal': goal, 'prompt': prompt})
    cfg = {'models': [{'id': 'test', 'enabled': True, 'user_usable': True}], 'default_model': 'test'}
    monkeypatch.setattr(api, '_load_cfg', lambda: cfg)
    monkeypatch.setattr(api, '_validate_model', lambda *_: None)
    monkeypatch.setattr(api, 'official_templates', lambda: [])
    monkeypatch.setattr(api, 'load_settings', lambda: WorkspaceSettings(output_tokens=65536))
    monkeypatch.setattr(runner, '_load_cfg', lambda: cfg)
    body = {'request_key': store.uid(), 'mode': mode, 'instruction': instruction}
    response = client.post(f"/api/workspace/tasks/{t['id']}/runs", json=body)
    assert response.status_code == 202, response.text
    run_id = response.json()['id']
    # 管理预算调整不改写已创建的执行快照，也不影响重复提交的幂等性。
    monkeypatch.setattr(api, 'load_settings', lambda: WorkspaceSettings(output_tokens=32768))
    assert client.post(f"/api/workspace/tasks/{t['id']}/runs", json=body).json()['id'] == run_id
    observed = []

    async def model(cfg, model, messages, schemas, budget, emit, **kwargs):
        context = json.loads(messages[1]['content'])
        observed.append(context)
        assert context['task_prompt'] == prompt
        assert context['goal'] == goal
        expected = DEFAULT_EXECUTION_REQUEST if not goal.strip() and not instruction.strip() else instruction
        assert context['instruction'] == expected
        assert budget == 65536
        await emit('output', '任务已按提示词执行')
        return llm.ModelResult(content='任务已按提示词执行')

    asyncio.run(runner.execute_run(run_id, model))
    saved = store.load_run(run_id)
    assert observed and saved['status'] == 'completed'
    assert saved['snapshot']['instruction'] == instruction
    assert store.task_detail(identity[0], t['id'])['config']['goal'] == goal


def test_ask_user_schema_and_question_normalization(identity):
    schemas = {s['function']['name']: s['function'] for s in tools.tool_schemas(task(identity)['config'])}
    ask = schemas['ask_user']['parameters']['properties']
    assert ask['options']['minItems'] == 2 and ask['options']['maxItems'] == 8
    assert ask['multi_select']['type'] == 'boolean'
    assert tools.normalize_question({'question': '选哪个方案？', 'options': [
        {'label': 'A', 'description': '先做减法'}, {'label': 'B'}]}) == {
        'question': '选哪个方案？', 'header': '', 'detail': '',
        'options': [{'label': 'A', 'description': '先做减法'}, {'label': 'B'}], 'multi_select': False}
    assert tools.normalize_question({'question': '选哪些？', 'multi_select': True,
                                     'options': [{'label': 'A'}, {'label': 'B'}]})['multi_select'] is True
    for bad in ({'question': ''}, {'question': 'x', 'multi_select': True},
                {'question': 'x', 'options': [{'label': 'A'}]},
                {'question': 'x', 'options': [{'label': 'A'}, {'label': 'A'}]}):
        with pytest.raises(ValueError):
            tools.normalize_question(bad)


def test_ask_user_waits_with_structured_question(identity):
    t = task(identity)
    r = run(identity, t)
    async def execute():
        obj = runner.Runner(r['id'])
        await obj.load()
        with pytest.raises(runner.WaitingForUser):
            await obj.tool_call({'id': 'ask', 'function': {'name': 'ask_user', 'arguments': store.encode({
                'question': '用哪一版？', 'header': '版本', 'options': [
                    {'label': 'A', 'description': '保留原稿'}, {'label': 'B', 'description': '重写'}],
                'multi_select': True})}})
    asyncio.run(execute())
    with SessionLocal() as db:
        entry = db.scalar(select(WorkspaceEntry).where(WorkspaceEntry.run_id == r['id']))
        details = json.loads(entry.details)
    assert entry.status == 'waiting'
    assert details['ask']['question'] == '用哪一版？'
    assert [o['label'] for o in details['ask']['options']] == ['A', 'B']
    assert details['ask']['multi_select'] is True
    store.finish_run(r['id'], 'completed')


def test_answer_question_starts_continuation_and_marks_entry_done(client, identity, monkeypatch):
    t = task(identity)
    r = run(identity, t)
    entry = store.start_entry(t['id'], r['id'], 'ask', 'tool', 'ask_user')
    store.finish_entry(entry['id'], 'waiting', {
        'question': '用哪一版？', 'header': '版本',
        'ask': {'question': '用哪一版？', 'header': '版本', 'detail': '',
                'options': [{'label': 'A', 'description': '保留原稿'}, {'label': 'B'}],
                'multi_select': False}})
    store.finish_run(r['id'], 'waiting')
    cfg = {'models': [{'id': 'test', 'enabled': True, 'user_usable': True}], 'default_model': 'test'}
    monkeypatch.setattr(api, '_load_cfg', lambda: cfg)
    monkeypatch.setattr(api, '_validate_model', lambda *_: None)
    monkeypatch.setattr(api, 'official_templates', lambda: [])
    monkeypatch.setattr(api, 'load_settings', lambda: WorkspaceSettings())
    body = {'request_key': store.uid(), 'selected': ['A'], 'custom': '保留标题'}
    response = client.post(f"/api/workspace/tasks/{t['id']}/entries/{entry['id']}/answer", json=body)
    assert response.status_code == 202, response.text
    data = response.json()
    assert data['entry']['status'] == 'done'
    assert data['entry']['details']['answer'] == {'selected': ['A'], 'custom': '保留标题', 'skipped': False}
    assert data['run']['mode'] == 'continue'
    assert '问题：用哪一版？' in data['run']['instruction']
    assert '回答：A；补充：保留标题' in data['run']['instruction']
    assert store.load_run(r['id'])['status'] == 'completed'
    saved = store.load_run(data['run']['id'])
    assert saved['snapshot']['instruction'] == data['run']['instruction']
    assert saved['status'] == 'queued'
    # 同一个请求编号重放时不重复创建轮次。
    again = client.post(f"/api/workspace/tasks/{t['id']}/entries/{entry['id']}/answer", json=body)
    assert again.status_code == 202 and again.json()['run']['id'] == data['run']['id']
    store.finish_run(data['run']['id'], 'completed')


def test_answer_question_rejects_option_outside_single_choice(client, identity, monkeypatch):
    t = task(identity)
    r = run(identity, t)
    entry = store.start_entry(t['id'], r['id'], 'ask', 'tool', 'ask_user')
    store.finish_entry(entry['id'], 'waiting', {
        'question': '选一个', 'ask': {'question': '选一个', 'options': [{'label': 'A'}, {'label': 'B'}],
                                       'multi_select': False}})
    store.finish_run(r['id'], 'waiting')
    monkeypatch.setattr(api, 'load_settings', lambda: WorkspaceSettings())
    url = f"/api/workspace/tasks/{t['id']}/entries/{entry['id']}/answer"
    assert client.post(url, json={'request_key': store.uid(), 'selected': ['C']}).status_code == 400
    assert client.post(url, json={'request_key': store.uid(), 'selected': ['A', 'B']}).status_code == 400
    assert client.post(url, json={'request_key': store.uid(), 'selected': []}).status_code == 400


def test_manual_version_rejects_foreign_or_missing_parent(client,identity):
    t=task(identity);other=task(identity)
    foreign=store.save_version(other['id'],'','x','别人的稿','正文')
    endpoint=f"/api/workspace/tasks/{t['id']}/versions"
    body={'request_key':'manual-k1','title':'手改','content':'新正文','parent_id':foreign['id']}
    assert client.post(endpoint,json=body).status_code==404
    body['parent_id']='does-not-exist'
    assert client.post(endpoint,json=body).status_code==404
    body['parent_id']=''
    assert client.post(endpoint,json=body).status_code==200


def test_task_detail_reads_runs_in_one_query(identity):
    """轮次列表不能每行再懒加载一次 snapshot（长任务上线性变慢）。"""
    t=task(identity)
    for index in range(12):
        store.create_run(identity[0],t['id'],store.uid(),'continue',f'第{index}次','',{'model':'test','limits':{'max_steps':2,'max_tokens':1000,'output_tokens':500,'max_seconds':30},'templates':{}},True)
        store.finish_run(store.task_detail(identity[0],t['id'])['runs'][-1]['id'],'stopped')
    from sqlalchemy import event as sa_event
    statements=[]
    def listen(conn,cursor,statement,parameters,context,executemany):
        if statement.lstrip().upper().startswith('SELECT'):statements.append(statement)
    engine=SessionLocal.kw['bind']
    sa_event.listen(engine,'before_cursor_execute',listen)
    try:
        detail=store.task_detail(identity[0],t['id'])
    finally:
        sa_event.remove(engine,'before_cursor_execute',listen)
    assert len(detail['runs'])==12
    run_queries=[s for s in statements if 'workspace_runs' in s]
    assert len(run_queries)==1, run_queries
    # 指令字段仍然给出（只有需要展示的模式才有）。
    assert detail['runs'][0]['instruction']=='第0次'


def test_note_events_carry_the_run_id(client,identity):
    """补充要求事件必须带 run_id：客户端靠它找回合，缺了就不渲染。"""
    t=task(identity);r=run(identity,t)
    with SessionLocal() as db:
        row=db.get(WorkspaceTask,t['id']);row.status='running';row.active_run=r['id'];db.commit()
    assert client.post(f"/api/workspace/tasks/{t['id']}/notes",json={'text':'补一句'}).status_code==200
    events=[e for e in client.get(f"/api/workspace/tasks/{t['id']}/events").json()['events'] if e['kind']=='note']
    assert events and events[0]['data']['run_id']==r['id']
    notes=store.take_notes(r['id'])
    store.apply_notes(r['id'],notes,{'model':'test','limits':{},'templates':{}},[{'role':'user','content':'x'}])
    applied=[e for e in client.get(f"/api/workspace/tasks/{t['id']}/events").json()['events'] if e['kind']=='note']
    assert applied[-1]['data']['applied'] is True and applied[-1]['data']['run_id']==r['id']
    store.finish_run(r['id'],'stopped')


def test_catalog_default_model_is_always_offered(client,identity,monkeypatch):
    """默认模型必须出现在 catalog 给的 models 里，否则新任务默认不可执行。"""
    cfg={'models':[{'id':'a','name':'A','enabled':True,'user_usable':True},
                   {'id':'b','name':'B','enabled':True,'user_usable':True}],
         'available_model_ids':['a'],'default_model':'b','providers':[]}
    monkeypatch.setattr(api,'_load_cfg',lambda:cfg)
    data=client.get('/api/workspace/catalog').json()
    assert [m['id'] for m in data['models']]==['a']
    assert data['default_model']=='a'
    cfg['available_model_ids']=None
    assert client.get('/api/workspace/catalog').json()['default_model']=='b'
    cfg['models']=[{'id':'b','name':'B','enabled':False}]
    assert client.get('/api/workspace/catalog').json()['default_model']==''


def test_events_cursor_pages_without_repeat_or_loss(client,identity):
    """回放游标契约：客户端整个轮询引擎都建立在这上面，必须不重复、不丢、能前进。"""
    t=task(identity);r=run(identity,t)
    with SessionLocal() as db:
        for i in range(450):
            store.event(db,t['id'],"entry",{"id":f"e{i}"})
        db.commit()
    seen,cursor,pages=[],0,0
    while True:
        data=client.get(f"/api/workspace/tasks/{t['id']}/events?after={cursor}").json()
        pages+=1
        assert all(ev['id']>cursor for ev in data['events']), "游标没有前进"
        assert data['cursor']>=cursor
        seen+=[ev['id'] for ev in data['events']]
        cursor=data['cursor']
        if not data['has_more']:
            break
        assert pages<10, "分页没有收敛"
    assert len(seen)==len(set(seen)), "同一事件被回放两次"
    assert len(seen)==451, f"事件数不符：{len(seen)}"  # 450 + 建轮次那一条
    assert pages==3
    store.finish_run(r['id'],'stopped')


def test_events_cursor_boundary_returns_the_next_event_only(client,identity):
    t=task(identity);r=run(identity,t)
    first=client.get(f"/api/workspace/tasks/{t['id']}/events?after=0").json()
    cursor=first['cursor']
    more=client.get(f"/api/workspace/tasks/{t['id']}/events?after={cursor}").json()
    assert all(ev['id']>cursor for ev in more['events'])
    assert not any(ev['id']<=cursor for ev in more['events'])
    store.finish_run(r['id'],'stopped')


def test_concurrent_runs_are_capped_per_user(identity):
    """同一使用码最多两个在途轮次：第三个要被拦下，空出槽位后可以继续。"""
    tasks=[task(identity) for _ in range(3)]
    runs=[run(identity,t) for t in tasks[:2]]
    with pytest.raises(HTTPException) as blocked:run(identity,tasks[2])
    assert blocked.value.status_code==429
    assert '最多' in str(blocked.value.detail)
    store.finish_run(runs[0]['id'],'stopped')
    third=run(identity,tasks[2])
    assert third['status']=='queued'
    for item in (runs[1]['id'],third['id']):store.finish_run(item,'stopped')
