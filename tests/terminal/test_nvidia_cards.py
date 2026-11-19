"""NVIDIA cards read from the driver's NVML library when nvidia-smi cannot be started (GeForce NOW: "Access is denied").

No GPU and no driver needed: the NVML library is a fake object. conftest.py switches NVML off for the whole run (STRATA_NVML_CARDS=0), so every
test here that wants it on sets the variable itself.
"""

from __future__ import annotations

import ast
import contextlib
import ctypes
import io
import os
import subprocess
import sys
import threading
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "tools"))
from strata_control import doctor, engine_component as ec, nvidia_cards as nc, split_engine, tune_machine  # noqa: E402

DENIED = PermissionError(5, "Access is denied")
RTX_5080 = {"name": "NVIDIA GeForce RTX 5080", "uuid": "GPU-aaaa", "bus": b"00000000:01:00.0", "total": 49152, "free": 1234, "used": 47651,
            "cc": (12, 0), "display": 0, "mode": 0, "temp": 41, "util": 7, "fan": 30, "power": 35140, "limit": 220000,
            "gen": 4, "genmax": 5, "width": 16, "clock": 2505}


class FakeNvml:
    """The few NVML functions the reader calls, answering for `cards` (dicts like RTX_5080). `hide` names functions the library does not have,
    `fail` names functions that answer a non-zero code."""

    def __init__(self, cards=(RTX_5080,), hide=(), fail=(), driver="621.14", init=0):
        self.cards, self.hide, self.fail, self.driver, self.init = list(cards), set(hide), set(fail), driver, init
        self.called = []

    def __getattr__(self, name):
        if name.startswith("_") or name in self.hide or not name.startswith("nvml"):
            raise AttributeError(name)
        return lambda *args: self.answer(name, *args)

    def answer(self, name, *args):
        self.called.append(name)
        if name in self.fail:
            return 3
        if name in ("nvmlInit_v2", "nvmlInit"):
            return self.init
        if name == "nvmlShutdown":
            return 0
        if name in ("nvmlDeviceGetCount_v2", "nvmlDeviceGetCount"):
            args[0]._obj.value = len(self.cards)
            return 0
        if name == "nvmlSystemGetDriverVersion":
            args[0].value = self.driver.encode()
            return 0
        if name in ("nvmlDeviceGetHandleByIndex_v2", "nvmlDeviceGetHandleByIndex"):
            args[1]._obj.value = args[0].value + 1
            return 0
        card = self.cards[args[0].value - 1]
        ref = args[-1]._obj if hasattr(args[-1], "_obj") else None
        if name == "nvmlDeviceGetName":
            args[1].value = card["name"].encode()
        elif name == "nvmlDeviceGetUUID":
            args[1].value = card["uuid"].encode()
        elif name in ("nvmlDeviceGetPciInfo_v3", "nvmlDeviceGetPciInfo_v2"):
            ref.busId = card["bus"]
        elif name in ("nvmlDeviceGetMemoryInfo_v2", "nvmlDeviceGetMemoryInfo"):
            ref.total, ref.free, ref.used = (card[k] * 1024 * 1024 for k in ("total", "free", "used"))
            if name.endswith("_v2"):
                ref.reserved = 266 * 1024 * 1024
        elif name == "nvmlDeviceGetCudaComputeCapability":
            args[1]._obj.value, args[2]._obj.value = card["cc"]
        elif name == "nvmlDeviceGetUtilizationRates":
            ref.gpu, ref.memory = card["util"], 1
        else:
            key = {"nvmlDeviceGetDisplayActive": "display", "nvmlDeviceGetComputeMode": "mode", "nvmlDeviceGetTemperature": "temp",
                   "nvmlDeviceGetFanSpeed": "fan", "nvmlDeviceGetPowerUsage": "power", "nvmlDeviceGetEnforcedPowerLimit": "limit",
                   "nvmlDeviceGetCurrPcieLinkGeneration": "gen", "nvmlDeviceGetMaxPcieLinkGeneration": "genmax",
                   "nvmlDeviceGetCurrPcieLinkWidth": "width", "nvmlDeviceGetClockInfo": "clock"}[name]
            ref.value = card[key]
        return 0


