import base64
import io
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient
from PIL import Image


class BusinessTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.env = patch.dict(os.environ, {"STEELVISION_DATA_DIR": self.tmp.name})
        self.env.start()
        from app.main import app
        self.client = TestClient(app, base_url="http://localhost:8000", headers={"Origin": "http://localhost:5173"})
        self.client.__enter__()

    def tearDown(self):
        self.client.__exit__(None, None, None)
        self.env.stop()
        self.tmp.cleanup()

    def login(self, username="admin", password="admin123"):
        response = self.client.post("/api/v1/auth/login", json={"username": username, "password": password})
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def post(self, path, payload):
        response = self.client.post("/api/v1" + path, json=payload)
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def coil(self):
        batch = self.post("/batches", {"code": "B001", "line": "A", "production_date": "2026-10-16"})
        return self.post("/coils", {"code": "C001", "batch_id": batch["id"], "grade": "Q235", "specification": "1 mm"})

    def infer(self, coil_id=None, source="manual", archive=None, result_override=None):
        buffer = io.BytesIO()
        Image.new("RGB", (20, 20), "white").save(buffer, format="JPEG")
        content = buffer.getvalue()
        result = {"model": "best.pt", "count": 1, "detections": [{"class_id": 0, "class_name": "crazing", "confidence": 0.9, "bbox": [1, 2, 10, 15]}], "image_width": 20, "image_height": 20, "annotated_image": "data:image/jpeg;base64," + base64.b64encode(content).decode()}
        result.update(result_override or {})
        data = {"source": source}
        if coil_id:
            data["coil_id"] = coil_id
        if archive is not None:
            data["archive"] = str(archive).lower()
        with patch("app.routers.inferences.run_inference", return_value=result):
            response = self.client.post("/api/v1/inferences", files={"file": ("test.jpg", content, "image/jpeg")}, data=data)
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def test_only_all_boxes_strictly_above_ninety_percent_complete_automatically(self):
        self.login()
        for confidences, expected in [([.91, .99], "auto_confirmed"), ([.9], "pending"), ([.99, .89], "pending"), ([], "pending")]:
            with self.subTest(confidences=confidences):
                boxes = [{"class_id": 0, "class_name": "crazing", "confidence": confidence, "bbox": [1, 2, 10, 15]} for confidence in confidences]
                result = self.infer(result_override={"count": len(boxes), "detections": boxes})
                record = self.client.get(f"/api/v1/inspections/{result['record_id']}").json()
                self.assertEqual(record["review_status"], expected)
                if expected == "auto_confirmed":
                    self.assertEqual(record["reviewed_detections"], boxes)
                    self.assertEqual(record["reviewed_by"], "系统")
                    self.assertEqual(record["review_events"][0]["status"], "auto_confirmed")
                    self.assertEqual(result.get("review_status"), expected)
                else:
                    self.assertIsNone(record["reviewed_detections"])
                    self.assertEqual(record["review_events"], [])

    def test_existing_pending_high_confidence_records_complete_once_without_rewriting_evidence(self):
        self.login()
        result = self.infer(result_override={"detections": [{"class_id": 0, "class_name": "crazing", "confidence": .99, "bbox": [1, 2, 10, 15]}]})
        record_id = result["record_id"]
        from app.db import connection
        from app.services.business import get, update
        with connection() as conn:
            item = get(conn, "inspections", record_id)
            original = item["detections"]
            item.update(review_status="pending", reviewed_detections=None, review_note="")
            item.pop("reviewed_by", None)
            item.pop("reviewed_at", None)
            update(conn, "inspections", item)
            conn.execute("DELETE FROM review_events WHERE inspection_id=?", (record_id,))
        from app.main import app
        for _ in range(2):
            self.client.__exit__(None, None, None)
            self.client = TestClient(app, base_url="http://localhost:8000", headers={"Origin": "http://localhost:5173"})
            self.client.__enter__()
        self.login()
        record = self.client.get(f"/api/v1/inspections/{record_id}").json()
        self.assertEqual(record["review_status"], "auto_confirmed")
        self.assertEqual(record["detections"], original)
        self.assertEqual(len(record["review_events"]), 1)

    def test_new_model_snapshot_and_seventh_class_review(self):
        self.login()
        classes = ["inclusion", "dents", "oil_spots", "pits", "punching", "linear", "macular"]
        result = self.infer(result_override={"model_classes": classes, "count": 0, "detections": []})
        record_id = result["record_id"]
        record = self.client.get(f"/api/v1/inspections/{record_id}").json()
        self.assertEqual(record.get("model_classes"), classes)
        box = {"class_id": 6, "class_name": "macular", "confidence": 1, "bbox": [1, 2, 10, 15]}
        reviewed = self.post(f"/inspections/{record_id}/review", {"status": "corrected", "detections": [box]})
        self.assertEqual(reviewed["reviewed_detections"], [box])
        for wrong in [{**box, "class_id": 0}, {**box, "class_id": 7}, {**box, "class_id": 0, "class_name": "crazing"}]:
            response = self.client.post(f"/api/v1/inspections/{record_id}/review", json={"status": "corrected", "detections": [wrong]})
            self.assertEqual(response.status_code, 422, response.text)

    def test_legacy_record_without_snapshot_retains_original_class_ids(self):
        self.login()
        result = self.infer()
        record_id = result["record_id"]
        from app.db import connection
        from app.services.business import get, update
        with connection() as conn:
            record = get(conn, "inspections", record_id)
            record.pop("model_classes", None)
            update(conn, "inspections", record)
        self.post(f"/inspections/{record_id}/review", {"status": "confirmed"})
        box = {"class_id": 1, "class_name": "inclusion", "confidence": 1, "bbox": [1, 2, 10, 15]}
        reviewed = self.post(f"/inspections/{record_id}/review", {"status": "corrected", "detections": [box]})
        self.assertEqual(reviewed["detections"], record["detections"])
        response = self.client.post(f"/api/v1/inspections/{record_id}/review", json={"status": "corrected", "detections": [{**box, "class_id": 0}]})
        self.assertEqual(response.status_code, 422)

    def test_auth_origin_logout_and_employee_permissions(self):
        self.assertEqual(self.client.get("/api/v1/workspace").status_code, 401)
        self.login()
        self.assertIn("HttpOnly", self.client.post("/api/v1/auth/login", json={"username": "admin", "password": "admin123"}).headers["set-cookie"])
        self.assertEqual(self.client.post("/api/v1/batches", json={"code": "bad"}, headers={"Origin": "https://evil.example"}).status_code, 403)
        self.post("/users", {"username": "reader", "password": "password123", "display_name": "Employee", "role": "inspector"})
        self.post("/auth/logout", {})
        self.assertEqual(self.client.get("/api/v1/workspace").status_code, 401)
        self.login("reader", "password123")
        self.assertEqual(self.client.post("/api/v1/batches", json={"code": "B"}).status_code, 200)
        self.assertEqual(self.client.patch("/api/v1/settings", json={"threshold": 0.4}).status_code, 403)
        self.assertEqual(self.client.get("/api/v1/workspace").json()["users"], [])

    def test_uniqueness_relations_and_last_admin(self):
        admin = self.login()
        coil = self.coil()
        self.assertEqual(self.client.post("/api/v1/coils", json={"code": "C001"}).status_code, 409)
        self.assertEqual(self.client.post("/api/v1/coils", json={"code": "missing", "batch_id": "missing"}).status_code, 404)
        self.assertEqual(self.client.patch(f"/api/v1/users/{admin['id']}", json={"role": "inspector"}).status_code, 409)
        self.assertEqual(self.client.patch(f"/api/v1/coils/{coil['id']}", json={"status": "qualified"}).status_code, 409)

    def test_review_originals_judgment_snapshot_and_media(self):
        self.login()
        coil = self.coil()
        self.assertEqual(self.client.post(f"/api/v1/coils/{coil['id']}/judgment", json={"status": "qualified", "note": "ok"}).status_code, 409)
        result = self.infer(coil["id"])
        record_id = result["record_id"]
        self.assertEqual(self.client.post("/api/v1/reports", json={"coil_id": coil["id"], "title": "Final", "final": True}).status_code, 409)
        self.post(f"/inspections/{record_id}/review", {"status": "false_positive", "note": "reflection", "detections": []})
        record = self.client.get(f"/api/v1/inspections/{record_id}").json()
        self.assertEqual(record["detections"][0]["class_name"], "crazing")
        self.assertEqual(record["reviewed_detections"], [])
        self.assertEqual(len(record["review_events"]), 1)
        self.assertEqual(self.client.get(record["original_image_url"]).status_code, 200)
        self.post(f"/coils/{coil['id']}/judgment", {"status": "qualified", "note": "review complete"})
        report = self.post("/reports", {"coil_id": coil["id"], "title": "Final", "final": True})
        self.post(f"/inspections/{record_id}/review", {"status": "confirmed", "note": "second review"})
        snapshot = self.client.get(f"/api/v1/reports/{report['id']}").json()
        self.assertEqual(snapshot["inspections"][0]["review_status"], "false_positive")
        current = self.client.get("/api/v1/workspace").json()
        self.assertEqual(current["coils"][0]["status"], "pending_review")
        self.assertGreater(len(current["logs"]), 3)

    def test_camera_archive_default_and_settings_knowledge_alerts(self):
        self.login()
        self.assertIsNone(self.infer(source="camera").get("record_id"))
        self.assertIsNotNone(self.infer(source="camera", archive=True).get("record_id"))
        self.assertEqual(len(self.client.get("/api/v1/workspace").json()["inspections"]), 1)
        response = self.client.patch("/api/v1/settings", json={"threshold": 0.4, "interval_ms": 500, "company_name": "Test"})
        self.assertEqual(response.status_code, 200)
        knowledge = self.client.get("/api/v1/workspace").json()["knowledge"]
        state = self.client.get("/api/v1/workspace").json()
        self.assertEqual(len(state["model_classes"]), 7)
        self.assertTrue(set(state["model_classes"]).issubset({k["key"] for k in knowledge}))
        self.assertIn("crazing", {k["key"] for k in knowledge})
        self.assertEqual(self.client.patch(f"/api/v1/knowledge/{knowledge[0]['key']}", json={"notes": "documented"}).status_code, 200)
        alert = self.post("/alerts", {"kind": "inference", "message": "Failed decoding"})
        self.assertEqual(self.client.patch(f"/api/v1/alerts/{alert['id']}", json={"status": "resolved", "note": "fixed"}).status_code, 200)

    def test_password_persists_and_does_not_rebootstrap(self):
        self.login()
        self.post("/auth/password", {"current_password": "admin123", "new_password": "newpassword123"})
        self.client.__exit__(None, None, None)
        from app.main import app
        self.client = TestClient(app, base_url="http://localhost:8000", headers={"Origin": "http://localhost:5173"})
        self.client.__enter__()
        self.assertEqual(self.client.post("/api/v1/auth/login", json={"username": "admin", "password": "admin123"}).status_code, 401)
        self.login(password="newpassword123")

    def test_restart_preserves_business_records_and_report_snapshot(self):
        self.login()
        coil = self.coil()
        record = self.infer(coil["id"])
        report = self.post("/reports", {"coil_id": coil["id"], "final": False})
        self.client.__exit__(None, None, None)
        from app.main import app
        self.client = TestClient(app, base_url="http://localhost:8000", headers={"Origin": "http://localhost:5173"})
        self.client.__enter__()
        self.login()
        state = self.client.get("/api/v1/workspace").json()
        self.assertEqual(state["coils"][0]["code"], "C001")
        self.assertEqual(state["inspections"][0]["id"], record["record_id"])
        self.assertEqual(self.client.get(f"/api/v1/reports/{report['id']}").json(), report)

    def test_review_bounds_guard_and_reassignment_invalidates_judgment(self):
        self.login()
        coil = self.coil()
        record = self.infer(coil["id"])
        record_id = record["record_id"]
        invalid = {"status": "corrected", "detections": [{"class_id": 0, "class_name": "crazing", "confidence": 1, "bbox": [1, 1, 100, 100]}]}
        self.assertEqual(self.client.post(f"/api/v1/inspections/{record_id}/review", json=invalid).status_code, 422)
        self.assertEqual(self.client.get(f"/api/v1/inspections/{record_id}").json()["review_status"], "pending")
        self.post(f"/inspections/{record_id}/review", {"status": "confirmed"})
        self.post(f"/coils/{coil['id']}/judgment", {"status": "unqualified", "note": "surface crack"})
        self.assertEqual(self.client.patch(f"/api/v1/inspections/{record_id}", json={"coil_id": None}).status_code, 200)
        state = self.client.get("/api/v1/workspace").json()
        self.assertNotIn("judgment", state["coils"][0])
        self.assertEqual(state["alerts"][0]["kind"], "quality")
        self.assertEqual(self.client.post("/api/v1/reports", json={"coil_id": coil["id"], "final": True}).status_code, 409)

    def test_inspector_admin_boundaries_and_session_revocation(self):
        self.login()
        inspector = self.post("/users", {"username": "inspector", "password": "password123", "role": "inspector"})
        admin_cookie = self.client.cookies.get("steelvision_session")
        self.login("inspector", "password123")
        self.post("/batches", {"code": "INSPECTOR"})
        self.assertEqual(self.client.patch("/api/v1/settings", json={"threshold": 0.5}).status_code, 403)
        self.assertEqual(self.client.post("/api/v1/users", json={"username": "other", "password": "password123"}).status_code, 403)
        inspector_cookie = self.client.cookies.get("steelvision_session")
        # Logging into another account rotates the session, so use an independent admin client.
        from app.main import app
        with TestClient(app, base_url="http://localhost:8000", headers={"Origin": "http://localhost:5173"}) as admin:
            admin.post("/api/v1/auth/login", json={"username": "admin", "password": "admin123"})
            self.assertEqual(admin.patch(f"/api/v1/users/{inspector['id']}", json={"active": False}).status_code, 200)
        self.assertEqual(self.client.get("/api/v1/auth/me").status_code, 401)

    def test_images_are_authenticated_and_knowledge_upload_is_durable(self):
        self.login()
        buffer = io.BytesIO()
        Image.new("RGB", (10, 10), "red").save(buffer, format="PNG")
        response = self.client.post("/api/v1/knowledge/crazing/image", files={"file": ("example.png", buffer.getvalue(), "image/png")})
        self.assertEqual(response.status_code, 200, response.text)
        url = response.json()["image_url"]
        self.assertEqual(self.client.get(url).status_code, 200)
        self.post("/auth/logout", {})
        self.assertEqual(self.client.get(url).status_code, 401)

    def test_inference_failure_returns_safe_error_and_alert(self):
        self.login()
        buffer = io.BytesIO()
        Image.new("RGB", (10, 10)).save(buffer, format="JPEG")
        with patch("app.routers.inferences.run_inference", side_effect=RuntimeError("private model path")):
            response = self.client.post("/api/v1/inferences", files={"file": ("example.jpg", buffer.getvalue(), "image/jpeg")})
        self.assertEqual(response.status_code, 503)
        self.assertNotIn("private model path", response.text)
        self.assertEqual(self.client.get("/api/v1/workspace").json()["alerts"][0]["kind"], "inference")


if __name__ == "__main__":
    unittest.main()
