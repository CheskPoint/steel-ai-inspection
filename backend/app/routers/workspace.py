from datetime import date
import json
import math
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.auth import require_admin, require_operator, require_user
from app.db import CLASSES, LEGACY_CLASSES, audit, connection, data_dir, encode, new_id, now, password_hash, public_user
from app.services.business import all_items, get, inspection_records, invalidate_coil, make_report, require_reviewed, update
from app.services.media import remove_image, save_image
from app.services import queries

router = APIRouter(tags=["workspace"])


class Input(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


BatchStatus = Literal["planned", "active", "completed", "archived"]
CoilStatus = Literal["registered", "inspecting", "pending_review", "qualified", "unqualified", "archived"]
Role = Literal["admin", "inspector"]


class BatchCreate(Input):
    code: str = Field(min_length=1, max_length=100)
    line: str = Field(default="", max_length=200)
    production_date: str = ""
    status: BatchStatus = "planned"
    notes: str = Field(default="", max_length=10000)

    @field_validator("production_date")
    @classmethod
    def check_date(cls, value):
        if value:
            date.fromisoformat(value)
        return value


class BatchPatch(Input):
    code: str | None = Field(default=None, min_length=1, max_length=100)
    line: str | None = Field(default=None, max_length=200)
    production_date: str | None = None
    status: BatchStatus | None = None
    notes: str | None = Field(default=None, max_length=10000)

    @field_validator("production_date")
    @classmethod
    def check_date(cls, value):
        if value:
            date.fromisoformat(value)
        return value


class CoilCreate(Input):
    code: str = Field(min_length=1, max_length=100)
    batch_id: str | None = None
    grade: str = Field(default="", max_length=200)
    specification: str = Field(default="", max_length=500)
    status: CoilStatus = "registered"
    notes: str = Field(default="", max_length=10000)


class CoilPatch(Input):
    code: str | None = Field(default=None, min_length=1, max_length=100)
    batch_id: str | None = None
    grade: str | None = Field(default=None, max_length=200)
    specification: str | None = Field(default=None, max_length=500)
    status: CoilStatus | None = None
    notes: str | None = Field(default=None, max_length=10000)


class Judgment(Input):
    status: Literal["qualified", "unqualified"]
    note: str = Field(default="", max_length=10000)


class LinkInspection(Input):
    coil_id: str | None


class Detection(Input):
    class_id: int = Field(ge=0)
    class_name: str
    confidence: float = Field(default=1, ge=0, le=1, allow_inf_nan=False)
    bbox: list[float] = Field(min_length=4, max_length=4)


class Review(Input):
    status: Literal["confirmed", "corrected", "false_positive"]
    note: str = Field(default="", max_length=10000)
    detections: list[Detection] | None = Field(default=None, max_length=2000)


class Report(Input):
    coil_id: str
    title: str = Field(default="", max_length=200)
    final: bool = False


class KnowledgePatch(Input):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=10000)
    features: str | None = Field(default=None, max_length=10000)
    notes: str | None = Field(default=None, max_length=10000)


class SettingsPatch(Input):
    threshold: float | None = Field(default=None, ge=0.1, le=0.95, allow_inf_nan=False)
    interval_ms: int | None = Field(default=None, ge=100, le=60000)
    report_title: str | None = Field(default=None, min_length=1, max_length=200)
    company_name: str | None = Field(default=None, max_length=200)


class UserCreate(Input):
    username: str = Field(min_length=1, max_length=80, pattern=r"^[A-Za-z0-9_.-]+$")
    password: str = Field(min_length=8, max_length=256)
    display_name: str = Field(default="", max_length=100)
    role: Role = "inspector"


class UserPatch(Input):
    display_name: str | None = Field(default=None, max_length=100)
    role: Role | None = None
    active: bool | None = None
    password: str | None = Field(default=None, min_length=8, max_length=256)


class AlertCreate(Input):
    kind: str = Field(min_length=1, max_length=80)
    message: str = Field(min_length=1, max_length=2000)
    device_id: str | None = None


class AlertPatch(Input):
    status: Literal["acknowledged", "resolved"]
    note: str = Field(default="", max_length=10000)


def patch_values(body):
    return body.model_dump(exclude_unset=True, exclude_none=True)


