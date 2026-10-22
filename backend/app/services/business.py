"""Transactional business operations, independent from model execution."""
import json
import sqlite3

from fastapi import HTTPException

from app.db import LEGACY_CLASSES, audit, connection, encode, new_id, now
from app.services.media import remove_image, save_annotated, save_image


def get(conn, table, item_id):
    row = conn.execute(f"SELECT payload FROM {table} WHERE id=?", (item_id,)).fetchone()
    if row is None:
        raise HTTPException(404, "记录不存在。")
    return json.loads(row["payload"])


def all_items(conn, table):
    return [json.loads(row["payload"]) for row in conn.execute(f"SELECT payload FROM {table} ORDER BY rowid DESC")]


def update(conn, table, item):
    item_id = item.get("id", item.get("key"))
    extra = ""
    values = []
    if table in {"batches", "coils"}:
        extra += ",code=?"
        values.append(item["code"])
    if table in {"coils", "inspections"}:
        field = "batch_id" if table == "coils" else "coil_id"
        extra += f",{field}=?"
        values.append(item[field])
    conn.execute(f"UPDATE {table} SET payload=?{extra} WHERE id=?", (encode(item), *values, item_id))


def invalidate_coil(conn, coil_id):
    if coil_id:
        coil = get(conn, "coils", coil_id)
        if coil["status"] != "archived":
            coil["status"] = "pending_review"
        coil.pop("judgment", None)
        update(conn, "coils", coil)


def inspection_records(conn, coil_id):
    return [json.loads(row["payload"]) for row in conn.execute("SELECT payload FROM inspections WHERE coil_id=? ORDER BY rowid", (coil_id,))]


def require_reviewed(conn, coil_id):
    records = inspection_records(conn, coil_id)
    if not records:
        raise HTTPException(409, "钢板尚无检测记录，不能判定或生成正式报告。")
    if any(record["review_status"] == "pending" for record in records):
        raise HTTPException(409, "请先完成该钢板所有检测记录的复核。")
    return records


def auto_complete_inspection(conn, item):
    boxes = item["detections"]
    if item["review_status"] != "pending" or not boxes or not all(
        isinstance(box.get("confidence"), (int, float)) and .9 < box["confidence"] <= 1
        for box in boxes
    ):
        return False
    timestamp = now()
    note = "全部检测框置信度均超过 90%，系统自动完成检测。"
    item.update(review_status="auto_confirmed", review_note=note,
                reviewed_detections=boxes, reviewed_at=timestamp, reviewed_by="系统")
    update(conn, "inspections", item)
    event = {"id": new_id(), "inspection_id": item["id"], "status": "auto_confirmed",
             "note": note, "detections": boxes, "username": "系统", "user_id": "system", "created_at": timestamp}
    conn.execute("INSERT INTO review_events VALUES(?,?,?)", (event["id"], item["id"], encode(event)))
    audit(conn, {"id": "system", "username": "系统"}, "inspection_auto_completed", item["id"], note)
    return True


def complete_pending_inspections():
    # Idempotent on restart; never overwrite a human review or a report snapshot.
    with connection() as conn:
        conn.execute("BEGIN IMMEDIATE")
        for item in all_items(conn, "inspections"):
            if auto_complete_inspection(conn, item):
                invalidate_coil(conn, item["coil_id"])


def archive_inference(content, filename, source, threshold, coil_id, result, user):
    original = annotated = None
    try:
        with connection() as conn:
            conn.execute("BEGIN IMMEDIATE")
            if coil_id:
                coil = get(conn, "coils", coil_id)
                if coil["status"] == "archived":
                    raise HTTPException(409, "已归档钢板不能添加检测记录。")
            original = save_image(content)
            annotated = save_annotated(result["annotated_image"])
            record = {"id": new_id(), "filename": filename, "source": source, "coil_id": coil_id, "model": result["model"], "threshold": threshold, "count": result["count"], "detections": result["detections"], "image_width": result["image_width"], "image_height": result["image_height"], "created_at": now(), "created_by": user["username"], "review_status": "pending", "review_note": "", "reviewed_detections": None, "original_image_url": original, "annotated_image_url": annotated}
            # Missing snapshots belong to the original six-class model.
            record["model_classes"] = list(result.get("model_classes", LEGACY_CLASSES))
            record["model_sha256"] = result.get("model_sha256")
            record["runtime"] = result.get("runtime")
            conn.execute("INSERT INTO inspections VALUES(?,?,?)", (record["id"], coil_id, encode(record)))
            auto_complete_inspection(conn, record)
            invalidate_coil(conn, coil_id)
            audit(conn, user, "inspection_archived", record["id"], filename)
        return record["id"]
    except Exception:
        remove_image(original)
        remove_image(annotated)
        raise


def make_report(conn, body, user):
    coil = get(conn, "coils", body.coil_id)
    records = inspection_records(conn, coil["id"])
    if body.final:
        records = require_reviewed(conn, coil["id"])
        if not coil.get("judgment") or coil["judgment"]["status"] not in {"qualified", "unqualified"}:
            raise HTTPException(409, "请先完成钢板质量判定。")
    settings = get(conn, "settings", "default")
    categories = {}
    for record in records:
        boxes = record["reviewed_detections"] if record["reviewed_detections"] is not None else record["detections"]
        for box in boxes:
            categories[box["class_name"]] = categories.get(box["class_name"], 0) + 1
    report = {"id": new_id(), "coil_id": coil["id"], "title": body.title or settings["report_title"], "company_name": settings["company_name"], "kind": "final" if body.final else "draft", "created_at": now(), "created_by": user["username"], "coil": coil, "batch": get(conn, "batches", coil["batch_id"]) if coil["batch_id"] else None, "inspections": records, "summary": {"inspection_count": len(records), "pending_review": sum(r["review_status"] == "pending" for r in records), "defect_count": sum(categories.values()), "categories": categories, "judgment": coil.get("judgment")}}
    conn.execute("INSERT INTO reports VALUES(?,?,?)", (report["id"], coil["id"], encode(report)))
    audit(conn, user, "report_created", report["id"], report["kind"])
    return report
