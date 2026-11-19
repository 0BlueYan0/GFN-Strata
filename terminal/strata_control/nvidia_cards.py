"""strata_control/nvidia_cards.py - NVIDIA cards read from the driver's own NVML library, for a PC where `nvidia-smi` cannot be started.

GeForce NOW does not let a program start nvidia-smi.exe (CreateProcess answers "Access is denied"), but the driver's nvml.dll answers
inside the process.  The callers ask nvidia-smi first and come here only when it gave no card, so a PC where nvidia-smi answers never
reaches this file.

    nvml_rows(fields)  -> [[str, ...], ...]   one row per card, the fields as `nvidia-smi --query-gpu=<fields> --format=csv,noheader,nounits`
    nvml_csv(fields)   -> str                 the same rows as that CSV text ("" when NVML cannot say)
    main(argv)         -> exit code           `python -m strata_control.nvidia_cards --query-gpu=... --format=csv,noheader,nounits [-i N]`

Nothing here raises: what cannot be read is "[N/A]" (a field) or [] / "" (no card).  STRATA_NVML_CARDS=0 turns the whole file off.
Standard library only, and no import of any other module of this repository.
"""
from __future__ import annotations
import sys
if sys.platform == "win32":
    # CPython 3.12's WMI helper (_wmi, behind platform.system() / uname()) takes an access violation in a worker thread when WMI refuses the
    # account (0x80041003) and the caller has already gone (DIAG-WINHOST-0216). Without _wmi, platform uses the registry and the environment.
    sys.modules["_wmi"] = None

import ctypes
import os
import threading

TIMEOUT_SECONDS = 5.0
NA = "[N/A]"
_GAVE_UP = False       # an NVML call that did not come back in time: this process does not ask again

_COMPUTE_MODES = {0: "Default", 1: "Exclusive_Thread", 2: "Prohibited", 3: "Exclusive_Process"}
# a field -> the unit nvidia-smi prints after the number without `nounits`
_UNITS = {"memory.total": " MiB", "memory.used": " MiB", "memory.free": " MiB", "power.draw": " W", "power.limit": " W",
          "utilization.gpu": " %", "fan.speed": " %", "clocks.current.graphics": " MHz"}


def enabled() -> bool:
    """False when STRATA_NVML_CARDS is 0 (the off switch, and the tests' isolation switch) or an NVML call has already hung."""
    return os.environ.get("STRATA_NVML_CARDS", "").strip() != "0" and not _GAVE_UP


class _PciInfo(ctypes.Structure):
    _fields_ = [("busIdLegacy", ctypes.c_char * 16), ("domain", ctypes.c_uint), ("bus", ctypes.c_uint), ("device", ctypes.c_uint),
                ("pciDeviceId", ctypes.c_uint), ("pciSubSystemId", ctypes.c_uint), ("busId", ctypes.c_char * 32)]


class _Memory(ctypes.Structure):
    _fields_ = [("total", ctypes.c_ulonglong), ("free", ctypes.c_ulonglong), ("used", ctypes.c_ulonglong)]


class _MemoryV2(ctypes.Structure):
    _fields_ = [("version", ctypes.c_uint), ("total", ctypes.c_ulonglong), ("reserved", ctypes.c_ulonglong),
                ("free", ctypes.c_ulonglong), ("used", ctypes.c_ulonglong)]


class _Util(ctypes.Structure):
    _fields_ = [("gpu", ctypes.c_uint), ("memory", ctypes.c_uint)]


def _load():
    """The NVML library, loaded as serve/telemetry.py loads it; None when there is none."""
    names = ["nvml.dll", os.path.join(os.environ.get("ProgramFiles", r"C:\Program Files"), "NVIDIA Corporation", "NVSMI", "nvml.dll")] \
        if os.name == "nt" else ["libnvidia-ml.so.1", "libnvidia-ml.so"]
    for name in names:
        try:
            return ctypes.CDLL(name)
        except OSError:
            continue
    return None


def _fn(lib, *names):
    for name in names:
        fn = getattr(lib, name, None)
        if fn is not None:
            return fn
    return None


def _call(lib, name, *args):
    """The NVML function `name` called with `args`; True when it answered 0 (success)."""
    fn = getattr(lib, name, None)
    if fn is None:
        return False
    try:
        return fn(*args) == 0
    except (OSError, ctypes.ArgumentError):
        return False


