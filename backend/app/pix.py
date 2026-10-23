"""Geração do BR Code Pix estático (EMV® QRCPS-MPM) com valor e txid."""

import unicodedata


def _ascii(text: str, limit: int) -> str:
    clean = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode()
    return clean.upper()[:limit]


def _emv(field_id: str, value: str) -> str:
    return f"{field_id}{len(value):02d}{value}"


def crc16(payload: str) -> str:
    crc = 0xFFFF
    for byte in payload.encode():
        crc ^= byte << 8
        for _ in range(8):
            crc = ((crc << 1) ^ 0x1021) if crc & 0x8000 else (crc << 1)
            crc &= 0xFFFF
    return f"{crc:04X}"


def br_code(key: str, amount_cents: int, merchant: str, city: str, txid: str) -> str:
    account = _emv("00", "br.gov.bcb.pix") + _emv("01", key)
    payload = (
        _emv("00", "01")
        + _emv("26", account)
        + _emv("52", "0000")
        + _emv("53", "986")
        + _emv("54", f"{amount_cents / 100:.2f}")
        + _emv("58", "BR")
        + _emv("59", _ascii(merchant, 25))
        + _emv("60", _ascii(city, 15))
        + _emv("62", _emv("05", "".join(ch for ch in txid if ch.isalnum())[:25] or "***"))
        + "6304"
    )
    return payload + crc16(payload)
