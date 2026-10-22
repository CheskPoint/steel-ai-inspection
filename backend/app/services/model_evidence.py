"""Fail closed when evaluation does not identify this exact deployed model."""
from pydantic import ValidationError

from app.schemas.inference import ModelEvaluation


def load_evaluation(path, fingerprint):
    unavailable = {'status': 'unavailable', 'model_sha256': fingerprint, 'reason': '当前权重没有可验证的评估记录。'}
    try:
        evidence = ModelEvaluation.model_validate_json(path.read_text(encoding='utf-8'))
        if evidence.model_sha256 != fingerprint:
            return {**unavailable, 'reason': '评估记录的权重指纹与当前加载模型不一致，不能作为当前模型指标。'}
        if evidence.status == 'unavailable':
            return {**unavailable, 'reason': evidence.reason or unavailable['reason']}
        if evidence.status == 'available' and (not evidence.source or any(getattr(evidence, metric) is None for metric in ('precision', 'recall', 'map50', 'map50_95'))):
            return {**unavailable, 'reason': '评估证据缺少来源或必需指标。'}
        return evidence.model_dump(exclude_none=True)
    except (OSError, ValueError, ValidationError):
        return unavailable
