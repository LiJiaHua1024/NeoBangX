"""测试环境隔离。

必须在导入任何 app.* 模块之前设置 DATA_DIR —— app.database 在被导入时
就会按 settings.data_dir 创建引擎并在磁盘上建目录。这里把数据目录指向
一次性临时目录，避免测试隐式依赖（或污染）开发者本机的真实数据库；
同时手动建表并种入配置默认值，因为 TestClient 不触发应用 lifespan。
"""
import os
import shutil
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

_TEST_DATA_DIR = tempfile.mkdtemp(prefix="neobangx-test-data-")
os.environ["DATA_DIR"] = _TEST_DATA_DIR

import pytest  # noqa: E402
from sqlalchemy import select  # noqa: E402

from app.database import SessionLocal, init_db  # noqa: E402
from app.services.runtime_config import seed_config_from_env  # noqa: E402


@pytest.fixture(scope="session", autouse=True)
def _prepare_database():
    init_db()
    db = SessionLocal()
    try:
        seed_config_from_env(db)
    finally:
        db.close()
    yield
    shutil.rmtree(_TEST_DATA_DIR, ignore_errors=True)


@pytest.fixture(autouse=True)
def _reset_provider_health():
    """熔断器是进程级状态：每个测试前后清零，避免跨测试互相污染。

    不隔离的话，前面测试里记录的瞬态失败会在后面测试里触发熔断沉底，
    把「Provider 顺序 / fallback 次数」类断言搅成随机结果。
    """
    from app.services import provider_health

    provider_health.reset_for_tests()
    yield
    provider_health.reset_for_tests()


@pytest.fixture
def workspace_code():
    """建工作台使用码，并在测试结束后清掉它名下的计费日志。

    不清理会污染其它测试：`test_db_schema_migration` 会清空 `usage_codes`，
    SQLite 随后把 id 从小号重新分配给后建的码；留在 `usage_logs` 里、
    按 `code_id` 统计「自己的记录」的测试（请求日志、视觉论文并行）
    就会读到这些残留行，全量套件因此随机变红。
    """
    import uuid

    from app.models import UsageCode, UsageLog
    from app.services.usage_code import issue_token

    created: list[int] = []

    def make(prefix: str, quota: int = 20, enabled: bool = True):
        with SessionLocal() as db:
            row = UsageCode(code=prefix + uuid.uuid4().hex[:12].upper(), quota=quota, is_enabled=enabled)
            db.add(row)
            db.commit()
            value = row.id, issue_token(row)
        created.append(value[0])
        return value

    yield make

    # 收尾遗留的在途/排队轮次：后台 worker 的测试会领取"全局最早的排队轮次"，
    # 留着排队记录会让它们去跑别人任务，甚至卡住自己的断言。
    from app.agent_workspace import store as workspace_store

    with SessionLocal() as db:
        from app.agent_workspace.models import WorkspaceRun, WorkspaceTask

        pending = [
            run_id
            for run_id in db.scalars(
                select(WorkspaceRun.id)
                .join(WorkspaceTask, WorkspaceRun.task_id == WorkspaceTask.id)
                .where(WorkspaceTask.owner.in_(created), WorkspaceRun.status.in_(workspace_store.ACTIVE))
            )
        ]
    for run_id in pending:
        workspace_store.finish_run(run_id, "stopped", "测试收尾")

    with SessionLocal() as db:
        for code_id in created:
            db.query(UsageLog).filter(UsageLog.code_id == code_id).delete()
        db.commit()
