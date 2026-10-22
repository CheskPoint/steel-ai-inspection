"""Persisted network cameras and one isolated, bounded video capture process."""
from __future__ import annotations

from contextlib import closing
from datetime import datetime, timezone
import json
import multiprocessing as mp
import os
from pathlib import Path
import queue
import sqlite3
import threading
import time
from urllib.parse import parse_qsl, quote, unquote, urlencode, urlsplit, urlunsplit
from uuid import uuid4

from cryptography.fernet import Fernet, InvalidToken


class CameraError(ValueError):
    def __init__(self, message: str, status_code: int = 400):
        super().__init__(message)
        self.status_code = status_code


def validate_url(value: str) -> str:
    if not isinstance(value, str) or not value or len(value) > 4096 or any(ord(c) < 33 for c in value):
        raise CameraError('请输入有效的视频流地址')
    try:
        parsed = urlsplit(value)
        if parsed.scheme.lower() not in {'rtsp', 'rtsps', 'http', 'https'} or not parsed.hostname or parsed.fragment:
            raise ValueError()
        if parsed.port is not None and not 1 <= parsed.port <= 65535:
            raise ValueError()
        if '\\' in parsed.netloc:
            raise ValueError()
    except (ValueError, TypeError):
        raise CameraError('仅支持 RTSP、RTSPS、HTTP 或 HTTPS 视频流地址') from None
    return value


