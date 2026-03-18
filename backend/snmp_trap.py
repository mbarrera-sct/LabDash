"""Minimal SNMP trap receiver — UDP port 162 (requires root/CAP_NET_BIND_SERVICE or port >1024)."""
import asyncio
import struct
import time
import os

import db

TRAP_PORT = int(os.environ.get("SNMP_TRAP_PORT", "1620"))  # default 1620 to avoid needing root


def _decode_oid(data: bytes, offset: int) -> tuple[str, int]:
    """Decode a BER-encoded OID, return (oid_string, new_offset)."""
    length = data[offset]; offset += 1
    end = offset + length
    parts = []
    first = True
    while offset < end:
        value = 0
        while True:
            b = data[offset]; offset += 1
            value = (value << 7) | (b & 0x7F)
            if not (b & 0x80):
                break
        if first:
            parts.extend(divmod(value, 40))
            first = False
        else:
            parts.append(value)
    return ".".join(str(p) for p in parts), offset


def _decode_value(data: bytes, offset: int) -> tuple[str, int]:
    """Decode a BER TLV value to string."""
    try:
        tag = data[offset]; offset += 1
        # Parse length (short or long form)
        length_byte = data[offset]; offset += 1
        if length_byte & 0x80:
            num_bytes = length_byte & 0x7F
            length = int.from_bytes(data[offset:offset + num_bytes], 'big')
            offset += num_bytes
        else:
            length = length_byte
        value_bytes = data[offset:offset + length]
        offset += length
        # INTEGER (0x02), COUNTER (0x41), GAUGE (0x42), TIMETICKS (0x43)
        if tag in (0x02, 0x41, 0x42, 0x43):
            val = int.from_bytes(value_bytes, 'big')
            return str(val), offset
        # OCTET STRING (0x04)
        if tag == 0x04:
            try:
                return value_bytes.decode('utf-8', errors='replace'), offset
            except Exception:
                return value_bytes.hex(), offset
        # OID (0x06)
        if tag == 0x06:
            oid, _ = _decode_oid(value_bytes, 0)
            return f"OID:{oid}", offset
        # IP ADDRESS (0x40)
        if tag == 0x40 and len(value_bytes) == 4:
            return ".".join(str(b) for b in value_bytes), offset
        # NULL
        if tag == 0x05:
            return "null", offset
        return f"0x{value_bytes.hex()}", offset
    except Exception:
        return "(parse error)", offset


def _parse_snmp_v2c_trap(data: bytes, addr: str) -> dict | None:
    """Very lightweight SNMPv2c trap parser — extracts community + varbind OID→value pairs."""
    try:
        offset = 0
        # SEQUENCE
        if data[offset] != 0x30:
            return None
        offset += 1
        # Skip outer length
        if data[offset] & 0x80:
            offset += 1 + (data[offset] & 0x7F)
        else:
            offset += 1

        # Version INTEGER
        if data[offset] != 0x02:
            return None
        offset += 1
        vlen = data[offset]; offset += 1
        version = int.from_bytes(data[offset:offset + vlen], 'big')
        offset += vlen

        # Community OCTET STRING
        if data[offset] != 0x04:
            return None
        offset += 1
        clen = data[offset]; offset += 1
        community = data[offset:offset + clen].decode('ascii', errors='replace')
        offset += clen

        # PDU type (0xA7 = SNMPv2-Trap, 0xA4 = Trap-v1)
        pdu_type = data[offset]; offset += 1
        if pdu_type & 0x80:
            offset += 1 + (data[offset] & 0x7F)
        else:
            offset += 1

        varbinds: dict[str, str] = {}

        if version == 0:
            # SNMPv1 trap — skip enterprise, agent-addr, generic-trap, specific-trap, time-stamp
            return {
                "version": "v1",
                "community": community,
                "source": addr,
                "varbinds": {},
                "summary": f"SNMPv1 trap from {addr} community={community}",
            }

        # Skip request-id, error-status, error-index
        for _ in range(3):
            if data[offset] != 0x02:
                break
            offset += 1
            flen = data[offset]; offset += 1
            offset += flen

        # VarBindList SEQUENCE
        if data[offset] == 0x30:
            offset += 1
            if data[offset] & 0x80:
                offset += 1 + (data[offset] & 0x7F)
            else:
                offset += 1
            while offset < len(data) - 2:
                if data[offset] != 0x30:
                    break
                offset += 1
                if data[offset] & 0x80:
                    offset += 1 + (data[offset] & 0x7F)
                else:
                    offset += 1
                # OID
                if data[offset] != 0x06:
                    break
                offset += 1
                oid, offset = _decode_oid(data, offset)
                val, offset = _decode_value(data, offset)
                varbinds[oid] = val

        # sysUpTime and snmpTrapOID are the first two varbinds in v2 traps
        trap_oid = varbinds.get("1.3.6.1.6.3.1.1.4.1.0", "").removeprefix("OID:")
        sysuptime = varbinds.get("1.3.6.1.2.1.1.3.0", "")

        summary = f"SNMPv2c trap from {addr} [{community}]: {trap_oid or 'unknown'}"
        if sysuptime:
            summary += f" uptime={sysuptime}"

        return {
            "version": "v2c",
            "community": community,
            "source": addr,
            "trap_oid": trap_oid,
            "varbinds": varbinds,
            "summary": summary,
        }
    except Exception as e:
        return {
            "version": "unknown",
            "source": addr,
            "summary": f"SNMP trap from {addr} (parse error: {e})",
            "varbinds": {},
        }


class _SnmpTrapProtocol(asyncio.DatagramProtocol):
    def __init__(self):
        self._loop = asyncio.get_event_loop()

    def datagram_received(self, data: bytes, addr: tuple):
        host = addr[0]
        parsed = _parse_snmp_v2c_trap(data, host)
        if parsed:
            asyncio.ensure_future(
                db.insert_event(
                    int(time.time()), "info", "snmp_trap",
                    parsed["summary"][:500]
                )
            )


async def run():
    """Start UDP SNMP trap listener. Skips silently if port is unavailable."""
    loop = asyncio.get_event_loop()
    try:
        await loop.create_datagram_endpoint(
            _SnmpTrapProtocol,
            local_addr=("0.0.0.0", TRAP_PORT),
        )
        print(f"[snmp_trap] Listening on UDP :{TRAP_PORT}")
    except PermissionError:
        print(f"[snmp_trap] Permission denied on UDP {TRAP_PORT} — trap receiver disabled")
    except OSError as e:
        print(f"[snmp_trap] Cannot bind UDP {TRAP_PORT}: {e} — trap receiver disabled")
