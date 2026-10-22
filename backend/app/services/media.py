import base64
from io import BytesIO
from pathlib import Path

from fastapi import HTTPException
from PIL import Image, ImageOps, UnidentifiedImageError

from app.db import data_dir, new_id


def save_image(content: bytes):
    try:
        with Image.open(BytesIO(content)) as source:
            image = ImageOps.exif_transpose(source).convert("RGB")
            image.load()
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as exc:
        raise HTTPException(400, "图片无法解码。") from exc
    filename = new_id() + ".jpg"
    target = data_dir() / "media" / filename
    image.save(target, "JPEG", quality=95)
    return "/api/v1/media/" + filename


def save_annotated(data_url):
    try:
        content = base64.b64decode(data_url.split(",", 1)[1], validate=True)
    except (ValueError, IndexError) as exc:
        raise HTTPException(500, "模型标注图片无效。") from exc
    return save_image(content)


def remove_image(url):
    if url:
        (data_dir() / "media" / Path(url).name).unlink(missing_ok=True)