def redact_url(value: str) -> str:
    parsed = urlsplit(validate_url(value))
    authority = parsed.netloc.rsplit('@', 1)[-1]
    query = urlencode([(key, '***') for key, _ in parse_qsl(parsed.query, keep_blank_values=True)])
    return urlunsplit((parsed.scheme, authority, parsed.path, query, ''))


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class CameraStore:
    def __init__(self, directory: Path):
        self.directory = Path(directory)
        self.directory.mkdir(parents=True, exist_ok=True)
        key_file = self.directory / 'camera.key'
        try:
            descriptor = os.open(str(key_file), os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        except FileExistsError:
            pass
        else:
            with os.fdopen(descriptor, 'wb') as handle:
                handle.write(Fernet.generate_key())
        try:
            self.cipher = Fernet(key_file.read_bytes())
        except (ValueError, OSError):
            raise CameraError('摄像头密钥不可用，请检查本地数据目录', 503) from None
        self.path = self.directory / 'devices.sqlite3'
        with closing(self._db()) as db, db:
            db.execute('''CREATE TABLE IF NOT EXISTS devices (
                id TEXT PRIMARY KEY, name TEXT NOT NULL, config BLOB NOT NULL,
                enabled INTEGER NOT NULL, last_seen TEXT)''')

    def _db(self):
        db = sqlite3.connect(self.path, timeout=5)
        db.row_factory = sqlite3.Row
        return db

    def _decode(self, row):
        try:
            return json.loads(self.cipher.decrypt(row['config']))
        except (InvalidToken, ValueError, TypeError):
            raise CameraError('摄像头配置无法解密，请恢复原密钥或重新配置设备', 503) from None

    def _row(self, db, ident):
        row = db.execute('SELECT * FROM devices WHERE id=?', (ident,)).fetchone()
        if row is None:
            raise CameraError('设备不存在', 404)
        return row

    def _public(self, row):
        config = self._decode(row)
        return {'id': row['id'], 'name': row['name'], 'url': redact_url(config['url']),
                'has_password': bool(config['password']), 'enabled': bool(row['enabled']),
                'status': 'disconnected', 'error': None, 'last_seen': row['last_seen']}

    def list(self):
        with closing(self._db()) as db:
            return [self._public(row) for row in db.execute('SELECT * FROM devices ORDER BY rowid')]

    def get(self, ident):
        with closing(self._db()) as db:
            return self._public(self._row(db, ident))

    def _config(self, data, previous=None):
        old = previous or {'url': '', 'username': '', 'password': ''}
        url = data.get('url', old['url'])
        # A form round-tripping the redacted public URL must retain the encrypted query.
        if previous and url == redact_url(old['url']):
            url = old['url']
        validate_url(url)
        parsed = urlsplit(url)
        username = unquote(parsed.username) if parsed.username is not None else old['username']
        password = unquote(parsed.password) if parsed.password is not None else old['password']
        for key, value in (('username', data.get('username', username)), ('password', data.get('password', password))):
            if not isinstance(value, str) or len(value) > 1024 or any(ord(c) < 32 for c in value):
                raise CameraError('设备凭据格式无效')
        clean_url = urlunsplit((parsed.scheme, parsed.netloc.rsplit('@', 1)[-1], parsed.path, parsed.query, ''))
        return {'url': clean_url, 'username': data.get('username', username), 'password': data.get('password', password)}

    def create(self, data):
        name = str(data.get('name', '')).strip()
        if not name or len(name) > 100:
            raise CameraError('设备名称长度应为 1–100 个字符')
        config = self._config(data)
        ident = uuid4().hex
        with closing(self._db()) as db, db:
            db.execute('INSERT INTO devices VALUES (?, ?, ?, ?, NULL)',
                       (ident, name, self.cipher.encrypt(json.dumps(config).encode()), int(data.get('enabled', True))))
        return self.get(ident)

    def update(self, ident, data):
        with closing(self._db()) as db, db:
            db.execute('BEGIN IMMEDIATE')
            row = self._row(db, ident)
            name = str(data.get('name', row['name'])).strip()
            if not name or len(name) > 100:
                raise CameraError('设备名称长度应为 1–100 个字符')
            config = self._config(data, self._decode(row))
            db.execute('UPDATE devices SET name=?, config=?, enabled=? WHERE id=?',
                       (name, self.cipher.encrypt(json.dumps(config).encode()), int(data.get('enabled', row['enabled'])), ident))
        return self.get(ident)

    def stream_url(self, ident):
        with closing(self._db()) as db:
            config = self._decode(self._row(db, ident))
        parsed = urlsplit(config['url'])
        auth = ''
        if config['username'] or config['password']:
            auth = quote(config['username'], safe='') + ':' + quote(config['password'], safe='') + '@'
        return urlunsplit((parsed.scheme, auth + parsed.netloc, parsed.path, parsed.query, ''))

    def seen(self, ident, timestamp):
        with closing(self._db()) as db, db:
            db.execute('UPDATE devices SET last_seen=? WHERE id=?', (timestamp, ident))


def _put_latest(output, payload):
    try:
        output.put_nowait(payload)
    except queue.Full:
        try:
            output.get_nowait()
        except queue.Empty:
            pass
        try:
            output.put_nowait(payload)
        except queue.Full:
            pass


def capture_worker(url, frames, errors, stop, connect_timeout, read_timeout):
    """Spawn target: import OpenCV only here; raw decoder errors never reach API/logs."""
    os.environ['OPENCV_FFMPEG_LOGLEVEL'] = '-8'
    os.environ['OPENCV_LOG_LEVEL'] = 'SILENT'
    os.environ['OPENCV_FFMPEG_CAPTURE_OPTIONS'] = (
        'protocol_whitelist;rtsp,rtsps,http,https,tcp,tls,udp,rtp,crypto|rtsp_transport;tcp')
    # FFmpeg native stderr can include credential-bearing URLs, including from failed opens.
    with open(os.devnull, 'w') as null:
        os.dup2(null.fileno(), 2)
    import cv2
    capture = None
    frames.cancel_join_thread()
    errors.cancel_join_thread()
    try:
        capture = cv2.VideoCapture(url, cv2.CAP_FFMPEG, [
            cv2.CAP_PROP_OPEN_TIMEOUT_MSEC, int(connect_timeout * 1000),
            cv2.CAP_PROP_READ_TIMEOUT_MSEC, int(read_timeout * 1000)])
        if not capture.isOpened():
            _put_latest(errors, '无法连接视频流，请检查地址、凭据及网络')
            return
        while not stop.is_set():
            ok, frame = capture.read()
            if not ok or frame is None:
                _put_latest(errors, '视频流读取失败或已经结束')
                return
            height, width = frame.shape[:2]
            if max(height, width) > 1920:
                frame = cv2.resize(frame, (max(1, int(width * 1920 / max(height, width))),
                                           max(1, int(height * 1920 / max(height, width)))))
            ok, encoded = cv2.imencode('.jpg', frame, [cv2.IMWRITE_JPEG_QUALITY, 85])
            if ok:
                _put_latest(frames, (encoded.tobytes(), time.time()))
            stop.wait(0.03)
    except Exception:
        _put_latest(errors, '视频流解码失败，请检查视频格式及网络')
    finally:
        if capture is not None:
            capture.release()


class CameraManager:
    def __init__(self, store, *, worker=capture_worker, connect_timeout=5.0,
                 read_timeout=5.0, idle_timeout=30.0):
        self.store, self.worker = store, worker
        self.connect_timeout, self.read_timeout, self.idle_timeout = connect_timeout, read_timeout, idle_timeout
        self.context = mp.get_context('spawn')
        self.lock = threading.RLock()
        self.active_id = None
        self.process = self.frames = self.errors = self.stop_event = None
        self.latest = None
        self.states = {}
        self.started = self.received = self.lease = 0.0
        self.closed = threading.Event()
        self.monitor = threading.Thread(target=self._monitor, name='camera-watchdog', daemon=True)
        self.monitor.start()

    def _state(self, ident):
        return self.states.setdefault(ident, {'status': 'disconnected', 'error': None})

    def status(self, ident, *, touch=True):
        with self.lock:
            result = self.store.get(ident)
            result.update(self._state(ident))
            if touch and ident == self.active_id:
                self.lease = time.monotonic()
            return result

    def list(self):
        with self.lock:
            return [dict(item, **self._state(item['id'])) for item in self.store.list()]

    def update(self, ident, data):
        with self.lock:
            result = self.store.update(ident, data)
            if self.active_id == ident:
                self._stop()
            return result

    def connect(self, ident):
        with self.lock:
            if self.closed.is_set():
                raise CameraError('摄像头服务正在关闭', 503)
            item = self.store.get(ident)
            if not item['enabled']:
                raise CameraError('设备已停用', 409)
            if self.active_id == ident:
                self.lease = time.monotonic()
                return self.status(ident)
            url = self.store.stream_url(ident)
            self._stop()
            self.frames, self.errors = self.context.Queue(maxsize=1), self.context.Queue(maxsize=1)
            self.stop_event = self.context.Event()
            self.active_id = ident
            self.started = self.lease = time.monotonic()
            self.received = 0.0
            self.states[ident] = {'status': 'connecting', 'error': None}
            self.process = self.context.Process(target=self.worker,
                args=(url, self.frames, self.errors, self.stop_event, self.connect_timeout, self.read_timeout),
                daemon=True, name='steel-camera-' + ident)
            try:
                self.process.start()
            except Exception:
                self._stop('无法启动视频采集进程')
            return self.status(ident)

    def _stop(self, error=None):
        ident = self.active_id
        process = self.process
        if self.stop_event is not None:
            self.stop_event.set()
        if process is not None and process.pid is not None:
            process.join(0.2)
            if process.is_alive():
                process.terminate()
                process.join(0.8)
            if process.is_alive():
                process.kill()
                process.join(0.8)
            if not process.is_alive():
                process.close()
        for output in (self.frames, self.errors):
            if output is not None:
                output.cancel_join_thread()
                output.close()
        if ident is not None:
            self.states[ident] = {'status': 'error' if error else 'disconnected', 'error': error}
            if error:
                self._record_failure(ident, error)
        self.active_id = self.process = self.frames = self.errors = self.stop_event = self.latest = None

    def _record_failure(self, ident, message):
        # Tests can run this standalone service without a business database.
        # Camera cleanup must still succeed if local storage is unavailable.
        from app.db import connection, data_dir, encode, new_id, now
        if self.store.directory.resolve() != data_dir().resolve() or not (data_dir() / 'steelvision.sqlite3').is_file():
            return
        try:
            with connection() as db:
                alert = {'id': new_id(), 'kind': 'device', 'message': message,
                         'device_id': ident, 'status': 'open', 'note': '', 'created_at': now()}
                db.execute('INSERT INTO alerts VALUES(?,?)', (alert['id'], encode(alert)))
        except (sqlite3.Error, OSError):
            pass

    def disconnect(self, ident):
        with self.lock:
            self.store.get(ident)
            if self.active_id == ident:
                self._stop()
            else:
                self.states[ident] = {'status': 'disconnected', 'error': None}
            return self.status(ident)

    def frame(self, ident):
        with self.lock:
            self.store.get(ident)
            if self.active_id != ident or self.latest is None:
                raise CameraError('暂无视频帧，请先连接设备并等待画面', 409)
            self.lease = time.monotonic()
            return self.latest

    def _monitor(self):
        while not self.closed.wait(0.05):
            with self.lock:
                if self.active_id is None:
                    continue
                now = time.monotonic()
                try:
                    jpeg, timestamp = self.frames.get_nowait()
                except queue.Empty:
                    pass
                else:
                    first = not self.received
                    self.latest, self.received = jpeg, now
                    seen = datetime.fromtimestamp(timestamp, timezone.utc).isoformat()
                    self.states[self.active_id] = {'status': 'connected', 'error': None, 'last_seen': seen}
                    if first or now - getattr(self, '_persisted', 0) > 5:
                        self.store.seen(self.active_id, seen)
                        self._persisted = now
                try:
                    error = self.errors.get_nowait()
                except queue.Empty:
                    error = None
                if error:
                    self._stop(error)
                elif now - self.lease > self.idle_timeout:
                    self._stop()
                elif not self.received and now - self.started > self.connect_timeout:
                    self._stop('视频流连接超时，请检查地址及网络')
                elif self.received and now - self.received > self.read_timeout:
                    self._stop('视频流读取超时，请重新连接')
                elif not self.process.is_alive():
                    self._stop('视频采集进程已停止，请重新连接')

    def shutdown(self):
        self.closed.set()
        with self.lock:
            self._stop()
        if threading.current_thread() is not self.monitor:
            self.monitor.join(2)


_singleton = None
_singleton_lock = threading.Lock()


def get_camera_manager():
    global _singleton
    with _singleton_lock:
        if _singleton is None or _singleton.closed.is_set():
            directory = Path(os.environ.get('STEELVISION_DATA_DIR', Path(__file__).resolve().parents[2] / 'data'))
            _singleton = CameraManager(CameraStore(directory))
        return _singleton


def shutdown_cameras():
    global _singleton
    with _singleton_lock:
        if _singleton is not None:
            _singleton.shutdown()
            _singleton = None
