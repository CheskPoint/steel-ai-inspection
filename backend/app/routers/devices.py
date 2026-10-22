"""Authenticated network-device endpoints; raw credentials never appear in errors."""
import json

from fastapi import APIRouter, Depends, HTTPException, Request, Response

from app.auth import require_admin, require_operator, require_user
from app.db import audit, connection
from app.services.cameras import CameraError, get_camera_manager

router = APIRouter(prefix='/devices', tags=['devices'])


async def device_payload(request: Request):
    raw = await request.body()
    if len(raw) > 16384:
        raise HTTPException(413, '设备配置过大')
    try:
        data = json.loads(raw)
    except (ValueError, UnicodeError):
        raise HTTPException(422, '设备配置必须为 JSON 对象') from None
    allowed = {'name', 'url', 'username', 'password', 'enabled'}
    if not isinstance(data, dict) or set(data) - allowed:
        raise HTTPException(422, '设备配置字段无效')
    for key, value in data.items():
        if (key == 'enabled' and not isinstance(value, bool)) or (key != 'enabled' and not isinstance(value, str)):
            raise HTTPException(422, '设备配置字段类型无效')
    return data


def invoke(action):
    try:
        return action(get_camera_manager())
    except CameraError as error:
        raise HTTPException(error.status_code, str(error)) from None


def record_action(user, action, result):
    with connection() as db:
        audit(db, user, action, result['id'])
    return result


@router.get('')
def list_devices(user=Depends(require_user)):
    return invoke(lambda manager: manager.list())


@router.post('', status_code=201)
def create_device(user=Depends(require_admin), data=Depends(device_payload)):
    if not {'name', 'url'} <= data.keys():
        raise HTTPException(422, '请填写设备名称和视频地址')
    return record_action(user, 'device_created', invoke(lambda manager: manager.store.create(data)))


@router.patch('/{device_id}')
def update_device(device_id: str, user=Depends(require_admin), data=Depends(device_payload)):
    return record_action(user, 'device_updated', invoke(lambda manager: manager.update(device_id, data)))


@router.post('/{device_id}/connect')
def connect_device(device_id: str, user=Depends(require_operator)):
    return record_action(user, 'device_connect', invoke(lambda manager: manager.connect(device_id)))


@router.post('/{device_id}/disconnect')
def disconnect_device(device_id: str, user=Depends(require_operator)):
    return record_action(user, 'device_disconnect', invoke(lambda manager: manager.disconnect(device_id)))


@router.get('/{device_id}/status')
def device_status(device_id: str, user=Depends(require_user)):
    return invoke(lambda manager: manager.status(device_id))


@router.get('/{device_id}/frame')
def device_frame(device_id: str, user=Depends(require_user)):
    jpeg = invoke(lambda manager: manager.frame(device_id))
    return Response(jpeg, media_type='image/jpeg', headers={
        'Cache-Control': 'no-store, private', 'X-Content-Type-Options': 'nosniff'})
