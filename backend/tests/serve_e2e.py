"""Browser-test server: real model, temporary database, no user-data writes."""
import os
from pathlib import Path
import sys
import tempfile
import io
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

if __name__ == "__main__":
    import uvicorn
    from PIL import Image
    buffer = io.BytesIO()
    Image.new("RGB", (160, 120), (120, 135, 140)).save(buffer, "JPEG")
    jpeg = buffer.getvalue()
    finished = threading.Event()

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def do_GET(self):
            self.send_response(200)
            self.send_header("Content-Type", "multipart/x-mixed-replace; boundary=frame")
            self.end_headers()
            try:
                while not finished.wait(0.1):
                    self.wfile.write(b"--frame\r\nContent-Type: image/jpeg\r\nContent-Length: " + str(len(jpeg)).encode() + b"\r\n\r\n" + jpeg + b"\r\n")
                    self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
                pass

    server = ThreadingHTTPServer(("127.0.0.1", 8002), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    with tempfile.TemporaryDirectory(prefix="steelvision-e2e-") as directory:
        os.environ["STEELVISION_DATA_DIR"] = directory
        os.environ["STEELVISION_ALLOWED_ORIGINS"] = "http://localhost:3001,http://localhost:8001"
        try:
            # Browser tests require model readiness, not just an HTTP health response.
            from app.services.inference import get_model_info
            get_model_info()
            uvicorn.run("app.main:app", host="127.0.0.1", port=8001, log_level="warning")
        finally:
            finished.set()
            server.shutdown()
            server.server_close()
