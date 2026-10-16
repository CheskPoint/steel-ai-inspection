from typing import Annotated

from fastapi import (
    APIRouter,
    File,
    Form,
    HTTPException,
    UploadFile,
)
from PIL import Image, UnidentifiedImageError

from app.schemas.inference import ServiceInfo
from app.services.inference import run_inference


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
) -> dict:
    try:
        filename = file.filename or ""

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
            return run_inference(content, threshold)
        except (
            UnidentifiedImageError,
            OSError,
            Image.DecompressionBombError,
        ) as exc:
            raise HTTPException(
                status_code=400,
                detail="图片无法解码，请重新选择有效图片。",
            ) from exc
    finally:
        file.file.close()


@router.get("/system/info", response_model=ServiceInfo)
def get_service_info() -> ServiceInfo:
    return ServiceInfo(
        service="steelvision-backend",
        version="0.3.0",
        mode="ready",
        max_upload_bytes=MAX_UPLOAD_BYTES,
        accepted_content_types=sorted(
            ALLOWED_CONTENT_TYPES
        ),
    )