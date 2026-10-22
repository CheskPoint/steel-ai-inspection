"""Real storage and process lifecycle tests; no physical cameras accessed."""
import json
import multiprocessing
from pathlib import Path
import tempfile
import time
import unittest

try:
    from app.services.cameras import CameraManager, CameraStore, CameraError, validate_url
except ImportError:
    CameraManager = CameraStore = CameraError = validate_url = None


def synthetic_worker(url, frames, errors, stop, connect_timeout, read_timeout):
    while not stop.wait(0.02):
        try:
            frames.put_nowait((b'\xff\xd8synthetic\xff\xd9', time.time()))
        except Exception:
            pass


def stuck_worker(url, frames, errors, stop, connect_timeout, read_timeout):
    time.sleep(60)


def one_frame_worker(url, frames, errors, stop, connect_timeout, read_timeout):
    frames.put((b'\xff\xd8once\xff\xd9', time.time()))
    time.sleep(60)


class CameraTests(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(CameraStore, 'network camera implementation is missing')
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.store = CameraStore(Path(self.tmp.name))

    def manager(self, worker=synthetic_worker, **kwargs):
        manager = CameraManager(self.store, worker=worker, connect_timeout=2.5,
                                read_timeout=0.3, idle_timeout=5, **kwargs)
        self.addCleanup(manager.shutdown)
        return manager

    def device(self, **kwargs):
        return self.store.create({'name': '工位 1', 'url': 'rtsp://127.0.0.1:8554/live', **kwargs})

    def wait_status(self, manager, ident, expected, timeout=5):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            result = manager.status(ident, touch=False)
            if result['status'] == expected:
                return result
            time.sleep(0.03)
        self.fail(f'Expected {expected}, got {result}')

    def test_only_explicit_network_video_protocols_are_accepted(self):
        for value in ['file:///etc/passwd', 'concat:http://x', 'ftp://host/live',
                      'http://', 'rtsp://host:invalid/live', 'http://host/\nsecret']:
            with self.subTest(value=value), self.assertRaises(CameraError):
                validate_url(value)
        for value in ['rtsp://camera/live', 'rtsps://camera/live', 'https://host/live', 'http://[::1]:8080/feed']:
            self.assertTrue(validate_url(value))

    def test_credentials_and_query_tokens_are_encrypted_and_never_public(self):
        item = self.device(url='rtsp://camuser:super-secret@localhost/live?token=private-token', password='separate-secret')
        public = json.dumps(item)
        for secret in ['camuser', 'super-secret', 'separate-secret', 'private-token']:
            self.assertNotIn(secret, public)
            self.assertNotIn(secret.encode(), (Path(self.tmp.name) / 'devices.sqlite3').read_bytes())
        self.assertTrue(item['has_password'])
        reopened = CameraStore(Path(self.tmp.name))
        self.assertEqual(reopened.get(item['id'])['url'], item['url'])
        self.assertIn('separate-secret', reopened.stream_url(item['id']))
        updated = reopened.update(item['id'], {'name': 'renamed', 'url': item['url']})
        self.assertTrue(updated['has_password'])
        self.assertIn('private-token', reopened.stream_url(item['id']))

    def test_disabled_devices_cannot_start_and_disable_releases_process(self):
        manager = self.manager()
        item = self.device(enabled=False)
        with self.assertRaises(CameraError):
            manager.connect(item['id'])
        manager.update(item['id'], {'enabled': True})
        manager.connect(item['id'])
        self.wait_status(manager, item['id'], 'connected')
        manager.update(item['id'], {'enabled': False})
        self.assertEqual(manager.status(item['id'])['status'], 'disconnected')
        self.assertIsNone(manager.active_id)

    def test_latest_frame_switch_and_explicit_disconnect_release_children(self):
        manager = self.manager()
        first, second = self.device(), self.device(name='工位 2')
        manager.connect(first['id'])
        self.wait_status(manager, first['id'], 'connected')
        self.assertTrue(manager.frame(first['id']).startswith(b'\xff\xd8'))
        manager.connect(second['id'])
        self.wait_status(manager, second['id'], 'connected')
        self.assertEqual(manager.status(first['id'])['status'], 'disconnected')
        manager.disconnect(second['id'])
        self.assertIsNone(manager.active_id)
        with self.assertRaises(CameraError):
            manager.frame(second['id'])
        self.assertFalse(any(p.name.startswith('steel-camera-') for p in multiprocessing.active_children()))

    def test_hung_connect_is_bounded_and_error_is_redacted(self):
        manager = self.manager(stuck_worker)
        item = self.device(password='not-in-errors')
        start = time.monotonic()
        self.assertEqual(manager.connect(item['id'])['status'], 'connecting')
        self.assertLess(time.monotonic() - start, 1)
        result = self.wait_status(manager, item['id'], 'error', timeout=6)
        self.assertNotIn('not-in-errors', json.dumps(result))
        self.assertIsNone(manager.active_id)

    def test_stalled_read_and_idle_lease_release_workers(self):
        manager = self.manager(one_frame_worker)
        item = self.device()
        manager.connect(item['id'])
        self.wait_status(manager, item['id'], 'connected')
        self.wait_status(manager, item['id'], 'error')
        manager.shutdown()
        idle = CameraManager(self.store, worker=synthetic_worker, connect_timeout=2.5,
                             read_timeout=1, idle_timeout=0.3)
        self.addCleanup(idle.shutdown)
        idle.connect(item['id'])
        self.wait_status(idle, item['id'], 'disconnected')
        self.assertIsNone(idle.active_id)


if __name__ == '__main__':
    unittest.main()

class CameraHttpTests(unittest.TestCase):
    def setUp(self):
        import os
        from unittest.mock import patch
        from fastapi import FastAPI
        from fastapi.testclient import TestClient
        from app import auth, db
        from app.routers import devices
        from app.services.cameras import shutdown_cameras
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        environment = patch.dict(os.environ, {'STEELVISION_DATA_DIR': self.tmp.name})
        environment.start()
        self.addCleanup(environment.stop)
        self.addCleanup(shutdown_cameras)
        shutdown_cameras()
        db.init_db()
        app = FastAPI()
        app.include_router(auth.router, prefix='/api/v1')
        app.include_router(devices.router, prefix='/api/v1')
        self.client = TestClient(app, base_url='http://localhost:8000', headers={'Origin': 'http://localhost:5173'})
        self.addCleanup(self.client.close)

    def login(self):
        response = self.client.post('/api/v1/auth/login', json={'username': 'admin', 'password': 'admin123'})
        self.assertEqual(response.status_code, 200)

    def test_config_auth_origin_validation_and_audit_do_not_expose_passwords(self):
        from app.db import connection
        self.assertEqual(self.client.get('/api/v1/devices').status_code, 401)
        self.login()
        payload = {'name': 'test', 'url': 'http://127.0.0.1:9/live?token=secret-token', 'password': 'camera-secret'}
        rejected = self.client.post('/api/v1/devices', json=payload, headers={'Origin': 'https://evil.example'})
        self.assertEqual(rejected.status_code, 403)
        invalid = self.client.post('/api/v1/devices', json={**payload, 'password': ['camera-secret']})
        self.assertEqual(invalid.status_code, 422)
        self.assertNotIn('camera-secret', invalid.text)
        created = self.client.post('/api/v1/devices', json=payload)
        self.assertEqual(created.status_code, 201, created.text)
        self.assertNotIn('camera-secret', created.text)
        self.assertNotIn('secret-token', created.text)
        with connection() as conn:
            logs = [json.loads(row['payload']) for row in conn.execute('SELECT payload FROM audit_logs')]
        self.assertTrue(any(row['action'] == 'device_created' for row in logs))
        self.assertNotIn('camera-secret', json.dumps(logs))

    def test_employee_can_operate_but_cannot_configure(self):
        from app.db import connection, password_hash
        with connection() as conn:
            conn.execute('INSERT INTO users VALUES(?,?,?,?,?,?)', ('employee-id', 'viewer', 'Employee', 'inspector', 1, password_hash('view-pass')))
        self.assertEqual(self.client.post('/api/v1/auth/login', json={'username': 'viewer', 'password': 'view-pass'}).status_code, 200)
        self.assertEqual(self.client.get('/api/v1/devices').status_code, 200)
        self.assertEqual(self.client.post('/api/v1/devices', json={'name': 'bad', 'url': 'http://localhost/live'}).status_code, 403)
        self.assertEqual(self.client.post('/api/v1/devices/missing/connect').status_code, 404)

    def test_camera_timeout_creates_one_durable_device_alert(self):
        from app.db import connection
        manager = CameraManager(CameraStore(Path(self.tmp.name)), worker=stuck_worker, connect_timeout=0.2)
        self.addCleanup(manager.shutdown)
        item = manager.store.create({'name': 'timeout camera', 'url': 'rtsp://localhost/live'})
        manager.connect(item['id'])
        deadline = time.monotonic() + 4
        while time.monotonic() < deadline and manager.status(item['id'])['status'] != 'error':
            time.sleep(0.04)
        self.assertEqual(manager.status(item['id'])['status'], 'error')
        with connection() as db:
            alerts = [json.loads(row['payload']) for row in db.execute('SELECT payload FROM alerts')]
        self.assertEqual(len(alerts), 1)
        self.assertEqual(alerts[0]['kind'], 'device')
        self.assertEqual(alerts[0]['device_id'], item['id'])


class RealStreamTests(unittest.TestCase):
    def test_generated_local_mjpeg_can_be_decoded_and_released(self):
        from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
        import io
        import threading
        from PIL import Image
        from app.services.cameras import capture_worker
        buffer = io.BytesIO()
        Image.new('RGB', (64, 48), (20, 90, 150)).save(buffer, format='JPEG')
        jpeg = buffer.getvalue()
        finished = threading.Event()

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_GET(self):
                self.send_response(200)
                self.send_header('Content-Type', 'multipart/x-mixed-replace; boundary=frame')
                self.end_headers()
                try:
                    while not finished.wait(0.04):
                        self.wfile.write(b'--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ' + str(len(jpeg)).encode() + b'\r\n\r\n' + jpeg + b'\r\n')
                        self.wfile.flush()
                except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
                    pass

        server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            with tempfile.TemporaryDirectory() as directory:
                store = CameraStore(Path(directory))
                item = store.create({'name': 'Local generated MJPEG', 'url': f'http://127.0.0.1:{server.server_port}/video'})
                manager = CameraManager(store, worker=capture_worker, connect_timeout=5, read_timeout=2)
                try:
                    manager.connect(item['id'])
                    deadline = time.monotonic() + 7
                    while time.monotonic() < deadline:
                        state = manager.status(item['id'])
                        if state['status'] in {'connected', 'error'}:
                            break
                        time.sleep(0.04)
                    self.assertEqual(state['status'], 'connected', state)
                    decoded = Image.open(io.BytesIO(manager.frame(item['id'])))
                    self.assertEqual(decoded.size, (64, 48))
                    manager.disconnect(item['id'])
                    self.assertIsNone(manager.active_id)
                finally:
                    manager.shutdown()
        finally:
            finished.set()
            server.shutdown()
            server.server_close()
            thread.join(2)
