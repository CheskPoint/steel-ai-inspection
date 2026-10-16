from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routers.inferences import router as inference_router

app = FastAPI(
    title="SteelVision API",
    version="0.3.0",
    description="热轧钢表面缺陷检测接口，使用本地 best.pt 模型。",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    ],
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "steelvision-backend", "mode": "ready"}


app.include_router(inference_router, prefix="/api/v1")
