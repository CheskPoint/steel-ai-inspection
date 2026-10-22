"""Query contracts use temporary storage, never the business database."""
import base64
import io
import os
import tempfile
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient
from PIL import Image


class QueryTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.env = patch.dict(os.environ, {"STEELVISION_DATA_DIR": self.tmp.name})
        self.env.start()
        from app.main import app
        self.client = TestClient(app, base_url="http://localhost:8000", headers={"Origin": "http://localhost:5173"})
        self.client.__enter__()
        self.user = self.client.post('/api/v1/auth/login', json={"username": "admin", "password": "admin123"}).json()
        self.client.post('/api/v1/batches', json={"code": "Batch alpha"})
        from app.db import connection, encode
        with connection() as conn:
            self.batch = conn.execute('SELECT id FROM batches').fetchone()[0]
        self.coil = self.client.post('/api/v1/coils', json={"code": "Steel beta", "batch_id": self.batch}).json()['id']
        with connection() as conn:
            for index in range(83):
                state = ['pending', 'auto_confirmed', 'confirmed', 'corrected', 'false_positive'][index % 5]
                boxes = [{"class_id": 0, "class_name": "inclusion", "confidence": .8, "bbox": [1, 1, 10, 10]}]
                reviewed = [] if state == 'false_positive' else ([{**boxes[0], 'class_name': 'linear', 'class_id': 5}] if state == 'corrected' else boxes)
                item = {"id": f"record-{index}", "filename": f"surface-{index}.jpg", "coil_id": self.coil, "source": "batch", "created_by": "admin", "created_at": "2026-10-21T16:00:00+00:00" if index < 80 else "2026-10-21T15:59:59+00:00", "review_status": state, "count": 1, "detections": boxes, "reviewed_detections": None if state == 'pending' else reviewed}
                conn.execute('INSERT INTO inspections VALUES(?,?,?)', (item['id'], self.coil, encode(item)))
            for index in range(75):
                entry = {"id": f"log-{index}", "created_at": "2026-10-21T16:00:00+00:00", "user_id": "employee" if index % 2 else self.user['id'], "username": "worker" if index % 2 else "admin", "action": "inspection_reviewed" if index % 3 else "batch_created", "entity_id": f"record-{index}", "detail": {"note": "needle" if index == 72 else "normal"}}
                conn.execute('INSERT INTO audit_logs VALUES(?,?)', (entry['id'], encode(entry)))

    def tearDown(self):
        self.client.__exit__(None, None, None)
        self.env.stop()
        self.tmp.cleanup()

    def fetch(self, path, **params):
        response = self.client.get('/api/v1' + path, params=params)
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def test_server_pagination_filters_and_empty_page_keep_global_total(self):
        first = self.fetch('/inspections', limit=36)
        second = self.fetch('/inspections', limit=36, offset=36)
        self.assertEqual(first['total'], 83)
        self.assertEqual(len(first['items']), 36)
        self.assertEqual(len(second['items']), 36)
        self.assertFalse({x['id'] for x in first['items']} & {x['id'] for x in second['items']})
        self.assertEqual(self.fetch('/inspections', offset=100)['items'], [])
        self.assertEqual(self.fetch('/inspections', offset=100)['total'], 83)
        self.assertEqual(self.fetch('/inspections', status='human_reviewed')['total'], 49)
        self.assertEqual(self.fetch('/inspections', status='completed')['total'], 66)
        self.assertEqual(self.fetch('/inspections', status='auto_confirmed')['total'], 17)
        self.assertEqual(self.fetch('/inspections', category='linear')['total'], 16)
        self.assertEqual(self.fetch('/inspections', query='Steel beta', batch=self.batch, coil=self.coil)['total'], 83)
        self.assertEqual(self.fetch('/inspections', query='surface-82.jpg')['total'], 1)
        self.assertEqual(self.fetch('/inspections', query="%' OR 1=1 --")['total'], 0)

    def test_folders_and_date_filters_use_beijing_calendar_and_filtered_total(self):
        result = self.fetch('/inspection-folders')
        self.assertEqual(result, {'items': [{'date': '2026-10-22', 'total': 80, 'pending': 16}, {'date': '2026-10-21', 'total': 3, 'pending': 1}], 'total': 2})
        self.assertEqual(self.fetch('/inspections', **{'from': '2026-10-22', 'to': '2026-10-22'})['total'], 80)
        self.assertEqual(self.fetch('/inspections', folder='2026-10-21')['total'], 3)
        self.assertEqual(self.fetch('/inspection-folders', status='pending', limit=1, offset=1)['items'], [{'date': '2026-10-21', 'total': 1, 'pending': 1}])
        for params in [{'from': 'wrong'}, {'from': '2026-10-23', 'to': '2026-10-21'}, {'limit': 0}, {'offset': -1}, {'status': 'madeup'}]:
            self.assertEqual(self.client.get('/api/v1/inspections', params=params).status_code, 422)

    def test_unassigned_filter_matches_unlinked_legacy_name(self):
        from app.db import connection
        with connection() as conn:
            conn.execute("UPDATE inspections SET coil_id=NULL,payload=json_set(payload,'$.coil_id',NULL) WHERE id='record-0'")
        for value in ('unassigned', 'unlinked'):
            self.assertEqual(self.fetch('/inspections', coil=value)['total'], 1)
            self.assertEqual(self.fetch('/inspection-folders', coil=value)['items'][0]['total'], 1)

    def test_analytics_counts_final_human_boxes_separately_from_automatic(self):
        result = self.fetch('/analytics')
        for key, value in {'total': 83, 'pending': 17, 'reviewed': 66, 'autoConfirmed': 17, 'humanReviewed': 49, 'confirmedTargets': 50, 'autoTargets': 17, 'humanTargets': 33}.items():
            self.assertEqual(result[key], value, key)
        self.assertEqual(result['classes'], [{'name': 'inclusion', 'count': 34, 'autoCount': 17, 'humanCount': 17}, {'name': 'linear', 'count': 16, 'autoCount': 0, 'humanCount': 16}])
        self.assertEqual(result['days'], [{'date': '2026-10-21', 'count': 3}, {'date': '2026-10-22', 'count': 80}])
        self.assertEqual(self.fetch('/analytics', **{'from': '2026-10-22'})['total'], 80)

    def test_compact_avoids_loading_all_inspections_logs_or_report_snapshots(self):
        from app.services.business import all_items
        def allowed(conn, table):
            self.assertNotIn(table, {'inspections', 'reports', 'audit_logs'})
            return all_items(conn, table)
        with patch('app.routers.workspace.all_items', side_effect=allowed):
            result = self.fetch('/workspace', compact='true')
        self.assertEqual(result['inspections'], [])
        self.assertEqual(len(result['logs']), 5)
        self.assertEqual(result['stats']['inspections'], 83)
        self.assertEqual(result['stats']['auto_confirmed'], 17)
        self.assertEqual(result['stats']['human_reviewed'], 49)
        self.assertEqual(result['inspection_counts'][self.coil], {'total': 83, 'pending': 17})
        self.assertEqual(len(self.fetch('/workspace')['inspections']), 83)

    def test_audit_pagination_search_and_employee_scope(self):
        result = self.fetch('/audit-logs', query='needle', day='2026-10-22')
        self.assertEqual(result['total'], 1)
        self.assertEqual(result['items'][0]['id'], 'log-72')
        self.assertIn('batch_created', result['actions'])
        self.assertEqual(len(self.fetch('/audit-logs', limit=50)['items']), 50)
        self.client.post('/api/v1/users', json={"username": "worker", "password": "password123"})
        from app.db import connection
        with connection() as conn:
            employee_id = conn.execute("SELECT id FROM users WHERE username='worker'").fetchone()[0]
            conn.execute("UPDATE audit_logs SET payload=json_set(payload,'$.user_id',?) WHERE json_extract(payload,'$.user_id')='employee'", (employee_id,))
        self.client.post('/api/v1/auth/login', json={"username": "worker", "password": "password123"})
        employee = self.fetch('/audit-logs', limit=100)
        self.assertGreaterEqual(employee['total'], 37)
        self.assertTrue(all(item['user_id'] == employee_id for item in employee['items']))
        self.assertEqual(self.fetch('/audit-logs', actor=self.user['id'])['total'], 0)
        self.assertTrue(all(item['user_id'] == employee_id for item in self.fetch('/workspace', compact='true')['logs']))

    def test_compact_user_last_login_uses_full_history_not_five_visible_logs(self):
        from app.db import connection, encode
        with connection() as conn:
            conn.execute("DELETE FROM audit_logs WHERE json_extract(payload,'$.action')='login'")
            entry = {'id': 'old-login', 'created_at': '2026-01-01T08:00:00+00:00', 'user_id': self.user['id'], 'username': 'admin', 'action': 'login', 'detail': ''}
            conn.execute('INSERT INTO audit_logs VALUES(?,?)', (entry['id'], encode(entry)))
            entry.update(id='latest-login', created_at='2026-02-01T08:00:00+00:00')
            conn.execute('INSERT INTO audit_logs VALUES(?,?)', (entry['id'], encode(entry)))
            for index in range(10):
                entry.update(id=f'new-settings-{index}', action='settings_updated')
                conn.execute('INSERT INTO audit_logs VALUES(?,?)', (entry['id'], encode(entry)))
        result = self.fetch('/workspace', compact='true')
        admin = next(user for user in result['users'] if user['id'] == self.user['id'])
        self.assertEqual(admin.get('last_login_at'), '2026-02-01T08:00:00+00:00')
        self.assertFalse(any(item['action'] == 'login' for item in result['logs']))

    def test_inference_and_report_preserve_fingerprint_and_runtime(self):
        buffer = io.BytesIO()
        Image.new('RGB', (20, 20), 'white').save(buffer, format='JPEG')
        content = buffer.getvalue()
        runtime = {'device': 'cpu', 'image_size': 640, 'threshold': .25, 'ultralytics_version': 'test'}
        result = {'model': 'best.pt', 'model_classes': ['inclusion'], 'model_sha256': 'a' * 64, 'runtime': runtime, 'count': 0, 'detections': [], 'image_width': 20, 'image_height': 20, 'annotated_image': 'data:image/jpeg;base64,' + base64.b64encode(content).decode()}
        with patch('app.routers.inferences.run_inference', return_value=result):
            response = self.client.post('/api/v1/inferences', files={'file': ('sample.jpg', content, 'image/jpeg')}, data={'coil_id': self.coil})
        self.assertEqual(response.status_code, 200, response.text)
        item = self.fetch('/inspections/' + response.json()['record_id'])
        self.assertEqual(item.get('model_sha256'), 'a' * 64)
        self.assertEqual(item.get('runtime'), runtime)
        report = self.client.post('/api/v1/reports', json={'coil_id': self.coil}).json()
        self.assertEqual(report['inspections'][-1]['model_sha256'], 'a' * 64)
        self.assertEqual(report['inspections'][-1]['runtime'], runtime)
        legacy = self.fetch('/workspace')['reports'][0]
        self.assertEqual(legacy, report)
        compact = self.fetch('/workspace', compact='true')['reports'][0]
        self.assertEqual(compact['id'], report['id'])
        self.assertNotIn('inspections', compact)


if __name__ == '__main__':
    unittest.main()
