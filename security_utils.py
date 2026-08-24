"""Controles de seguridad reutilizables para entradas externas."""
from __future__ import annotations

import ipaddress
import socket
from urllib.parse import urljoin, urlparse

import httpx


class UnsafeUrlError(ValueError):
    pass


def validate_public_http_url(url: str) -> str:
    """Acepta sólo HTTP(S) público y bloquea destinos internos o ambiguos."""
    value = (url or "").strip()
    parsed = urlparse(value)
    if parsed.scheme not in ("http", "https"):
        raise UnsafeUrlError("Sólo se permiten URLs http o https")
    if not parsed.hostname or parsed.username or parsed.password:
        raise UnsafeUrlError("La URL no tiene un host público válido")

    host = parsed.hostname.rstrip(".").lower()
    if host == "localhost" or host.endswith(".localhost") or host.endswith(".local"):
        raise UnsafeUrlError("No se permiten direcciones locales")

    try:
        addresses = [ipaddress.ip_address(host)]
    except ValueError:
        try:
            info = socket.getaddrinfo(host, parsed.port or 443, type=socket.SOCK_STREAM)
        except socket.gaierror as exc:
            raise UnsafeUrlError(f"No se pudo resolver el host: {host}") from exc
        addresses = list({ipaddress.ip_address(item[4][0]) for item in info})

    if not addresses or any(not address.is_global for address in addresses):
        raise UnsafeUrlError("La URL resuelve a una red privada o reservada")
    return value


def safe_http_get(url: str, *, timeout=30.0, headers=None, max_redirects: int = 5):
    """GET con validación SSRF en el destino inicial y en cada redirección."""
    current = validate_public_http_url(url)
    with httpx.Client(timeout=timeout, follow_redirects=False) as client:
        for _ in range(max_redirects + 1):
            response = client.get(current, headers=headers)
            if response.status_code not in (301, 302, 303, 307, 308):
                return response
            location = response.headers.get("location")
            if not location:
                return response
            current = validate_public_http_url(urljoin(current, location))
    raise UnsafeUrlError(f"La URL superó el límite de {max_redirects} redirecciones")