def on(lib):
    """NVML switched on and the fake library loaded, for one `with`."""
    stack = contextlib.ExitStack()
    stack.enter_context(mock.patch.dict(os.environ, {"STRATA_NVML_CARDS": "1"}))
    stack.enter_context(mock.patch.object(nc, "_load", lambda: lib))
    stack.enter_context(mock.patch.object(nc, "_GAVE_UP", False))
    return stack


ALL = ["index", "name", "uuid", "pci.bus_id", "memory.total", "memory.used", "memory.free", "compute_cap", "driver_version", "display_active",
       "compute_mode", "temperature.gpu", "utilization.gpu", "fan.speed", "power.draw", "power.limit", "pcie.link.gen.current",
       "pcie.link.gen.max", "pcie.link.width.current", "clocks.current.graphics"]


class Reader(unittest.TestCase):
    def test_every_field_as_nvidia_smi_prints_it_without_units(self):
        with on(FakeNvml()):
            rows = nc.nvml_rows(ALL)
        self.assertEqual(rows, [["0", "NVIDIA GeForce RTX 5080", "GPU-aaaa", "00000000:01:00.0", "49152", "47651", "1234", "12.0", "621.14",
                                 "Disabled", "Default", "41", "7", "30", "35.14", "220.00", "4", "5", "16", "2505"]])

    def test_units_are_added_when_asked(self):
        with on(FakeNvml()):
            row = nc.nvml_rows(["memory.total", "power.draw", "utilization.gpu", "clocks.current.graphics", "temperature.gpu"], units=True)[0]
        self.assertEqual(row, ["49152 MiB", "35.14 W", "7 %", "2505 MHz", "41"])

    def test_display_and_compute_mode_words(self):
        cards = [dict(RTX_5080, display=1, mode=3), dict(RTX_5080, mode=2), dict(RTX_5080, mode=1)]
        with on(FakeNvml(cards)):
            rows = nc.nvml_rows(["index", "display_active", "compute_mode"])
        self.assertEqual(rows, [["0", "Enabled", "Exclusive_Process"], ["1", "Disabled", "Prohibited"], ["2", "Disabled", "Exclusive_Thread"]])

    def test_unknown_field_and_missing_or_failing_function_are_na(self):
        with on(FakeNvml(hide=["nvmlDeviceGetFanSpeed"], fail=["nvmlDeviceGetTemperature"])):
            self.assertEqual(nc.nvml_rows(["fan.speed", "temperature.gpu", "pstate", "name"]), [["[N/A]", "[N/A]", "[N/A]", "NVIDIA GeForce RTX 5080"]])

    def test_index_filter(self):
        cards = [dict(RTX_5080, name="A"), dict(RTX_5080, name="B")]
        with on(FakeNvml(cards)):
            self.assertEqual(nc.nvml_rows(["index", "name"], index=1), [["1", "B"]])
            self.assertEqual(nc.nvml_rows(["index"], index=5), [])
            self.assertEqual(nc.nvml_csv(["index", "name"]), "0, A\n1, B\n")

    def test_memory_prefers_the_v2_call_and_falls_back_to_the_old_one(self):
        lib = FakeNvml()
        with on(lib):
            nc.nvml_rows(["memory.free"])
        self.assertIn("nvmlDeviceGetMemoryInfo_v2", lib.called)
        self.assertNotIn("nvmlDeviceGetMemoryInfo", lib.called)
        lib = FakeNvml(hide=["nvmlDeviceGetMemoryInfo_v2"])
        with on(lib):
            self.assertEqual(nc.nvml_rows(["memory.total", "memory.free"]), [["49152", "1234"]])
        self.assertIn("nvmlDeviceGetMemoryInfo", lib.called)

    def test_no_library_or_a_failed_init_is_no_card(self):
        with on(None):
            self.assertEqual(nc.nvml_rows(["index"]), [])
            self.assertEqual(nc.nvml_csv(["index"]), "")
        with on(FakeNvml(init=9)):
            self.assertEqual(nc.nvml_rows(["index"]), [])

    def test_off_switch_never_loads_the_library(self):
        loader = mock.Mock(return_value=FakeNvml())
        with mock.patch.dict(os.environ, {"STRATA_NVML_CARDS": "0"}), mock.patch.object(nc, "_load", loader):
            self.assertFalse(nc.enabled())
            self.assertEqual(nc.nvml_rows(["index"]), [])
            self.assertEqual(nc.nvml_csv(["index"]), "")
            self.assertEqual(nc.main(["--query-gpu=index", "--format=csv,noheader"]), 1)
        loader.assert_not_called()

    def test_a_call_that_does_not_come_back_is_given_up_on(self):
        release = threading.Event()

        class Stuck(FakeNvml):
            def answer(self, name, *args):
                release.wait(10)
                return super().answer(name, *args)

        try:
            with on(Stuck()):
                self.assertEqual(nc.nvml_rows(["index"], timeout=0.2), [])
                self.assertFalse(nc.enabled(), "this process does not ask again")
                self.assertTrue(nc._GAVE_UP)
        finally:
            release.set()
            nc._GAVE_UP = False

    def test_the_file_imports_nothing_of_this_repository(self):
        tree = ast.parse((ROOT / "strata_control" / "nvidia_cards.py").read_text(encoding="utf-8"))
        names = {a.name.split(".")[0] for n in ast.walk(tree) if isinstance(n, ast.Import) for a in n.names}
        names |= {n.module.split(".")[0] for n in ast.walk(tree) if isinstance(n, ast.ImportFrom) and n.module and not n.level}
        self.assertFalse(any(isinstance(n, ast.ImportFrom) and n.level for n in ast.walk(tree)))
        self.assertLessEqual(names, set(sys.stdlib_module_names))


