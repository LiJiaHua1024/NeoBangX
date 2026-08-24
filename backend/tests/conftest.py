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
