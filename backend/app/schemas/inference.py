from typing import Literal

from pydantic import BaseModel


class ServiceInfo(BaseModel):
    """Public service capability contract for the system-foundation phase."""

    service: str
    version: str
    mode: Literal["not_deployed", "ready"]
    max_upload_bytes: int
    accepted_content_types: list[str]