class Command(unittest.TestCase):
    def run_main(self, *argv):
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            code = nc.main(list(argv))
        return code, buf.getvalue()

    def test_prints_the_csv_nvidia_smi_prints(self):
        with on(FakeNvml()):
            self.assertEqual(self.run_main("--query-gpu=index,name,memory.total,compute_cap,driver_version", "--format=csv,noheader,nounits"),
                             (0, "0, NVIDIA GeForce RTX 5080, 49152, 12.0, 621.14\n"))
            self.assertEqual(self.run_main("--query-gpu=memory.total,display_active", "--format=csv,noheader"), (0, "49152 MiB, Disabled\n"))
            self.assertEqual(self.run_main("-i", "0", "--query-gpu=compute_mode", "--format=csv,noheader"), (0, "Default\n"))

    def test_without_noheader_a_first_line_of_field_names_with_units_in_brackets(self):
        # nvidia-smi --query-gpu=index,name,memory.total,power.draw,utilization.gpu,temperature.gpu --format=csv (RTX 4070 SUPER, same header with nounits)
        want = "index, name, memory.total [MiB], power.draw [W], utilization.gpu [%], temperature.gpu\n"
        fields = "--query-gpu=index,name,memory.total,power.draw,utilization.gpu,temperature.gpu"
        with on(FakeNvml()):
            code, text = self.run_main(fields, "--format=csv")
            self.assertEqual((code, text.splitlines()[0] + "\n", len(text.splitlines())), (0, want, 2))
            self.assertIn("49152 MiB", text)
            code, text = self.run_main(fields, "--format=csv,nounits")
            self.assertEqual((code, text.splitlines()[0] + "\n", text.splitlines()[1].split(", ")[2]), (0, want, "49152"))
            self.assertEqual(self.run_main(fields, "--format=csv,noheader,nounits")[1].count("\n"), 1)

    def test_what_it_does_not_know_prints_nothing_and_ends_with_1(self):
        with on(FakeNvml()):
            for argv in (["dmon", "-s", "u"], ["--query-gpu=index"], ["--query-gpu=index", "--format=json"], ["--format=csv,noheader"],
                         ["-i", "x", "--query-gpu=index", "--format=csv"], ["-i", "7", "--query-gpu=index", "--format=csv"]):
                self.assertEqual(self.run_main(*argv), (1, ""), argv)

    def test_as_a_module_from_a_shell(self):
        done = subprocess.run([sys.executable, "-m", "strata_control.nvidia_cards", "dmon"], cwd=str(ROOT), capture_output=True, text=True,
                              env={**os.environ, "STRATA_NVML_CARDS": "0"})
        self.assertEqual((done.returncode, done.stdout), (1, ""))


