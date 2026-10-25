import asyncio
import json
from datetime import timedelta
from unittest.mock import AsyncMock

import httpx
import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.database import SessionLocal
from app.models import UsageCode, UsageLog, utcnow
from app.services.usage_code import issue_token
from app.agent_workspace import api, store, tools, mcp, runner, llm
from app.agent_workspace.models import WorkspaceRun, WorkspaceEntry, WorkspaceTask
from app.agent_workspace.settings import WorkspaceSettings


@pytest.fixture
def identity():
    with SessionLocal() as db:
        row=UsageCode(code='WORKSPACE-'+store.uid()[:12].upper(),quota=20,is_enabled=True)
        db.add(row);db.commit()
        return row.id, issue_token(row)


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
    assert client.post('/api/workspace/login',json={'code':code}).status_code==200
    assert client.get('/api/workspace/tasks').status_code==200


def test_owner_and_config_cas(client,identity):
    t=task(identity)
    body={'title':'新名称','revision':1,'config':t['config']}
    assert client.put('/api/workspace/tasks/'+t['id'],json=body).status_code==200
    assert client.put('/api/workspace/tasks/'+t['id'],json=body).status_code==409
    with pytest.raises(HTTPException):store.task_detail(identity[0]+1000,t['id'])
    assert store.task_detail(identity[0],t['id'])['title']=='新名称'


def test_idempotent_run_atomic_charge_and_refund(identity):
    t=task(identity);r=run(identity,t,key='idempotent1');again=run(identity,t,key='idempotent1')
    assert r['id']==again['id']
    with SessionLocal() as db:assert db.get(UsageCode,identity[0]).used_count==1
    with pytest.raises(HTTPException):run(identity,t)
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


def test_patch_failure_never_rewrites(identity,monkeypatch):
    t=task(identity);v=store.save_version(t['id'],'','base','原稿','重复 重复')
    r=run(identity,t);obj=runner.Runner(r['id']);monkeypatch.setattr(runner,'_load_cfg',lambda:{})
    async def execute():
        await obj.load()
        return await obj.tool_call({'id':'p1','function':{'name':'patch_document','arguments':json.dumps({'version_id':v['id'],'old':'重复','new':'丢内容'})}})
    result=asyncio.run(execute());assert result['unchanged']
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
