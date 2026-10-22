from typing import Literal

from pydantic import BaseModel, Field


class ClassEvaluation(BaseModel):
    name: str
    precision: float = Field(ge=0, le=1, allow_inf_nan=False)
    recall: float = Field(ge=0, le=1, allow_inf_nan=False)
    map50: float = Field(ge=0, le=1, allow_inf_nan=False)
    map50_95: float = Field(ge=0, le=1, allow_inf_nan=False)


class ModelEvaluation(BaseModel):
    status: Literal['available', 'unavailable']
    reason: str | None = None
    dataset: str | None = None
    split: str | None = None
    sample_count: int | None = Field(default=None, ge=1)
    evaluated_at: str | None = None
    device: str | None = None
    image_size: int | None = Field(default=None, ge=1)
    precision: float | None = Field(default=None, ge=0, le=1, allow_inf_nan=False)
    recall: float | None = Field(default=None, ge=0, le=1, allow_inf_nan=False)
    map50: float | None = Field(default=None, ge=0, le=1, allow_inf_nan=False)
    map50_95: float | None = Field(default=None, ge=0, le=1, allow_inf_nan=False)
    inference_ms: float | None = Field(default=None, ge=0, allow_inf_nan=False)
    inference_timing_scope: str | None = None
    per_class: list[ClassEvaluation] | None = None
    model_sha256: str | None = None
    source: str | None = None


class ServiceInfo(BaseModel):
    """Public service capability contract for the system-foundation phase."""

    service: str
    version: str
    mode: Literal["not_deployed", "ready"]
    max_upload_bytes: int
    accepted_content_types: list[str]
    model_name: str | None = None
    classes: list[str] = Field(default_factory=list)
    device: str | None = None
    image_size: int | None = None
    model_sha256: str | None = None
    evaluation: ModelEvaluation | None = None