class CallSites(unittest.TestCase):
    """nvidia-smi cannot be started: the answer comes from NVML. nvidia-smi timing out is a stuck driver: NVML is not asked."""

    def setUp(self):
        stack = contextlib.ExitStack()
        self.addCleanup(stack.close)
        stack.enter_context(mock.patch.dict(os.environ, {"STRATA_NVML_CARDS": "1"}))
        self.rows = stack.enter_context(mock.patch.object(nc, "nvml_rows", return_value=[["610.62"]]))
        self.csv = stack.enter_context(mock.patch.object(nc, "nvml_csv", return_value="0, NVIDIA GeForce RTX 5080, 49152, 12.0, 1234\n"))
        ec._SMI_CACHE.clear()
        self.addCleanup(ec._SMI_CACHE.clear)

    def smi(self, **kw):
        return mock.patch("subprocess.run", **kw)

    def test_engine_component_smi_query(self):
        with mock.patch.object(ec.shutil, "which", return_value="nvidia-smi"), self.smi(side_effect=DENIED):
            self.assertEqual(ec._smi_query_now("driver_version"), ["610.62"])
        self.rows.assert_called_once_with(["driver_version"])
        self.rows.reset_mock()
        with mock.patch.object(ec.shutil, "which", return_value="nvidia-smi"), self.smi(side_effect=subprocess.TimeoutExpired("nvidia-smi", 8)):
            self.assertEqual(ec._smi_query_now("driver_version"), [])
        self.rows.assert_not_called()
        for done in (subprocess.CompletedProcess([], 1, "x\n", ""), subprocess.CompletedProcess([], 0, "", "")):
            with mock.patch.object(ec.shutil, "which", return_value="nvidia-smi"), self.smi(return_value=done):
                self.assertEqual(ec._smi_query_now("driver_version"), ["610.62"])
        with mock.patch.object(ec.shutil, "which", return_value=None):
            self.assertEqual(ec._smi_query_now("driver_version"), ["610.62"])
        self.rows.reset_mock()
        with mock.patch.object(ec.shutil, "which", return_value="nvidia-smi"), self.smi(return_value=subprocess.CompletedProcess([], 0, "595.1\n", "")):
            self.assertEqual(ec._smi_query_now("driver_version"), ["595.1"])
        self.rows.assert_not_called()

    def test_engine_component_cache_keeps_the_nvml_answer(self):
        with mock.patch.object(ec.shutil, "which", return_value="nvidia-smi"), self.smi(side_effect=DENIED) as run:
            self.assertEqual(ec._smi_query("driver_version"), ["610.62"])
            self.assertEqual(ec._smi_query("driver_version"), ["610.62"])
        self.assertEqual(run.call_count, 1)

    def test_split_engine_probe(self):
        with self.smi(side_effect=DENIED):
            cards = split_engine.probe_nvidia_cards()
        self.assertEqual([(c.index, c.name, c.vram_mib, c.cc, c.free_mib) for c in cards], [(0, "NVIDIA GeForce RTX 5080", 49152, 120, 1234)])
        self.csv.assert_called_once_with("index,name,memory.total,compute_cap,memory.free".split(","))
        self.csv.reset_mock()
        with self.smi(side_effect=subprocess.TimeoutExpired("nvidia-smi", 20)):
            self.assertEqual(split_engine.probe_nvidia_cards(), [])
        self.csv.assert_not_called()

    def test_split_engine_probe_asks_nvml_when_nvidia_smi_runs_but_says_nothing(self):
        for done in (subprocess.CompletedProcess([], 9, "0, X, 1, 8.0, 1\n", ""), subprocess.CompletedProcess([], 0, "", ""),
                     subprocess.CompletedProcess([], 0, "  \n", "")):
            self.csv.reset_mock()
            with self.smi(return_value=done):
                self.assertEqual([c.name for c in split_engine.probe_nvidia_cards()], ["NVIDIA GeForce RTX 5080"], done)
            self.csv.assert_called_once()
        self.csv.reset_mock()
        with self.smi(return_value=subprocess.CompletedProcess([], 0, "0, GTX 1070, 8192, 6.1, 7000\n", "")):
            self.assertEqual([c.name for c in split_engine.probe_nvidia_cards()], ["GTX 1070"])
        self.csv.assert_not_called()

    def test_doctor_probe(self):
        self.csv.return_value = "0, NVIDIA GeForce RTX 5080, GPU-aaaa, 49152, 621.14\n"
        with mock.patch.object(doctor.shutil, "which", return_value="nvidia-smi"), self.smi(side_effect=DENIED):
            cards, reason = doctor._nvidia_cards()
        self.assertIsNone(reason)
        self.assertEqual(cards, [{"index": 0, "name": "NVIDIA GeForce RTX 5080", "uuid": "GPU-aaaa", "memory_mib": 49152, "driver_version": "621.14"}])
        with mock.patch.object(doctor.shutil, "which", return_value=None):
            self.assertEqual(doctor._nvidia_cards()[0][0]["index"], 0)
        self.csv.reset_mock()
        with mock.patch.object(doctor.shutil, "which", return_value="nvidia-smi"), self.smi(side_effect=subprocess.TimeoutExpired("nvidia-smi", 5)):
            self.assertEqual(doctor._nvidia_cards(), (None, "nvidia-smi could not complete within five seconds"))
        self.csv.assert_not_called()

    def test_doctor_says_so_when_nvidia_smi_cannot_be_started_and_nvml_says_nothing(self):
        self.csv.return_value = ""
        with mock.patch.object(doctor.shutil, "which", return_value="nvidia-smi"), self.smi(side_effect=DENIED):
            self.assertEqual(doctor._nvidia_cards(), (None, "nvidia-smi could not be started"))
        with mock.patch.object(doctor.shutil, "which", return_value=None):
            self.assertEqual(doctor._nvidia_cards(), (None, "nvidia-smi is not installed or is not on PATH"))

    def test_tune_machine_gpus(self):
        self.csv.return_value = "0, NVIDIA GeForce RTX 5080, 49152, 47651, 621.14\n"
        with mock.patch.object(tune_machine.shutil, "which", return_value=None):
            found = [g for g in tune_machine.gpus() if g.get("vendor") == "nvidia"]
        self.assertEqual([(g["name"], g["vram_total_mib"], g["vram_used_mib"], g["driver"]) for g in found], [("NVIDIA GeForce RTX 5080", 49152, 47651, "621.14")])
        with mock.patch.object(tune_machine.shutil, "which", return_value="nvidia-smi"), mock.patch.object(tune_machine, "_run", return_value=None):
            self.assertEqual([g["index"] for g in tune_machine.gpus() if g.get("vendor") == "nvidia"], [0])

    def test_tune_machine_does_not_ask_nvml_when_nvidia_smi_answers(self):
        with mock.patch.object(tune_machine.shutil, "which", return_value="nvidia-smi"), \
                mock.patch.object(tune_machine, "_run", return_value="0, GTX, 100, 10, 1.0\n"):
            self.assertEqual([g["name"] for g in tune_machine.gpus() if g.get("vendor") == "nvidia"], ["GTX"])
        self.csv.assert_not_called()

    def test_strata_mcp_fallbacks(self):
        import strata_mcp as M
        self.csv.return_value = "0, NVIDIA GeForce RTX 5080, 49152, 12.0, 621.14\n"
        with mock.patch.object(M, "run_quiet", return_value=""):
            self.assertEqual(M.own_nvidia_gpus(), [{"index": 0, "name": "NVIDIA GeForce RTX 5080", "vram_gb": 48.0, "arch": "120", "driver": "621.14"}])
            self.csv.return_value = "0, Enabled\n1, Disabled\n"
            self.assertEqual(M.nvidia_display_active(), {0: True, 1: False})
        self.csv.reset_mock()
        with mock.patch.object(M, "run_quiet", return_value="0, GTX 1070, 8192, 6.1, 551.1\n"):
            self.assertEqual([g["name"] for g in M.own_nvidia_gpus()], ["GTX 1070"])
        with mock.patch.object(M, "run_quiet", return_value="0, Enabled\n"):
            self.assertEqual(M.nvidia_display_active(), {0: True})
        self.csv.assert_not_called()

    def test_strata_mcp_without_the_nvml_module_answers_as_before(self):
        import strata_mcp as M
        real = __import__

        def no_module(name, *args, **kw):
            if name == "strata_control" and args[2] and "nvidia_cards" in args[2]:
                raise ImportError("an older Control folder")
            return real(name, *args, **kw)

        with mock.patch.object(M, "run_quiet", return_value=""), mock.patch("builtins.__import__", no_module):
            self.assertEqual(M.own_nvidia_gpus(), [])
            self.assertEqual(M.nvidia_display_active(), {})
        self.csv.assert_not_called()

    def test_serve_arch_note_reads_the_cards_from_nvml(self):
        from serve import server
        self.csv.return_value = "0, 12.0\n"
        cfg = {"exe": "C:/engine/strata.exe"}
        built = {"archs": ["sm_89"]}
        with mock.patch.object(server, "gpu_list", return_value=[]), self.smi(side_effect=DENIED):
            note = server.engine_arch_note(cfg, built=built)
        self.assertIn("sm_120", note or "")
        self.csv.assert_called_once_with(["index", "compute_cap"])
        self.csv.reset_mock()
        with mock.patch.object(server, "gpu_list", return_value=[]), self.smi(side_effect=subprocess.TimeoutExpired("nvidia-smi", 10)):
            self.assertIsNone(server.engine_arch_note(cfg, built=built))
        self.csv.assert_not_called()


