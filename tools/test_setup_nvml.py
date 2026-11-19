"""setup.py's card reads when nvidia-smi cannot be started (GeForce NOW: "Access is denied"): the driver's NVML library answers instead.
No GPU needed: setup.out (the nvidia-smi call) and strata_control.nvidia_cards (the NVML reader) are given.

    python tools/test_setup_nvml.py
"""
from __future__ import annotations

import os
import sys
import unittest
from pathlib import Path
from unittest import mock

# the same isolation the tests that fake a broken nvidia-smi get (conftest.py under pytest): off unless a test switches it on
if not os.environ.get("STRATA_TEST_REAL_NVIDIA_SMI"):
    os.environ.setdefault("STRATA_NVML_CARDS", "0")

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import setup  # noqa: E402
from strata_control import nvidia_cards  # noqa: E402

FIELDS = "index,name,memory.total,compute_cap,driver_version".split(",")
CARD = "0, NVIDIA GeForce RTX 5080, 49152, 12.0, 621.14\n"
EXPECTED = [{"index": 0, "name": "NVIDIA GeForce RTX 5080", "vram_gb": 48.0, "arch": "120", "driver": "621.14"}]


class NvmlOn(unittest.TestCase):
    def setUp(self):
        patcher = mock.patch.dict(os.environ, {"STRATA_NVML_CARDS": "1"})
        patcher.start()
        self.addCleanup(patcher.stop)


class Gpus(NvmlOn):
    def test_nvidia_smi_that_says_nothing_hands_over_to_nvml(self):
        with mock.patch.object(setup, "out", return_value="") as out, mock.patch.object(nvidia_cards, "nvml_csv", return_value=CARD) as nvml:
            self.assertEqual(setup.gpus(), EXPECTED)
        out.assert_called_once()
        nvml.assert_called_once_with(FIELDS)

    def test_nvidia_smi_that_answers_never_reaches_nvml(self):
        with mock.patch.object(setup, "out", return_value="0, NVIDIA GeForce RTX 4070 SUPER, 12282, 8.9, 610.62\n"), \
                mock.patch.object(nvidia_cards, "nvml_csv", return_value=CARD) as nvml:
            self.assertEqual(setup.gpus(), [{"index": 0, "name": "NVIDIA GeForce RTX 4070 SUPER", "vram_gb": 12282 / 1024.0, "arch": "89", "driver": "610.62"}])
        nvml.assert_not_called()

    def test_nothing_from_either_is_no_card(self):
        with mock.patch.object(setup, "out", return_value=""), mock.patch.object(nvidia_cards, "nvml_csv", return_value=""):
            self.assertEqual(setup.gpus(), [])

    def test_the_off_switch_keeps_nvml_out(self):
        with mock.patch.dict(os.environ, {"STRATA_NVML_CARDS": "0"}), mock.patch.object(setup, "out", return_value=""), \
                mock.patch.object(nvidia_cards, "_load") as load:
            self.assertEqual(setup.gpus(), [])
        load.assert_not_called()

    def test_a_card_nvidia_smi_listed_badly_is_still_not_listed(self):
        with mock.patch.object(setup, "out", return_value="0, GTX, [N/A], 8.6, 551.1\n"), \
                mock.patch.object(setup, "is_arm64", return_value=False), mock.patch.object(nvidia_cards, "nvml_csv", return_value=CARD):
            self.assertEqual(setup.gpus(), EXPECTED, "no parsed row: NVML is asked, as for an empty answer")


class DisplayAndComputeMode(NvmlOn):
    def test_display_active(self):
        with mock.patch.object(setup, "out", return_value=""), mock.patch.object(nvidia_cards, "nvml_csv", return_value="Enabled\n") as nvml:
            self.assertTrue(setup.gpu_drives_display({"index": 1}))
        nvml.assert_called_once_with(["display_active"], index=1)
        with mock.patch.object(setup, "out", return_value=""), mock.patch.object(nvidia_cards, "nvml_csv", return_value="Disabled\n"):
            self.assertFalse(setup.gpu_drives_display({"index": 0}))
        with mock.patch.object(setup, "out", return_value="Disabled\n"), mock.patch.object(nvidia_cards, "nvml_csv", return_value="Enabled\n") as nvml:
            self.assertFalse(setup.gpu_drives_display({"index": 0}))
        nvml.assert_not_called()

    def test_compute_mode(self):
        with mock.patch.object(setup, "out", return_value=""), mock.patch.object(nvidia_cards, "nvml_csv", return_value="Exclusive_Process\n") as nvml:
            self.assertEqual(setup.gpu_compute_mode(2), "Exclusive_Process")
        nvml.assert_called_once_with(["compute_mode"], index=2)
        with mock.patch.object(setup, "out", return_value="Default\n"), mock.patch.object(nvidia_cards, "nvml_csv", return_value="Prohibited\n") as nvml:
            self.assertEqual(setup.gpu_compute_mode(0), "Default")
        nvml.assert_not_called()

    def test_the_off_switch(self):
        with mock.patch.dict(os.environ, {"STRATA_NVML_CARDS": "0"}), mock.patch.object(setup, "out", return_value=""), \
                mock.patch.object(nvidia_cards, "nvml_csv") as nvml:
            self.assertFalse(setup.gpu_drives_display({"index": 0}))
            self.assertEqual(setup.gpu_compute_mode(0), "")
        nvml.assert_not_called()


class Isolation(unittest.TestCase):
    def test_the_tests_run_with_nvml_off_unless_asked(self):
        if os.environ.get("STRATA_TEST_REAL_NVIDIA_SMI"):
            self.skipTest("STRATA_TEST_REAL_NVIDIA_SMI is set")
        self.assertEqual(os.environ.get("STRATA_NVML_CARDS"), "0")


if __name__ == "__main__":
    unittest.main()
