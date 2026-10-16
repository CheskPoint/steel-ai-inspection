# SteelVision 后端

FastAPI 服务当前处于模型未部署状态。`/health` 与 `/api/v1/system/info` 可用于查询服务和部署状态；推理接口会明确返回“模型尚未部署”，不会生成模拟检测结果。图片不会写入磁盘或数据库。

```powershell
py -m pip install -r requirements.txt
py -m uvicorn app.main:app --reload --port 8000
```

健康检查：`GET /health`。服务信息：`GET /api/v1/system/info`。接口文档：`http://127.0.0.1:8000/docs`。
