from typing import Annotated

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    UploadFile,
)
from PIL import Image, UnidentifiedImageError

from app.schemas.inference import ServiceInfo
from app.auth import require_operator, require_user
from app.db import connection, encode, new_id, now
from app.services.business import archive_inference, get


def run_inference(content, threshold):
    # Importing the app for business operations never loads model weights.
    from app.services.inference import run_inference as execute
    return execute(content, threshold)


def get_model_info():
    from app.services.inference import get_model_info as load_info
    return load_info()


router = APIRouter(tags=["inferences"])

MAX_UPLOAD_BYTES = 10 * 1024 * 1024
ALLOWED_CONTENT_TYPES = {"image/jpeg", "image/png"}
ALLOWED_SUFFIXES = (".jpg", ".jpeg", ".png")


@router.post("/inferences")
def create_inference(
    file: Annotated[UploadFile, File()],
    threshold: Annotated[
        float, Form(ge=0.1, le=0.95)
    ] = 0.25,
    source: Annotated[str, Form()] = "manual",
    coil_id: Annotated[str | None, Form()] = None,
    archive: Annotated[bool | None, Form()] = None,
    user: dict = Depends(require_operator),
) -> dict:
    try:
        filename = file.filename or ""
        if source not in {"manual", "batch", "camera"}:
            raise HTTPException(422, "检测来源必须为 manual、batch 或 camera。")
        coil_id = coil_id or None
        if coil_id:
            with connection() as conn:
                get(conn, "coils", coil_id)

        if (
            file.content_type not in ALLOWED_CONTENT_TYPES
            or not filename.lower().endswith(ALLOWED_SUFFIXES)
        ):
            raise HTTPException(
                status_code=415,
                detail="仅支持 JPG、JPEG 或 PNG 图片。",
            )

        content = file.file.read(MAX_UPLOAD_BYTES + 1)

        if not content:
            raise HTTPException(
                status_code=400,
                detail="上传文件不能为空。",
            )

        if len(content) > MAX_UPLOAD_BYTES:
            raise HTTPException(
                status_code=413,
                detail="图片不能超过 10 MB。",
            )

        try:
            result = run_inference(content, threshold)
            if archive if archive is not None else source != "camera":
                record_id = archive_inference(content, filename, source, threshold, coil_id, result, user)
                with connection() as conn:
                    record = get(conn, "inspections", record_id)
                return {**result, "record_id": record_id, "review_status": record["review_status"]}
            return {**result, "record_id": None}
        except (
            UnidentifiedImageError,
            OSError,
            Image.DecompressionBombError,
        ) as exc:
            raise HTTPException(
                status_code=400,
                detail="图片无法解码，请重新选择有效图片。",
            ) from exc
        except HTTPException:
            raise
        except Exception:
            with connection() as conn:
                alert = {"id": new_id(), "kind": "inference", "message": "模型推理或检测归档失败，请检查模型服务和本地存储。", "status": "open", "note": "", "created_at": now()}
                conn.execute("INSERT INTO alerts VALUES(?,?)", (alert["id"], encode(alert)))
            raise HTTPException(503, "检测服务暂不可用，请检查模型与本地存储后重试。") from None
    finally:
        file.file.close()


@router.get("/system/info", response_model=ServiceInfo)
def get_service_info(user: dict = Depends(require_user)) -> ServiceInfo:
    return ServiceInfo(
        service="steelvision-backend",
        version="0.4.0",
        mode="ready",
        max_upload_bytes=MAX_UPLOAD_BYTES,
        accepted_content_types=sorted(
            ALLOWED_CONTENT_TYPES
        ),
        **get_model_info(),
    )