@router.get("/workspace")
def workspace(compact: bool = False, user=Depends(require_user)):
    with connection() as conn:
        result = {table: all_items(conn, table) for table in ("batches", "coils", "knowledge", "alerts")}
        result["inspections"] = [] if compact else all_items(conn, "inspections")
        result["logs"] = queries.audit_page(conn, user, limit=5)["items"] if compact else [entry for entry in all_items(conn, "audit_logs") if user["role"] == "admin" or entry.get("user_id") == user["id"]]
        result["reports"] = queries.report_summaries(conn) if compact else all_items(conn, "reports")
        result["settings"] = get(conn, "settings", "default")
        result["model_classes"] = list(CLASSES)
        result["users"] = [public_user(row) for row in conn.execute("SELECT * FROM users ORDER BY username")] if user["role"] == "admin" else []
        if compact and result['users']:
            last_logins = {row['user_id']: row['created_at'] for row in conn.execute("SELECT json_extract(payload,'$.user_id') AS user_id,MAX(json_extract(payload,'$.created_at')) AS created_at FROM audit_logs WHERE json_extract(payload,'$.action')='login' GROUP BY user_id")}
            for account in result['users']:
                account['last_login_at'] = last_logins.get(account['id'])
        result["stats"], result["inspection_counts"] = queries.workspace_summary(conn)
        return result


def inspection_filters(
    query: str = '', batch: str = '', coil: str = '',
    status: Literal['', 'all', 'pending', 'completed', 'auto_confirmed', 'human_reviewed', 'confirmed', 'corrected', 'false_positive'] = '',
    category: str = '', start: date | None = Query(None, alias='from'),
    end: date | None = Query(None, alias='to'), folder: date | None = None,
):
    return queries.inspection_where(query.strip(), batch, coil, status, category, start, end, folder)


@router.get('/inspections')
def list_inspections(filters=Depends(inspection_filters), offset: int = Query(0, ge=0), limit: int = Query(36, ge=1, le=500), user=Depends(require_user)):
    with connection() as conn:
        return queries.inspection_page(conn, filters, offset, limit)


@router.get('/inspection-folders')
def list_inspection_folders(filters=Depends(inspection_filters), offset: int = Query(0, ge=0), limit: int = Query(36, ge=1, le=500), user=Depends(require_user)):
    with connection() as conn:
        return queries.folder_page(conn, filters, offset, limit)


@router.get('/analytics')
def inspection_analytics(start: date | None = Query(None, alias='from'), end: date | None = Query(None, alias='to'), user=Depends(require_user)):
    with connection() as conn:
        return queries.analytics(conn, start, end)


@router.get('/audit-logs')
def list_audit_logs(query: str = '', actor: str = '', action: str = '', day: date | None = None, offset: int = Query(0, ge=0), limit: int = Query(50, ge=1, le=500), user=Depends(require_user)):
    with connection() as conn:
        return queries.audit_page(conn, user, query.strip(), actor, action, day, offset, limit)


@router.post("/batches")
def create_batch(body: BatchCreate, user=Depends(require_operator)):
    item = {"id": new_id(), **body.model_dump(), "created_at": now()}
    with connection() as conn:
        conn.execute("INSERT INTO batches VALUES(?,?,?)", (item["id"], item["code"], encode(item)))
        audit(conn, user, "batch_created", item["id"], item["code"])
    return item


@router.patch("/batches/{item_id}")
def patch_batch(item_id: str, body: BatchPatch, user=Depends(require_operator)):
    with connection() as conn:
        conn.execute("BEGIN IMMEDIATE")
        item = get(conn, "batches", item_id)
        item.update(patch_values(body))
        update(conn, "batches", item)
        audit(conn, user, "batch_updated", item_id)
        return item


def check_coil_status(status):
    if status in {"qualified", "unqualified"}:
        raise HTTPException(409, "质量结论必须通过完成复核后的判定操作设置。")


@router.post("/coils")
def create_coil(body: CoilCreate, user=Depends(require_operator)):
    check_coil_status(body.status)
    item = {"id": new_id(), **body.model_dump(), "created_at": now()}
    item["batch_id"] = item["batch_id"] or None
    with connection() as conn:
        if item["batch_id"]:
            get(conn, "batches", item["batch_id"])
        conn.execute("INSERT INTO coils VALUES(?,?,?,?)", (item["id"], item["code"], item["batch_id"], encode(item)))
        audit(conn, user, "coil_created", item["id"], item["code"])
    return item


@router.patch("/coils/{item_id}")
def patch_coil(item_id: str, body: CoilPatch, user=Depends(require_operator)):
    check_coil_status(body.status)
    with connection() as conn:
        conn.execute("BEGIN IMMEDIATE")
        item = get(conn, "coils", item_id)
        changes = patch_values(body)
        if "batch_id" in body.model_fields_set:
            changes["batch_id"] = body.batch_id or None
        if changes.get("batch_id"):
            get(conn, "batches", changes["batch_id"])
        item.update(changes)
        if changes.get("status") and changes["status"] != "archived":
            item.pop("judgment", None)
        update(conn, "coils", item)
        audit(conn, user, "coil_updated", item_id)
        return item


