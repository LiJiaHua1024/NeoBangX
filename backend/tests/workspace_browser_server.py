"""仅供本地浏览器验收的隔离服务，绝不访问真实模型和生产数据库。

uv run python tests/workspace_browser_server.py
使用码 WORKSPACE-TEST，端口 8765 / 8766。
"""
import asyncio
import json
import os
import sys
import tempfile
import hashlib
from pathlib import Path

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
os.environ['DATA_DIR']=os.environ.get('NBX_TEST_DATA_DIR') or tempfile.mkdtemp(prefix='nbx-agent-browser-')
os.makedirs(os.environ['DATA_DIR'], exist_ok=True)
os.environ['LITELLM_LOCAL_MODEL_COST_MAP']='true'
os.environ['JWT_SECRET']='agent-browser-tests-only-not-production-123456789'

from app.database import init_db, SessionLocal
from app.models import UsageCode
from sqlalchemy import select
from app.agent_workspace import api, runner, llm, store
from app.agent_workspace.settings import save_settings, WorkspaceSettings
from app.main import app
from app.admin_main import app as admin_app
import uvicorn

init_db()
with SessionLocal() as db:
    if not db.scalar(select(UsageCode).where(UsageCode.code=='WORKSPACE-TEST')):
        db.add(UsageCode(code='WORKSPACE-TEST',quota=100,is_enabled=True));db.commit()
save_settings(WorkspaceSettings())
# 仅用于浏览器验收：多个模型让选择器的自有描述、AA 评级、免费/免码标签
# 和选中勾都能被真实操作。假模型不区分 id，因此模型名不影响执行结果。
cfg={'models':[
        {'id':'test-model','name':'浏览器验收模型','description':'界面验收用的本地假模型。','aa_index':45,'is_free':True,'free_no_code':True,'enabled':True,'user_usable':True},
        {'id':'deepseek/deepseek-v4.1-flash-1017','name':'DeepSeek V4.1 Flash','description':'非对称模型结构，小成本大智能。','aa_index':52,'is_free':False,'free_no_code':False,'enabled':True,'user_usable':True},
        {'id':'minimax/minimax-m3.1-flash','name':'MiniMax M3.1 Flash','description':'兼具前沿编程能力与原生多模态的开放权重模型。','aa_index':43,'is_free':True,'free_no_code':False,'enabled':True,'user_usable':True},
        {'id':'openrouter/anthropic/claude-sonnet-4.5','name':'Claude Sonnet 4.5','description':'长上下文与复杂代码任务的均衡选择。','aa_index':59,'is_free':False,'free_no_code':False,'enabled':True,'user_usable':True},
        {'id':'test-model-plain','name':'无描述模型','description':'','aa_index':48,'is_free':False,'free_no_code':False,'enabled':True,'user_usable':True}],
     'available_model_ids':['test-model','deepseek/deepseek-v4.1-flash-1017','minimax/minimax-m3.1-flash','openrouter/anthropic/claude-sonnet-4.5','test-model-plain'],'default_model':'test-model','providers':[]}
api._load_cfg=lambda:cfg
api._validate_model=lambda *_:None
runner._load_cfg=lambda:cfg


async def fake_model(cfg,model,messages,schemas,budget,emit,**kwargs):
    if kwargs.get('response_format'):
        text=json.dumps({'summary':'以下为界面验收用意见，不代表真实教学评判。','issues':[{'quote':'所有原文保留。','problem':'验收测试意见','evidence':'仅用于界面测试','fix':'由教师确认表述','certainty':'uncertain'}]},ensure_ascii=False)
    elif not schemas:
        text='# 试卷分析\n\n## 阅读材料\n\n所有原文保留。听力原文未提供，不能补写。\n\n| 题号 | 建议 |\n|---|---|\n| 1 | 核对材料依据 |\n| 2 | 说明推断范围 |\n\n'+('这是完整保留的长文段落。\n\n'*2500)+'\n最终内容 END'
    elif not any(m.get('role')=='tool' for m in messages):
        context=json.loads(messages[1]['content'])
        goal=str(context.get('goal') or '')
        # 仅供界面验收：失败与慢速由目标里的关键字触发，不进入正式运行逻辑。
        if '模拟失败' in goal:
            raise RuntimeError('模拟模型错误：用于界面错误状态验收')
        args={'title':'试卷分析','instruction':'保留全部已提供内容','material_ids':[m['id'] for m in context['materials']]}
        slow='慢速执行' in goal
        for _ in range(100 if slow else 67):
            await emit('reasoning','浏览器性能验收用长思考文本。\n'*333)
            await asyncio.sleep(.2 if slow else .02)
        return llm.ModelResult(calls=[{'id':'test-document','type':'function','function':{'name':'create_document','arguments':json.dumps(args)}}],tokens=1000)
    else:text='成果已保存，缺少的听力材料已注明。请在成果页查看。'
    for start in range(0,len(text),1000):
        await emit('output',text[start:start+1000]);await asyncio.sleep(.01)
    return llm.ModelResult(content=text,tokens=1000)

llm.complete=fake_model


@app.post('/__test__/pressure')
def pressure(body: dict, owner: api.Owner):
    task_id=body['task_id']
    store.task_detail(owner,task_id)
    run_id=store.uid()
    for i in range(200):
        entry=store.start_entry(task_id,run_id,str(i),'tool',f'压力活动 {i+1}')
        store.finish_tool(entry['id'],{'text':'完整测试结果', 'index':i})
    text='# 30 万字符成果\n\n'+('中文与 English 😀，完整保留所有内容。\n\n'*15000)+'最后的原文 END'
    version=store.save_version(task_id,'',store.uid(),'压力成果',text,origin='manual')
    return {'version':version,'sha256':hashlib.sha256(text.encode()).hexdigest()}


async def main():
    port=int(os.environ.get('NBX_TEST_PORT','8765'))
    await asyncio.gather(uvicorn.Server(uvicorn.Config(app,host='127.0.0.1',port=port,log_level='warning')).serve(),
                         uvicorn.Server(uvicorn.Config(admin_app,host='127.0.0.1',port=port+1,log_level='warning')).serve())


if __name__=='__main__':asyncio.run(main())