def _uint(lib, name, dev, *extra):
    v = ctypes.c_uint()
    return v.value if _call(lib, name, dev, *extra, ctypes.byref(v)) else None


def _memory(lib, dev):
    """(total, free, used) in bytes: nvmlDeviceGetMemoryInfo_v2 first (it counts the reserved part out of `free`, as nvidia-smi does), else the old call."""
    m2 = _MemoryV2()
    m2.version = ctypes.sizeof(_MemoryV2) | (2 << 24)
    if _call(lib, "nvmlDeviceGetMemoryInfo_v2", dev, ctypes.byref(m2)):
        return m2.total, m2.free, m2.used
    m = _Memory()
    if _call(lib, "nvmlDeviceGetMemoryInfo", dev, ctypes.byref(m)):
        return m.total, m.free, m.used
    return None


def _text(lib, name, dev, size=96):
    buf = ctypes.create_string_buffer(size)
    if _call(lib, name, dev, buf, ctypes.c_uint(size)):
        return buf.value.decode(errors="replace")
    return None


def _field(lib, dev, index, driver, field, mem):
    """One field of one card as nvidia-smi prints it with nounits; None when NVML cannot say."""
    if field == "index":
        return str(index)
    if field == "name":
        return _text(lib, "nvmlDeviceGetName", dev)
    if field == "uuid":
        return _text(lib, "nvmlDeviceGetUUID", dev)
    if field == "pci.bus_id":
        info = _PciInfo()
        if _call(lib, "nvmlDeviceGetPciInfo_v3", dev, ctypes.byref(info)) or _call(lib, "nvmlDeviceGetPciInfo_v2", dev, ctypes.byref(info)):
            return info.busId.decode(errors="replace")
        return None
    if field in ("memory.total", "memory.used", "memory.free"):
        if mem is None:
            return None
        nbytes = mem[0] if field.endswith("total") else mem[1] if field.endswith("free") else mem[2]
        return str(-(-nbytes // (1024 * 1024)))          # nvidia-smi rounds a part of a MiB up (RTX 4070 SUPER: used 3831.008 MiB is 3832, free 8165.992 is 8166)
    if field == "compute_cap":
        major, minor = ctypes.c_int(), ctypes.c_int()
        if _call(lib, "nvmlDeviceGetCudaComputeCapability", dev, ctypes.byref(major), ctypes.byref(minor)):
            return f"{major.value}.{minor.value}"
        return None
    if field == "driver_version":
        return driver
    if field == "display_active":
        v = _uint(lib, "nvmlDeviceGetDisplayActive", dev)
        return None if v is None else ("Enabled" if v else "Disabled")
    if field == "compute_mode":
        v = _uint(lib, "nvmlDeviceGetComputeMode", dev)
        return None if v is None else _COMPUTE_MODES.get(v)
    if field == "temperature.gpu":
        v = _uint(lib, "nvmlDeviceGetTemperature", dev, ctypes.c_uint(0))
        return None if v is None else str(v)
    if field == "utilization.gpu":
        u = _Util()
        return str(u.gpu) if _call(lib, "nvmlDeviceGetUtilizationRates", dev, ctypes.byref(u)) else None
    if field == "fan.speed":
        v = _uint(lib, "nvmlDeviceGetFanSpeed", dev)
        return None if v is None else str(v)
    if field in ("power.draw", "power.limit"):
        v = _uint(lib, "nvmlDeviceGetPowerUsage" if field == "power.draw" else "nvmlDeviceGetEnforcedPowerLimit", dev)
        return None if v is None else f"{v / 1000.0:.2f}"
    if field in ("pcie.link.gen.current", "pcie.link.gen.max", "pcie.link.width.current"):
        name = {"pcie.link.gen.current": "nvmlDeviceGetCurrPcieLinkGeneration", "pcie.link.gen.max": "nvmlDeviceGetMaxPcieLinkGeneration",
                "pcie.link.width.current": "nvmlDeviceGetCurrPcieLinkWidth"}[field]
        v = _uint(lib, name, dev)
        return None if v is None else str(v)
    if field == "clocks.current.graphics":
        v = _uint(lib, "nvmlDeviceGetClockInfo", dev, ctypes.c_uint(0))
        return None if v is None else str(v)
    return None


def _read(fields, index, units):
    """The rows, read in this thread (nvml_rows runs it in a daemon thread)."""
    lib = _load()
    if lib is None:
        return []
    init = _fn(lib, "nvmlInit_v2", "nvmlInit")
    if init is None:
        return []
    try:
        if init() != 0:
            return []
    except OSError:
        return []
    try:
        count = ctypes.c_uint()
        if not _call(lib, "nvmlDeviceGetCount_v2", ctypes.byref(count)) and not _call(lib, "nvmlDeviceGetCount", ctypes.byref(count)):
            return []
        driver = None
        buf = ctypes.create_string_buffer(80)
        if _call(lib, "nvmlSystemGetDriverVersion", buf, ctypes.c_uint(80)):
            driver = buf.value.decode(errors="replace")
        rows = []
        for i in range(count.value):
            if index is not None and i != index:
                continue
            dev = ctypes.c_void_p()
            if not _call(lib, "nvmlDeviceGetHandleByIndex_v2", ctypes.c_uint(i), ctypes.byref(dev)) \
                    and not _call(lib, "nvmlDeviceGetHandleByIndex", ctypes.c_uint(i), ctypes.byref(dev)):
                continue
            mem = _memory(lib, dev) if any(f in ("memory.total", "memory.used", "memory.free") for f in fields) else None
            row = []
            for field in fields:
                value = _field(lib, dev, i, driver, field, mem)
                row.append(NA if value is None else value + (_UNITS.get(field, "") if units else ""))
            rows.append(row)
        return rows
    except Exception:  # noqa: BLE001 - nothing here may stop the caller
        return []
    finally:
        shutdown = getattr(lib, "nvmlShutdown", None)
        if shutdown is not None:
            try:
                shutdown()
            except OSError:
                pass


def nvml_rows(fields, index=None, units=False, timeout=TIMEOUT_SECONDS):
    """One row of strings per card (all, or card `index`), the `fields` named as in `nvidia-smi --query-gpu`; [] when NVML cannot say.
    The NVML calls run in a daemon thread and are given `timeout` seconds: nvidia-smi times out on a stuck driver, a call inside this
    process would not, so a call that does not come back makes this process stop asking."""
    global _GAVE_UP
    if not enabled():
        return []
    fields = [str(f).strip() for f in fields]
    box: list = []

    def work():
        try:
            box.append(_read(fields, index, units))
        except Exception:  # noqa: BLE001
            box.append([])

    thread = threading.Thread(target=work, daemon=True)
    thread.start()
    thread.join(timeout)
    if thread.is_alive():
        _GAVE_UP = True
        return []
    return box[0] if box else []


def nvml_csv(fields, index=None, units=False) -> str:
    """The rows of nvml_rows as the text `nvidia-smi --format=csv,noheader[,nounits]` prints ("" when NVML cannot say)."""
    rows = nvml_rows(fields, index=index, units=units)
    return "".join(", ".join(row) + "\n" for row in rows)


def main(argv=None) -> int:
    """`--query-gpu=<fields> --format=csv,noheader[,nounits] [-i N]`; anything else prints nothing and ends with 1."""
    args = list(sys.argv[1:] if argv is None else argv)
    fields = None
    csv_seen = False                  # without --format=csv nvidia-smi prints a table, not rows: not something this reader writes
    units = True
    header_off = False
    index = None
    i = 0
    while i < len(args):
        arg = args[i]
        if arg.startswith("--query-gpu="):
            fields = [f.strip() for f in arg.partition("=")[2].split(",") if f.strip()]
        elif arg.startswith("--format="):
            parts = [p.strip() for p in arg.partition("=")[2].split(",")]
            if "csv" not in parts:
                return 1
            units = "nounits" not in parts
            header_off = "noheader" in parts
            csv_seen = True
        elif arg in ("-i", "--id") and i + 1 < len(args):
            i += 1
            try:
                index = int(args[i])
            except ValueError:
                return 1
        else:
            return 1
        i += 1
    if not fields or not csv_seen:
        return 1
    text = nvml_csv(fields, index=index, units=units)
    if not text:
        return 1
    if not header_off:        # nvidia-smi --format=csv: a first line of the field names, the unit in brackets (also with nounits)
        text = ", ".join(f + (f" [{_UNITS[f].strip()}]" if f in _UNITS else "") for f in fields) + "\n" + text
    sys.stdout.write(text)
    sys.stdout.flush()
    return 0


if __name__ == "__main__":
    sys.exit(main())
