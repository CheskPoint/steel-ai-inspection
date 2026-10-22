from contextlib import asynccontextmanager
import sqlite3

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.auth import ALLOWED_ORIGINS, router as auth_router
from app.db import init_db
from app.routers.inferences import router as inference_router
from app.routers.workspace import router as workspace_router
from app.routers.devices import router as devices_router
from app.services.cameras import shutdown_cameras
from app.services.business import complete_pending_inspections


@asynccontextmanager
async def lifespan(app):
    init_db()
    complete_pending_inspections()
    yield
    shutdown_cameras()

app = FastAPI(
    title="CR7 智检 API",
    version="0.4.0",
    description="冷轧钢板表面缺陷检测接口，使用本地 best.pt 模型。",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "OPTIONS"],
    allow_headers=["*"],
)


@app.exception_handler(sqlite3.IntegrityError)
async def integrity_error(request: Request, exc: sqlite3.IntegrityError):
    return JSONResponse(status_code=409, content={"detail": "编号或用户名已存在，或关联记录无效。"})


@app.exception_handler(RequestValidationError)
async def validation_error(request: Request, exc: RequestValidationError):
    errors = exc.errors()
    first = errors[0] if errors else {}
    field = ".".join(str(part) for part in first.get("loc", ()) if part != "body")
    return JSONResponse(status_code=422, content={"detail": f"参数 {field} 无效：{first.get('msg', '请检查输入。')}"})


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "steelvision-backend", "mode": "ready"}


app.include_router(inference_router, prefix="/api/v1")
app.include_router(auth_router, prefix="/api/v1")
app.include_router(workspace_router, prefix="/api/v1")
app.include_router(devices_router, prefix="/api/v1")
