"""Local durable storage. No production data is created by imports."""
from contextlib import contextmanager
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import secrets
import sqlite3
import uuid

DATA_DIR = Path(os.environ.get("STEELVISION_DATA_DIR", Path(__file__).resolve().parents[1] / "data"))
LEGACY_CLASSES = ("crazing", "inclusion", "patches", "pitted_surface", "rolled-in_scale", "scratches")
LEGACY_CLASS_NAMES = ("龟裂", "夹杂", "斑块", "麻点", "轧入氧化皮", "划痕")
CLASSES = ("inclusion", "dents", "oil_spots", "pits", "punching", "linear", "macular")
CLASS_NAMES = ("夹杂", "凹痕", "油斑", "凹坑", "冲孔", "线状划痕", "黄白色斑")


def data_dir():
    return Path(os.environ.get("STEELVISION_DATA_DIR", str(DATA_DIR)))


def now():
    return datetime.now(timezone.utc).isoformat()


def new_id():
    return uuid.uuid4().hex


def encode(value):
    return json.dumps(value, ensure_ascii=False, allow_nan=False)


def password_hash(password):
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 260000).hex()
    return f"pbkdf2_sha256$260000${salt}${digest}"


def verify_password(password, stored):
    try:
        _, rounds, salt, digest = stored.split("$")
        actual = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), int(rounds)).hex()
        return secrets.compare_digest(actual, digest)
    except (ValueError, TypeError):
        return False


@contextmanager
def connection():
    conn = sqlite3.connect(data_dir() / "steelvision.sqlite3", timeout=15)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys=ON")
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db():
    data_dir().mkdir(parents=True, exist_ok=True)
    (data_dir() / "media").mkdir(exist_ok=True)
    with connection() as conn:
        conn.executescript("""
        PRAGMA journal_mode=WAL;
        CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,username TEXT NOT NULL UNIQUE COLLATE NOCASE,display_name TEXT NOT NULL,role TEXT NOT NULL,active INTEGER NOT NULL,password_hash TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),expires_at REAL NOT NULL);
        CREATE TABLE IF NOT EXISTS batches(id TEXT PRIMARY KEY,code TEXT NOT NULL UNIQUE COLLATE NOCASE,payload TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS coils(id TEXT PRIMARY KEY,code TEXT NOT NULL UNIQUE COLLATE NOCASE,batch_id TEXT REFERENCES batches(id),payload TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS inspections(id TEXT PRIMARY KEY,coil_id TEXT REFERENCES coils(id),payload TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS review_events(id TEXT PRIMARY KEY,inspection_id TEXT NOT NULL REFERENCES inspections(id),payload TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS reports(id TEXT PRIMARY KEY,coil_id TEXT NOT NULL REFERENCES coils(id),payload TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS knowledge(id TEXT PRIMARY KEY,payload TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS settings(id TEXT PRIMARY KEY,payload TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS alerts(id TEXT PRIMARY KEY,payload TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS audit_logs(id TEXT PRIMARY KEY,payload TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS inspections_coil_idx ON inspections(coil_id);
        CREATE INDEX IF NOT EXISTS inspections_status_idx ON inspections(json_extract(payload,'$.review_status'));
        CREATE INDEX IF NOT EXISTS inspections_day_idx ON inspections(date(json_extract(payload,'$.created_at'),'+8 hours'));
        CREATE INDEX IF NOT EXISTS review_events_inspection_idx ON review_events(inspection_id);
        CREATE INDEX IF NOT EXISTS audit_logs_user_idx ON audit_logs(json_extract(payload,'$.user_id'));
        CREATE INDEX IF NOT EXISTS audit_logs_day_idx ON audit_logs(date(json_extract(payload,'$.created_at'),'+8 hours'));
        """)
        # Metadata, rather than user count, prevents silently recreating a default account.
        conn.execute("BEGIN IMMEDIATE")
        if not conn.execute("SELECT 1 FROM metadata WHERE key='initialized'").fetchone():
            conn.execute("INSERT INTO users VALUES(?,?,?,?,?,?)", (new_id(), "admin", "管理员", "admin", 1, password_hash("admin123")))
            conn.execute("INSERT INTO metadata VALUES('initialized',?)", (now(),))
        # Two-role model: merge legacy read-only accounts into the employee role.
        # Preserve identifiers/passwords and revoke sessions when privileges change.
        for row in conn.execute("SELECT id,username FROM users WHERE role='viewer'").fetchall():
            conn.execute("UPDATE users SET role='inspector' WHERE id=?", (row["id"],))
            conn.execute("DELETE FROM sessions WHERE user_id=?", (row["id"],))
            audit(conn, {"id": "system", "username": "系统"}, "user_updated", row["id"], {
                "username": row["username"],
                "changes": {"role": {"before": "viewer", "after": "inspector"}},
                "reason": "原只读账号合并为员工",
            })
        # Preserve historical knowledge and user edits when adding the new model's classes.
        for key, name in zip(LEGACY_CLASSES + CLASSES, LEGACY_CLASS_NAMES + CLASS_NAMES):
            conn.execute("INSERT OR IGNORE INTO knowledge VALUES(?,?)", (key, encode({"key": key, "name": name, "description": "", "features": "", "notes": "", "image_url": None})))
        conn.execute("INSERT OR IGNORE INTO settings VALUES('default',?)", (encode({"threshold": 0.25, "interval_ms": 800, "report_title": "冷轧钢板表面质量检测报告", "company_name": ""}),))
        # Rename only untouched defaults once; historical evidence and custom names stay intact.
        if not conn.execute("SELECT 1 FROM metadata WHERE key='cr7_terminology_v1'").fetchone():
            for key, previous, current in (("linear", "线状缺陷", "线状划痕"), ("macular", "斑状缺陷", "黄白色斑")):
                item = json.loads(conn.execute("SELECT payload FROM knowledge WHERE id=?", (key,)).fetchone()[0])
                if item.get("name") == previous:
                    item["name"] = current
                    conn.execute("UPDATE knowledge SET payload=? WHERE id=?", (encode(item), key))
            settings = json.loads(conn.execute("SELECT payload FROM settings WHERE id='default'").fetchone()[0])
            if settings.get("report_title") == "钢材表面质量检测报告":
                settings["report_title"] = "冷轧钢板表面质量检测报告"
                conn.execute("UPDATE settings SET payload=? WHERE id='default'", (encode(settings),))
            conn.execute("INSERT INTO metadata VALUES('cr7_terminology_v1',?)", (now(),))


def public_user(row):
    return {**{key: row[key] for key in ("id", "username", "display_name", "role")}, "active": bool(row["active"])}


def audit(conn, user, action, entity_id=None, detail=""):
    item = {"id": new_id(), "created_at": now(), "user_id": user["id"], "username": user["username"], "action": action, "entity_id": entity_id, "detail": detail}
    conn.execute("INSERT INTO audit_logs VALUES(?,?)", (item["id"], encode(item)))
