"""Deployment bootstrap must not expose the documented local password."""
import os
import tempfile
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

from app.main import app


class BootstrapTests(unittest.TestCase):
    def test_initial_admin_password_can_be_provided_by_deployment(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {
            "STEELVISION_DATA_DIR": directory,
            "STEELVISION_INITIAL_ADMIN_PASSWORD": "deployment-secret-12345",
        }):
            with TestClient(app, base_url="http://localhost:8000", headers={"Origin": "http://localhost:5173"}) as client:
                custom = client.post("/api/v1/auth/login", json={"username": "admin", "password": "deployment-secret-12345"})
                default = client.post("/api/v1/auth/login", json={"username": "admin", "password": "admin123"})

        self.assertEqual(custom.status_code, 200)
        self.assertEqual(default.status_code, 401)