@router.post("/coils/{item_id}/judgment")
def judge_coil(item_id: str, body: Judgment, user=Depends(require_operator)):
    with connection() as conn:
        conn.execute("BEGIN IMMEDIATE")
        item = get(conn, "coils", item_id)
        if item["status"] == "archived":
            raise HTTPException(409, "请先将钢板移出归档状态。")
        require_reviewed(conn, item_id)
        item["status"] = body.status
        item["judgment"] = {**body.model_dump(), "created_at": now(), "username": user["username"]}
        update(conn, "coils", item)
        audit(conn, user, "coil_judged", item_id, body.status + ": " + body.note)
        if body.status == "unqualified":
            add_alert(conn, user, "quality", f"钢板 {item['code']} 判定为不合格。{body.note}", None)
        return item


@router.get("/inspections/{item_id}")
def inspection_detail(item_id: str, user=Depends(require_user)):
    with connection() as conn:
        item = get(conn, "inspections", item_id)
        item["review_events"] = [json.loads(row[0]) for row in conn.execute('SELECT payload FROM review_events WHERE inspection_id=? ORDER BY rowid DESC', (item_id,))]
        return item


@router.patch("/inspections/{item_id}")
def link_inspection(item_id: str, body: LinkInspection, user=Depends(require_operator)):
    with connection() as conn:
        conn.execute("BEGIN IMMEDIATE")
        item = get(conn, "inspections", item_id)
        target = body.coil_id or None
        if target:
            if get(conn, "coils", target)["status"] == "archived":
                raise HTTPException(409, "已归档钢板不能添加检测记录。")
        if target != item["coil_id"]:
            invalidate_coil(conn, item["coil_id"])
            invalidate_coil(conn, target)
            item["coil_id"] = target
            update(conn, "inspections", item)
            audit(conn, user, "inspection_linked", item_id, target or "未关联")
        return item


@router.post("/inspections/{item_id}/review")
def review_inspection(item_id: str, body: Review, user=Depends(require_operator)):
    with connection() as conn:
        conn.execute("BEGIN IMMEDIATE")
        item = get(conn, "inspections", item_id)
        if body.status == "corrected" and body.detections is None:
            raise HTTPException(422, "修正复核需要提交人工检测框。")
        boxes = [box.model_dump() for box in body.detections] if body.detections is not None else item["detections"]
        if body.status == "confirmed" and boxes != item["detections"]:
            raise HTTPException(422, "确认 AI 结果须保留原始检测框；修改后请选择修正复核。")
        if body.status == "false_positive":
            if body.detections:
                raise HTTPException(422, "误检记录不能保留人工缺陷框。")
            boxes = []
        classes = item.get("model_classes", LEGACY_CLASSES)
        for box in boxes:
            x1, y1, x2, y2 = box["bbox"]
            if not all(math.isfinite(value) for value in box["bbox"]) or not (0 <= x1 < x2 <= item["image_width"] and 0 <= y1 < y2 <= item["image_height"]):
                raise HTTPException(422, "检测框必须位于图片范围内且面积大于零。")
            if not 0 <= box["class_id"] < len(classes) or box["class_name"] != classes[box["class_id"]]:
                raise HTTPException(422, "检测类别名称与编号不一致。")
        event = {"id": new_id(), "inspection_id": item_id, "status": body.status, "note": body.note, "detections": boxes, "username": user["username"], "user_id": user["id"], "created_at": now()}
        conn.execute("INSERT INTO review_events VALUES(?,?,?)", (event["id"], item_id, encode(event)))
        item.update(review_status=body.status, review_note=body.note, reviewed_detections=boxes, reviewed_at=event["created_at"], reviewed_by=user["username"])
        update(conn, "inspections", item)
        invalidate_coil(conn, item["coil_id"])
        audit(conn, user, "inspection_reviewed", item_id, body.status)
        return item


@router.post("/reports")
def create_report(body: Report, user=Depends(require_operator)):
    with connection() as conn:
        conn.execute("BEGIN IMMEDIATE")
        return make_report(conn, body, user)


@router.get("/reports/{item_id}")
def report_detail(item_id: str, user=Depends(require_user)):
    with connection() as conn:
        return get(conn, "reports", item_id)


@router.patch("/knowledge/{key}")
def patch_knowledge(key: str, body: KnowledgePatch, user=Depends(require_admin)):
    with connection() as conn:
        conn.execute("BEGIN IMMEDIATE")
        item = get(conn, "knowledge", key)
        item.update(patch_values(body))
        update(conn, "knowledge", item)
        audit(conn, user, "knowledge_updated", key)
        return item


