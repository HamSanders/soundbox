"""Call tokens, Python side. Same format as live/api/token.mjs:

    token = base64url(JSON payload) + "." + base64url(HMAC-SHA256(secret, first part))
    payload = {"v": 1, "call": "c_...", "aud": ["voice", "face"], "iat": ..., "exp": ...}

No third-party imports, so it can be tested without the face model's venv.
"""
import base64
import hashlib
import hmac
import json
import os
import time
from pathlib import Path

WS_PROTOCOL = "mirli.v1"
TOKEN_PREFIX = "bearer."


class TokenError(Exception):
    pass


def _b64u(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


def _unb64u(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def _mac(secret: str, data: str) -> bytes:
    return hmac.new(secret.encode(), data.encode(), hashlib.sha256).digest()


def sign(payload: dict, secret: str, ttl_s: int = 120, now: float | None = None) -> str:
    if not secret:
        raise TokenError("no call secret")
    iat = int(time.time() if now is None else now)
    body = {"v": 1, "iat": iat, "exp": iat + ttl_s, **payload}
    head = _b64u(json.dumps(body, separators=(",", ":")).encode())
    return f"{head}.{_b64u(_mac(secret, head))}"


def verify(token, secret: str, aud: str | None = None, now: float | None = None, leeway_s: int = 5) -> dict:
    if not isinstance(token, str):
        raise TokenError("no token")
    parts = token.split(".")
    if len(parts) != 2 or not parts[0] or not parts[1]:
        raise TokenError("malformed token")
    try:
        got = _unb64u(parts[1])
    except Exception:
        raise TokenError("malformed token")
    if not hmac.compare_digest(got, _mac(secret, parts[0])):
        raise TokenError("bad signature")
    try:
        p = json.loads(_unb64u(parts[0]))
    except Exception:
        raise TokenError("malformed token")
    if p.get("v") != 1 or not isinstance(p.get("call"), str) or not p["call"]:
        raise TokenError("malformed token")
    t = time.time() if now is None else now
    if not isinstance(p.get("exp"), (int, float)) or p["exp"] + leeway_s < t:
        raise TokenError("expired")
    auds = p.get("aud") if isinstance(p.get("aud"), list) else [p.get("aud")]
    if aud and aud not in auds and "admin" not in auds:
        raise TokenError("wrong audience")
    return p


def token_from_headers(headers) -> str | None:
    """Authorization: Bearer <t>, or the WebSocket subprotocol "bearer.<t>"."""
    auth = headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        return auth[7:].strip()
    for proto in headers.get("Sec-WebSocket-Protocol", "").split(","):
        proto = proto.strip()
        if proto.startswith(TOKEN_PREFIX):
            return proto[len(TOKEN_PREFIX):]
    return None


def local_secret() -> str | None:
    """MIRLI_CALL_SECRET, else the file the local Call API writes. None = auth off."""
    if os.environ.get("MIRLI_CALL_AUTH") == "off":
        return None
    if os.environ.get("MIRLI_CALL_SECRET"):
        return os.environ["MIRLI_CALL_SECRET"]
    f = Path(os.environ.get("MIRLI_CALL_SECRET_FILE", Path.home() / ".mirli-live" / "call-secret"))
    return f.read_text().strip() if f.exists() else None


def allowed_origins() -> list[str]:
    return [o.strip() for o in os.environ.get("MIRLI_ALLOWED_ORIGINS", "").split(",") if o.strip()]
