import hashlib
import os
import secrets
import time
from typing import Literal
from urllib.parse import urlsplit

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field

from app.db import audit, connection, password_hash, public_user, verify_password

router = APIRouter(prefix="/auth", tags=["auth"])
COOKIE_NAME = "steelvision_session"
ALLOWED_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:3000", "http://127.0.0.1:3000", "http://localhost:8000", "http://127.0.0.1:8000"]
if os.environ.get("STEELVISION_ALLOWED_ORIGINS"):
    ALLOWED_ORIGINS = [value.strip() for value in os.environ["STEELVISION_ALLOWED_ORIGINS"].split(",") if value.strip()]


def verify_origin(request: Request):
    if request.method in {"GET", "HEAD", "OPTIONS"}:
        return
    origin = request.headers.get("origin")
    # Non-browser clients must explicitly identify their trusted origin too.
    if not origin or origin not in ALLOWED_ORIGINS or urlsplit(origin).hostname != request.url.hostname:
        raise HTTPException(403, "请求来源不受信任，请使用与 API 相同的主机名。")


def token_hash(token):
    return hashlib.sha256(token.encode()).hexdigest()


def require_user(request: Request):
    verify_origin(request)
    token = request.cookies.get(COOKIE_NAME, "")
    with connection() as conn:
        row = conn.execute("SELECT users.* FROM sessions JOIN users ON users.id=sessions.user_id WHERE token_hash=? AND expires_at>? AND active=1", (token_hash(token), time.time())).fetchone()
    if row is None:
        raise HTTPException(401, "请先登录，或会话已过期。")
    return public_user(row)


def require_operator(user=Depends(require_user)):
    if user["role"] not in {"admin", "inspector"}:
        raise HTTPException(403, "需要员工或总管理员权限。")
    return user


def require_admin(user=Depends(require_user)):
    if user["role"] != "admin":
        raise HTTPException(403, "需要管理员权限。")
    return user


class Login(BaseModel):
    username: str = Field(min_length=1, max_length=80)
    password: str = Field(min_length=1, max_length=256)
    role: Literal["admin", "inspector"] | None = None


class PasswordChange(BaseModel):
    current_password: str = Field(max_length=256)
    new_password: str = Field(min_length=8, max_length=256)


@router.post("/login")
def login(body: Login, request: Request, response: Response):
    verify_origin(request)
    with connection() as conn:
        row = conn.execute("SELECT * FROM users WHERE username=?", (body.username.strip(),)).fetchone()
        if row is None or not row["active"] or not verify_password(body.password, row["password_hash"]):
            raise HTTPException(401, "用户名或密码不正确。")
        if body.role is not None and body.role != row["role"]:
            entry = "管理员登录" if row["role"] == "admin" else "员工登录"
            raise HTTPException(403, f"账号身份与当前入口不匹配，请选择“{entry}”。")
        token = secrets.token_urlsafe(32)
        old = request.cookies.get(COOKIE_NAME)
        if old:
            conn.execute("DELETE FROM sessions WHERE token_hash=?", (token_hash(old),))
        conn.execute("DELETE FROM sessions WHERE expires_at<=?", (time.time(),))
        conn.execute("INSERT INTO sessions VALUES(?,?,?)", (token_hash(token), row["id"], time.time() + 43200))
        user = public_user(row)
        audit(conn, user, "login")
    response.set_cookie(COOKIE_NAME, token, httponly=True, secure=request.url.scheme == "https", samesite="lax", max_age=43200, path="/")
    return user


@router.get("/me")
def me(user=Depends(require_user)):
    return user


@router.post("/logout")
def logout(request: Request, response: Response, user=Depends(require_user)):
    with connection() as conn:
        conn.execute("DELETE FROM sessions WHERE token_hash=?", (token_hash(request.cookies.get(COOKIE_NAME, "")),))
        audit(conn, user, "logout")
    response.delete_cookie(COOKIE_NAME, path="/")
    return {"ok": True}


@router.post("/password")
def change_password(body: PasswordChange, request: Request, user=Depends(require_user)):
    with connection() as conn:
        row = conn.execute("SELECT password_hash FROM users WHERE id=?", (user["id"],)).fetchone()
        if not verify_password(body.current_password, row["password_hash"]):
            raise HTTPException(400, "当前密码不正确。")
        conn.execute("UPDATE users SET password_hash=? WHERE id=?", (password_hash(body.new_password), user["id"]))
        conn.execute("DELETE FROM sessions WHERE user_id=? AND token_hash<>?", (user["id"], token_hash(request.cookies[COOKIE_NAME])))
        audit(conn, user, "password_changed", user["id"])
    return {"ok": True}
