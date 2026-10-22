# CR7 智检：冷轧钢板表面缺陷检测与质量追溯

本地 `best.pt` 模型已接入。支持单图、文件夹批量、内置/USB 摄像头及 RTSP/HTTP 网络视频检测；批次、钢板、人工复核、质量判定、追溯和报告使用真实本地数据。界面采用紧凑导航、图像卡片和侧边详情。

仓库包含 `frontend/` 前端、`backend/` API 与模型权重、`docs/` 使用文档和 `scripts/` 可复现的模型评估脚本。使用 npm 锁文件安装前端依赖；`backend/models/best.pt` 约 24 MB，随仓库提供以便克隆后运行。验证数据集、业务数据库、摄像头密钥、临时报告和构建产物不随仓库发布。

命名依据为训练工程 `CR7-DET-YOLO/datasets/CR7-DET/README.md.txt`：检测对象是冷轧钢板表面，七类缺陷为夹杂、凹痕、油斑、凹坑、冲孔、线状划痕、黄白色斑。为兼容原有记录和部署配置，内部接口 `coils`、数据库文件名及 `STEELVISION_*` 环境变量保留原名。

## 启动

首次克隆后，安装 Python 3.11+ 和 Node.js 22.13+。在 backend 目录创建本地虚拟环境并启动 API：

```powershell
py -3 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

在 frontend 目录另开终端：

```powershell
npm.cmd ci
npm.cmd run dev -- --port 3000
```

打开 http://localhost:3000 。首次初始化账号 `admin` / `admin123`，登录后在系统设置修改密码。前后端必须使用相同主机名（不要混用 localhost 与 127.0.0.1）。

## 使用顺序

账号分为**总管理员**与**员工**两类。管理员管理全员账号、权限与操作记录；员工执行检测、复核等业务工作，不能修改管理配置。顶部「界面设置」中可切换「角色工作台 / 原版布局」对比页面。详见 [管理员与员工工作台](docs/14-管理员与员工工作台.md)。

1. 生产 → 生产批次新建批次，再到钢板管理登记钢板。
2. 检测工作台 → 选择当前钢板；实时监测使用摄像头，图片/批量检测支持单张、多张图片和文件夹。
3. 缺陷复核 → 至少有一个目标且所有检测框置信度均超过 90% 的图像标记为 AI 自动确认，其余记录人工复检。
4. 生产 → 钢板管理 → 质量判定；全部记录完成检测或复检后才能判定。
5. 质量分析与报告 → 质检报告 → 生成草稿或正式报告 → 打印/另存为 PDF。
6. 质量追溯 → 按北京时间的检测日期打开文件夹，支持跨文件夹搜索与筛选。

摄像头连续预览不自动累计业务记录，停止检测后点击“保存当前结果”才归档该帧。网络设备先在设备管理添加地址和凭据，再去检测工作台选择。

详见 [安装与操作指南](docs/02-快速启动.md)、[当前能力与验收](docs/13-当前阶段说明.md)。

## 数据与验证

本地数据保存于 `backend/data/`：SQLite、图像、设备数据库及摄像头加密密钥。备份时停止后端，完整备份该目录；密钥丢失后原摄像头凭据无法解密。业务记录和报告不会因刷新或服务重启丢失。

- 前端：`npm test`（构建与单元测试）、`npm run test:browser`（真实模型浏览器验收，使用独立临时数据库）。
- 后端：`backend/.venv/Scripts/python.exe -m unittest discover -s tests -v`（在 backend 目录）。测试需安装 `httpx`。
- 网络视频已使用本地生成的 MJPEG 流验证解码、推理、保存和释放；具体设备的 RTSP 地址、编码及厂商 SDK 仍需按实际硬件验证。
- 当前以 CPU 串行推理，实际帧率取决于图片大小和模型耗时。模型可运行不代表现场精度已通过验收。

## 仓库与本地数据

`backend/data/`、`outputs/`、本地 `.env`、`frontend/.openai/hosting.json` 已被 Git 忽略；前端在没有本地托管配置时使用可提交的 `frontend/.openai/hosting.example.json`。这些文件留在自己的电脑上，克隆新仓库时不会出现。旧的打包文件和目录清单也不再纳入提交。代码可使用 `git status` 检查后提交；已有 GitHub 远程名为 `github`，本次整理没有代为推送。

模型指标的原始验证集不在仓库中。拥有数据集时可按 [AI 能力说明](docs/10-AI能力说明.md) 使用 [评估脚本](scripts/evaluate_model.py) 重跑；当前测量结果和条件记录在 `backend/models/evaluation.json`。
