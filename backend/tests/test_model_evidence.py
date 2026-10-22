import hashlib
import io
import json
from pathlib import Path
import tempfile
import unittest

from PIL import Image


class ModelEvidenceTests(unittest.TestCase):
    def test_evaluation_is_bound_to_exact_weight_and_rejects_invalid_metrics(self):
        from app.services import inference
        self.assertIn('model_sha256', inference.get_model_info())
        from app.services.model_evidence import load_evaluation
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'evaluation.json'
            available = {'status': 'available', 'model_sha256': 'a' * 64, 'source': 'verified test evidence', 'precision': .8, 'recall': .7, 'map50': .75, 'map50_95': .5}
            path.write_text(json.dumps(available), encoding='utf-8')
            self.assertEqual(load_evaluation(path, 'a' * 64)['precision'], .8)
            self.assertEqual(load_evaluation(path, 'b' * 64)['status'], 'unavailable')
            path.write_text(json.dumps({**available, 'status': 'unavailable'}), encoding='utf-8')
            self.assertNotIn('precision', load_evaluation(path, 'a' * 64))
            path.write_text(json.dumps({**available, 'precision': 80}), encoding='utf-8')
            self.assertEqual(load_evaluation(path, 'a' * 64)['status'], 'unavailable')
            path.write_text('broken-json', encoding='utf-8')
            self.assertEqual(load_evaluation(path, 'a' * 64)['status'], 'unavailable')
            self.assertEqual(load_evaluation(path.parent / 'missing', 'a' * 64)['status'], 'unavailable')

    def test_actual_model_info_and_inference_include_reproducible_snapshot(self):
        from app.services import inference
        actual = hashlib.sha256(inference.MODEL_PATH.read_bytes()).hexdigest()
        info = inference.get_model_info()
        self.assertEqual(info.get('model_sha256'), actual)
        self.assertIn(info.get('evaluation', {}).get('status'), ['available', 'unavailable'])
        buffer = io.BytesIO()
        Image.new('RGB', (32, 32), 'white').save(buffer, format='PNG')
        result = inference.run_inference(buffer.getvalue(), .35)
        self.assertEqual(result.get('model_sha256'), actual)
        self.assertEqual(result.get('runtime', {}).get('threshold'), .35)
        self.assertEqual(result.get('runtime', {}).get('image_size'), 640)
        self.assertEqual(result.get('runtime', {}).get('device'), 'cpu')
        self.assertTrue(result['runtime'].get('ultralytics_version'))
        self.assertTrue(result['runtime'].get('torch_version'))


if __name__ == '__main__':
    unittest.main()