GFN_ADAPTERS = ([{"vendor": "1b36", "device": 0x0100, "name": "Red Hat QXL controller", "vram_gb": 0.06},
                 {"vendor": "1414", "device": 0x008C, "name": "Microsoft Basic Display Adapter", "vram_gb": 0.0},
                 {"vendor": "ffff", "device": 0x0001, "name": "VNC Mirror Driver", "vram_gb": 0.0}]
                + [{"vendor": "10de", "device": 0x2C00 + i, "name": f"NVIDIA GeForce RTX {n}", "vram_gb": float(2 + i)}
                   for i, n in enumerate(["5080", "4090", "4080", "3090", "3080", "2080", "1080", "1070", "1060", "980", "970", "960", "950"])])


class GeForceNowPc(unittest.TestCase):
    """The 16 display adapters GeForce NOW's registry lists (3 virtual ones and 13 NVIDIA driver entries of other cards, each with its own
    memory) and nvidia-smi that cannot be started: the engine is the CUDA one and the cards are the one NVML names."""

    def test_the_adapters_say_cuda_and_nvml_names_the_one_card(self):
        import setup
        self.assertEqual(len(GFN_ADAPTERS), 16)
        with on(FakeNvml()), mock.patch.object(ec, "host_platform", return_value="windows-x64"), \
                mock.patch.object(ec, "saved_backend", return_value=None), \
                mock.patch.object(ec, "_windows_display_adapters_registry", return_value=GFN_ADAPTERS), \
                mock.patch.object(ec, "_windows_adapters_cim", side_effect=AssertionError("PowerShell is not used")), \
                mock.patch.object(setup, "out", return_value=""):
            self.assertEqual(ec.detect_backend({}), ("cuda", "display adapters"))
            self.assertEqual(setup.gpus(), [{"index": 0, "name": "NVIDIA GeForce RTX 5080", "vram_gb": 48.0, "arch": "120", "driver": "621.14"}])

    def test_the_hardware_report_lists_that_card_only(self):
        import strata_mcp as M
        import setup
        s = M.Strata(ROOT)
        with on(FakeNvml()), mock.patch.object(M.sys, "platform", "win32"), mock.patch.object(M, "WIN", True), \
                mock.patch.object(ec, "host_platform", return_value="windows-x64"), mock.patch.object(ec, "saved_backend", return_value=None), \
                mock.patch.object(ec, "_windows_display_adapters_registry", return_value=GFN_ADAPTERS), \
                mock.patch.object(setup, "out", return_value=""), mock.patch.object(setup, "amd_gpus", lambda: []), \
                mock.patch("subprocess.run", side_effect=DENIED), mock.patch("subprocess.Popen", side_effect=DENIED), \
                mock.patch("strata_control.engine_component.status", lambda: {"usable": False}):
            hw = s._hardware()
        self.assertEqual([(g["vendor"], g["name"], g["vram_gb"], g["arch"], g["usable"]) for g in hw["gpus"]],
                         [("nvidia", "NVIDIA GeForce RTX 5080", 48.0, "120", True)])


if __name__ == "__main__":
    unittest.main()
