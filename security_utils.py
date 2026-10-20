"""Small, dependency-free helpers for security-sensitive request validation."""
from urllib.parse import urlsplit


def _normalized_origin(value):
    """Return (scheme, hostname, port) for an HTTP(S) URL, or None."""
    if not value or value.strip() != value:
        return None
    try:
        parsed = urlsplit(value)
        scheme = parsed.scheme.lower()
        hostname = (parsed.hostname or "").rstrip(".").lower()
        if scheme not in {"http", "https"} or not hostname:
            return None
        if parsed.username is not None or parsed.password is not None:
            return None
        port = parsed.port
        if port is None:
            port = 443 if scheme == "https" else 80
        return scheme, hostname, port
    except (ValueError, TypeError):
        return None


def is_safe_redirect_target(target):
    """Accept only local absolute paths, never protocol-relative/external URLs."""
    if not isinstance(target, str) or not target or target != target.strip():
        return False
    if any(ord(ch) < 32 or ord(ch) == 127 for ch in target) or "\\\\" in target:
        return False
    if not target.startswith("/") or target.startswith("//"):
        return False
    try:
        parsed = urlsplit(target)
    except ValueError:
        return False
    return not parsed.scheme and not parsed.netloc and not target.startswith("/\\\\")


def is_same_origin_request(*, origin, referer, expected_origin, sec_fetch_site, has_session_cookie):
    """Validate browser mutation origin; allow non-browser clients without session cookies."""
    if (sec_fetch_site or "").lower() == "cross-site":
        return False
    expected = _normalized_origin(expected_origin)
    if expected is None:
        return False
    if origin:
        return _normalized_origin(origin) == expected
    if referer:
        return _normalized_origin(referer) == expected
    # Cookie-authenticated browser requests must provide origin evidence.
    return not has_session_cookie
