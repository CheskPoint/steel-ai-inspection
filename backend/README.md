# CR7 智检 后端

FastAPI + SQLite + 本地 YOLO 权重。首次访问模型信息或推理时加载 `models/best.pt`，目前部署 CR7 YOLOv8s 七类权重，使用 CPU、640 输入尺寸；模型缺失不会返回伪造结果。

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

首次安装可先运行 `py -m venv .venv`。本机已安装 cryptography 46.0.7，用于摄像头凭据加密。

## API

- `/health` 只表示 HTTP 服务可响应；真实模型信息见登录后的 `/api/v1/system/info`。
- `/api/v1/auth/login`、`me`、`logout`、`password`：HttpOnly Cookie 会话、密码更新。
- `/api/v1/workspace`：当前业务数据；用户管理数据仅管理员可读。
- `/api/v1/inferences`：multipart `file`、`threshold`（0.1–0.95）、`source`（manual/batch/camera）、可选 `coil_id`、`archive`。单图/批量默认归档，camera 默认不归档；归档返回 `record_id`。
- `/batches`、`/coils`、`/inspections/{id}/review`、`/coils/{id}/judgment`、`/reports`、`/knowledge`、`/settings`、`/users`、`/alerts` 均位于 `/api/v1` 下。
- `/api/v1/devices`：网络设备配置；`/{id}/connect`、`disconnect`、`status`、`frame`：连接控制、状态和最新 JPEG。
- 浏览器文档：http://localhost:8000/docs 。先在同主机名的网站登录，再打开文档测试。

写操作检查 Origin；非浏览器测试客户端也需提供受信任 Origin。默认允许 localhost/127.0.0.1 的 3000、5173、8000 端口。其他地址用环境变量 `STEELVISION_ALLOWED_ORIGINS` 设置逗号分隔的准确来源，同时保持前后端主机名一致。

数据默认在 `backend/data`，可用 `STEELVISION_DATA_DIR` 指向其他目录。首次初始化仅创建本地管理员、当前七类及历史六类知识条目（同名类别共享）和默认参数，不创建生产记录。相机配置保存在 devices.sqlite3，camera.key 与数据库必须一起备份。

网络视频由可终止的独立进程解码，仅保留最新帧；连接/读取超时会回收进程并生成告警。无浏览器续租超过 30 秒自动断开。当前每个后端服务只保持一个活动网络视频源。支持设备暴露的 RTSP/HTTP 视频流，不包含厂商私有工业 SDK。

## 验证

```powershell
.\.venv\Scripts\python.exe -m pip install httpx
.\.venv\Scripts\python.exe -m unittest discover -s tests -v
```

测试使用临时数据目录。`tests/serve_e2e.py` 是浏览器验收专用服务器，启动临时数据库与合成 MJPEG 视频源，不应用于日常运行。

## 2026-10-21 模型切换

当前权重来自 `E0_CR7_YOLOv8s/weights/best.pt`，部署到 `backend/models/best.pt`。
类别编号 0–6 依次为 `inclusion`（夹杂）、`dents`（凹痕）、`oil_spots`（油斑）、`pits`（凹坑）、`punching`（冲孔）、`linear`（线状划痕）、`macular`（黄白色斑）。中文名称可在知识库维护。

新检测记录保存 `model_classes` 类别快照；无该字段的历史记录沿用旧六类编号。复核按记录自己的类别表校验，因此旧记录、原始检测框、复核记录和报告不需要重写。知识库默认显示当前七类，历史类别仍可查看与维护。

本机的旧权重、相关源码和 SQLite 一致性备份位于忽略的 `outputs/model-switch-20261021-181032/`，不包含在 GitHub 仓库中。回滚模型时须同步恢复类别配置和推理源码，不能只覆盖权重。不要用旧数据库备份覆盖切换后新增的业务数据。

之后替换权重时，先检查任务类型与 `app/db.py` 中当前类别名称、顺序一致；不一致时须同步适配。停止后端、备份旧权重、替换文件，再重新启动后端。仅刷新网页不会重新加载模型。

## 2026-10-21 工作流更新

归档图像有至少一个检测框，且所有框的原始置信度均严格大于 0.90 时，后端设置 `review_status=auto_confirmed`，记录系统自动完成事件，并计入已检测。等于 0.90、任一低置信度框及无框结果继续待复检。启动时对历史待复检记录应用同一规则，重复启动不新增重复事件；已人工复核记录及报告快照保持不变。自动完成检测不等于钢板质量合格，钢板最终质量判定仍由操作人员作出。

前端统一图片/批量检测入口支持单张、多张图片和文件夹；实时监测排在首位并默认选中。质量追溯按北京时间（Asia/Shanghai）的检测日期分组为页面文件夹，原始媒体文件不移动。搜索、钢板/批次/状态/类别及日期筛选在分组前执行，搜索覆盖所有日期文件夹。

页面导航合并“生产批次/钢板管理”为“生产”，合并“质量分析/质检报告”为“质量分析与报告”。员工界面不提供用户与权限、系统设置、操作日志入口；后端权限仍独立校验。

本次修改前的源码及数据库备份位于 `outputs/layout-update-20261021-183353/`。

## 2026-10-22 查询与模型证据

新增 `/workspace?compact=true` 摘要、`/inspections` 与 `/inspection-folders` 全量筛选分页、`/analytics` 自动/人工独立统计、`/audit-logs` 权限范围内分页。默认工作区接口保留完整快照兼容。接口契约见 `../docs/07-接口说明.md`。

新归档及报告保存权重 SHA-256 和运行条件。`models/evaluation.json` 保存当前权重的完整验证集指标；仅指纹一致时由 `/system/info` 展示。402 张验证图片上 mAP@0.5 为 87.21%，详细条件与边界见 `../docs/10-AI能力说明.md`。