@router.post("/knowledge/{key}/image")
def knowledge_image(key: str, file: UploadFile = File(), user=Depends(require_admin)):
    saved = None
    try:
        content = file.file.read(10 * 1024 * 1024 + 1)
        if len(content) > 10 * 1024 * 1024:
            raise HTTPException(413, "图片不能超过 10 MB。")
        if file.content_type not in {"image/jpeg", "image/png"}:
            raise HTTPException(415, "仅支持 JPEG 或 PNG 图片。")
        with connection() as conn:
            conn.execute("BEGIN IMMEDIATE")
            item = get(conn, "knowledge", key)
            saved = save_image(content)
            old = item["image_url"]
            item["image_url"] = saved
            update(conn, "knowledge", item)
            audit(conn, user, "knowledge_image_updated", key)
        remove_image(old)
        return item
    except Exception:
        remove_image(saved)
        raise
    finally:
        file.file.close()


@router.get("/media/{filename}")
def media(filename: str, user=Depends(require_user)):
    if len(filename) != 36 or not filename.endswith(".jpg") or any(c not in "0123456789abcdef" for c in filename[:-4]):
        raise HTTPException(404, "图片不存在。")
    path = data_dir() / "media" / filename
    if not path.is_file():
        raise HTTPException(404, "图片不存在。")
    return FileResponse(path, media_type="image/jpeg", headers={"Cache-Control": "private, no-store"})


@router.patch("/settings")
def patch_settings(body: SettingsPatch, user=Depends(require_admin)):
    with connection() as conn:
        conn.execute("BEGIN IMMEDIATE")
        item = get(conn, "settings", "default")
        item.update(patch_values(body))
        conn.execute("UPDATE settings SET payload=? WHERE id='default'", (encode(item),))
        audit(conn, user, "settings_updated")
        return item


@router.post("/users")
def create_user(body: UserCreate, user=Depends(require_admin)):
    item = {"id": new_id(), "username": body.username, "display_name": body.display_name or body.username, "role": body.role, "active": True}
    with connection() as conn:
        conn.execute("INSERT INTO users VALUES(?,?,?,?,?,?)", (item["id"], item["username"], item["display_name"], item["role"], 1, password_hash(body.password)))
        audit(conn, user, "user_created", item["id"], {"username": item["username"], "role": item["role"]})
    return item


@router.patch("/users/{item_id}")
def patch_user(item_id: str, body: UserPatch, user=Depends(require_admin)):
    with connection() as conn:
        conn.execute("BEGIN IMMEDIATE")
        row = conn.execute("SELECT * FROM users WHERE id=?", (item_id,)).fetchone()
        if row is None:
            raise HTTPException(404, "用户不存在。")
        item = public_user(row)
        changes = patch_values(body)
        item.update({key: value for key, value in changes.items() if key != "password"})
        if row["role"] == "admin" and row["active"] and (item["role"] != "admin" or not item["active"]):
            if conn.execute("SELECT COUNT(*) FROM users WHERE role='admin' AND active=1").fetchone()[0] <= 1:
                raise HTTPException(409, "必须保留至少一个启用的管理员。")
        hashed = password_hash(body.password) if body.password is not None else row["password_hash"]
        conn.execute("UPDATE users SET display_name=?,role=?,active=?,password_hash=? WHERE id=?", (item["display_name"], item["role"], int(item["active"]), hashed, item_id))
        if body.password is not None or not item["active"] or item["role"] != row["role"]:
            conn.execute("DELETE FROM sessions WHERE user_id=?", (item_id,))
        audit(conn, user, "user_updated", item_id, {
            "username": item["username"],
            "changes": {key: {"before": public_user(row)[key], "after": item[key]} for key in ("display_name", "role", "active") if public_user(row)[key] != item[key]},
            "password_reset": body.password is not None,
        })
        return item


def add_alert(conn, user, kind, message, device_id):
    item = {"id": new_id(), "kind": kind, "message": message, "device_id": device_id, "created_at": now(), "status": "open", "note": "", "created_by": user["username"]}
    conn.execute("INSERT INTO alerts VALUES(?,?)", (item["id"], encode(item)))
    audit(conn, user, "alert_created", item["id"], kind)
    return item


@router.post("/alerts")
def create_alert(body: AlertCreate, user=Depends(require_operator)):
    with connection() as conn:
        return add_alert(conn, user, body.kind, body.message, body.device_id)


@router.patch("/alerts/{item_id}")
def patch_alert(item_id: str, body: AlertPatch, user=Depends(require_operator)):
    with connection() as conn:
        conn.execute("BEGIN IMMEDIATE")
        item = get(conn, "alerts", item_id)
        item.update(**body.model_dump(), updated_at=now(), updated_by=user["username"])
        update(conn, "alerts", item)
        audit(conn, user, "alert_updated", item_id, body.status)
        return item
