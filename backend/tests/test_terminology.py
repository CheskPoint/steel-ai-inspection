import json
import os
import tempfile
import unittest
from unittest.mock import patch

from app.db import connection, encode, init_db


class TerminologyMigrationTests(unittest.TestCase):
    def test_defaults_migrate_once_without_overwriting_custom_content_or_evidence(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {"STEELVISION_DATA_DIR": directory}):
            init_db()
            with connection() as conn:
                conn.execute("DELETE FROM metadata WHERE key='cr7_terminology_v1'")
                for key, name in (("linear", "线状缺陷"), ("macular", "自定义色斑名称")):
                    item = json.loads(conn.execute("SELECT payload FROM knowledge WHERE id=?", (key,)).fetchone()[0])
                    item.update(name=name, notes="保留自定义说明", image_url="/media/example.jpg")
                    conn.execute("UPDATE knowledge SET payload=? WHERE id=?", (encode(item), key))
                settings = {"report_title": "钢材表面质量检测报告", "threshold": .45, "interval_ms": 1234, "company_name": "测试单位"}
                conn.execute("UPDATE settings SET payload=? WHERE id='default'", (encode(settings),))
                evidence = encode({"filename": "历史钢卷.jpg", "model_classes": ["scratches"], "review_note": "历史记录原文"})
                conn.execute("INSERT INTO inspections VALUES('history',NULL,?)", (evidence,))
            init_db()
            with connection() as conn:
                linear = json.loads(conn.execute("SELECT payload FROM knowledge WHERE id='linear'").fetchone()[0])
                self.assertEqual(linear["name"], "线状划痕")
                self.assertEqual(linear["notes"], "保留自定义说明")
                self.assertEqual(linear["image_url"], "/media/example.jpg")
                self.assertEqual(json.loads(conn.execute("SELECT payload FROM knowledge WHERE id='macular'").fetchone()[0])["name"], "自定义色斑名称")
                self.assertEqual(conn.execute("SELECT payload FROM inspections WHERE id='history'").fetchone()[0], evidence)
                migrated = json.loads(conn.execute("SELECT payload FROM settings WHERE id='default'").fetchone()[0])
                self.assertEqual(migrated, {**settings, "report_title": "冷轧钢板表面质量检测报告"})
                conn.execute("UPDATE settings SET payload=? WHERE id='default'", (encode(settings),))
            init_db()
            with connection() as conn:
                self.assertEqual(json.loads(conn.execute("SELECT payload FROM settings WHERE id='default'").fetchone()[0]), settings)

    def test_custom_report_title_survives_migration(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {"STEELVISION_DATA_DIR": directory}):
            init_db()
            with connection() as conn:
                conn.execute("DELETE FROM metadata WHERE key='cr7_terminology_v1'")
                conn.execute("UPDATE settings SET payload=? WHERE id='default'", (encode({"report_title": "客户专用报告"}),))
            init_db()
            with connection() as conn:
                self.assertEqual(json.loads(conn.execute("SELECT payload FROM settings WHERE id='default'").fetchone()[0])["report_title"], "客户专用报告")
