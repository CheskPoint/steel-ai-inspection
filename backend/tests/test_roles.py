"""Role boundaries use real HTTP sessions and an isolated database."""
import io
import os
import tempfile
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient
from PIL import Image


class RoleTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.env = patch.dict(os.environ, {"STEELVISION_DATA_DIR": self.tmp.name})
        self.env.start()
        from app.main import app
        self.admin = TestClient(app, base_url="http://localhost:8000", headers={"Origin": "http://localhost:5173"})
        self.admin.__enter__()
        self.admin.post("/api/v1/auth/login", json={"username": "admin", "password": "admin123"})
        self.staff = TestClient(app, base_url="http://localhost:8000", headers={"Origin": "http://localhost:5173"})
        self.employee = self.admin.post("/api/v1/users", json={"username": "employee", "password": "employee123", "role": "inspector"}).json()
        self.staff.post("/api/v1/auth/login", json={"username": "employee", "password": "employee123"})

    def tearDown(self):
        self.staff.close()
        self.admin.__exit__(None, None, None)
        self.env.stop()
        self.tmp.cleanup()

    def test_employee_can_operate_but_cannot_change_configuration(self):
        self.assertEqual(self.staff.post("/api/v1/batches", json={"code": "STAFF-BATCH"}).status_code, 200)
        self.assertEqual(self.staff.patch("/api/v1/settings", json={"threshold": 0.5}).status_code, 403)
        self.assertEqual(self.staff.patch(f"/api/v1/users/{self.employee['id']}", json={"role": "admin"}).status_code, 403)
        self.assertEqual(self.staff.patch("/api/v1/knowledge/crazing", json={"notes": "unauthorized"}).status_code, 403)
        buffer = io.BytesIO()
        Image.new("RGB", (8, 8)).save(buffer, format="PNG")
        self.assertEqual(self.staff.post("/api/v1/knowledge/crazing/image", files={"file": ("x.png", buffer.getvalue(), "image/png")}).status_code, 403)

    def test_employee_only_receives_own_audit_entries(self):
        self.staff.post("/api/v1/batches", json={"code": "OWN-WORK"})
        workspace = self.staff.get("/api/v1/workspace").json()
        self.assertEqual(workspace["users"], [])
        self.assertTrue(workspace["logs"])
        self.assertEqual({entry["user_id"] for entry in workspace["logs"]}, {self.employee["id"]})
        admin_logs = self.admin.get("/api/v1/workspace").json()["logs"]
        self.assertEqual({entry["username"] for entry in admin_logs}, {"admin", "employee"})

    def test_admin_role_change_is_explained_without_exposing_passwords(self):
        result = self.admin.patch(f"/api/v1/users/{self.employee['id']}", json={"role": "admin", "password": "new-secret123"})
        self.assertEqual(result.status_code, 200)
        self.assertEqual(self.staff.get("/api/v1/auth/me").status_code, 401)
        workspace = self.admin.get("/api/v1/workspace").json()
        event = next(entry for entry in workspace["logs"] if entry["action"] == "user_updated")
        self.assertIsInstance(event["detail"], dict)
        self.assertEqual(event["detail"]["username"], "employee")
        self.assertEqual(event["detail"]["changes"]["role"], {"before": "inspector", "after": "admin"})
        self.assertTrue(event["detail"]["password_reset"])
        self.assertNotIn("new-secret123", str(workspace))
        self.assertNotIn("password_hash", str(workspace))
        self.assertEqual(self.staff.post("/api/v1/auth/login", json={"username": "employee", "password": "new-secret123"}).status_code, 200)
        self.assertEqual(self.staff.patch("/api/v1/settings", json={"threshold": 0.5}).status_code, 200)
        self.assertEqual(self.admin.patch(f"/api/v1/users/{self.employee['id']}", json={"role": "inspector"}).status_code, 200)
        self.assertEqual(self.staff.get("/api/v1/workspace").status_code, 401)
        self.staff.post("/api/v1/auth/login", json={"username": "employee", "password": "new-secret123"})
        self.assertEqual(self.staff.patch("/api/v1/settings", json={"threshold": 0.4}).status_code, 403)

    def test_only_two_roles_are_available_and_new_users_default_to_employee(self):
        payload = {"username": "defaultstaff", "password": "employee123"}
        self.assertEqual(self.admin.post("/api/v1/users", json=payload).json()["role"], "inspector")
        self.assertEqual(self.admin.post("/api/v1/users", json={**payload, "username": "obsolete", "role": "viewer"}).status_code, 422)
        self.assertEqual(self.admin.patch(f"/api/v1/users/{self.employee['id']}", json={"role": "viewer"}).status_code, 422)

    def test_legacy_readonly_accounts_migrate_once_without_losing_identity(self):
        from app.db import connection, init_db
        with connection() as conn:
            conn.execute("UPDATE users SET role='viewer' WHERE id=?", (self.employee["id"],))
        init_db()
        self.assertEqual(self.staff.get("/api/v1/auth/me").status_code, 401)
        result = self.staff.post("/api/v1/auth/login", json={"username": "employee", "password": "employee123"}).json()
        self.assertEqual(result["id"], self.employee["id"])
        self.assertEqual(result["role"], "inspector")
        self.assertEqual(self.staff.post("/api/v1/batches", json={"code": "MIGRATED"}).status_code, 200)
        self.assertEqual(self.staff.patch("/api/v1/settings", json={"threshold": 0.4}).status_code, 403)
        before = len(self.admin.get("/api/v1/workspace").json()["logs"])
        init_db()
        self.assertEqual(len(self.admin.get("/api/v1/workspace").json()["logs"]), before)

    def test_last_admin_cannot_be_disabled_or_demoted(self):
        admin_id = self.admin.get("/api/v1/auth/me").json()["id"]
        for payload in ({"role": "inspector"}, {"active": False}):
            self.assertEqual(self.admin.patch(f"/api/v1/users/{admin_id}", json=payload).status_code, 409)

    def test_disabled_employee_loses_access_and_cannot_login(self):
        self.assertEqual(self.admin.patch(f"/api/v1/users/{self.employee['id']}", json={"active": False}).status_code, 200)
        self.assertEqual(self.staff.get("/api/v1/workspace").status_code, 401)
        self.assertEqual(self.staff.post("/api/v1/auth/login", json={"username": "employee", "password": "employee123"}).status_code, 401)

    def test_login_entry_must_match_account_role_before_issuing_session(self):
        from app.main import app
        with TestClient(app, base_url="http://localhost:8000", headers={"Origin": "http://localhost:5173"}) as client:
            for username, password, wrong_role, correct_role in (
                ("employee", "employee123", "admin", "inspector"),
                ("admin", "admin123", "inspector", "admin"),
            ):
                result = client.post("/api/v1/auth/login", json={"username": username, "password": password, "role": wrong_role})
                self.assertEqual(result.status_code, 403)
                self.assertNotIn("set-cookie", result.headers)
                self.assertEqual(client.get("/api/v1/auth/me").status_code, 401)
                result = client.post("/api/v1/auth/login", json={"username": username, "password": password, "role": correct_role})
                self.assertEqual(result.status_code, 200)
                self.assertEqual(result.json()["role"], correct_role)
                client.post("/api/v1/auth/logout")
