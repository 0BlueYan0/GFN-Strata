"""This build takes no Control or App update from the feed: a feed that offers a newer Control and a newer App says `not-in-feed` for both.
The engine and the drafter are decided as before.

    python -m pytest terminal/tests/terminal/test_self_update_off.py
"""
from __future__ import annotations

import inspect
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from strata_control import engine_component as ec, updater  # noqa: E402


def _feed():
    app = SimpleNamespace(version="9.9.9", notes="new", for_platform=lambda platform: {"size": 123, "url": "x", "signature": "y"})
    return SimpleNamespace(control=[SimpleNamespace(platform="linux-x86_64", version="9.9.9", size=123)], app=app)


def _ctx():
    return SimpleNamespace(hardware={"platform": "linux-x86_64"}, components=Path("."), app_version="0.2.15")


class SelfUpdateOff(unittest.TestCase):
    def test_the_switch_is_on_in_this_build(self):
        self.assertIs(updater.SELF_UPDATE_OFF, True)

    def _control(self):
        with mock.patch.object(updater, "active_control", return_value={"version": "0.1.60"}), mock.patch.object(ec, "runtime_version", return_value="0.1.60"):
            return updater.decide_control(_feed(), _ctx(), None)

    def test_a_newer_control_in_the_feed_is_not_offered(self):
        report = self._control()
        self.assertEqual((report["status"], report["offered"], report["download_bytes"]), ("not-in-feed", None, 0))
        self.assertEqual(report["installed"], "0.1.60")

    def test_a_newer_app_in_the_feed_is_not_offered(self):
        report = updater.decide_app(_feed(), _ctx())
        self.assertEqual((report["status"], report["offered"], report["download_bytes"]), ("not-in-feed", None, 0))
        self.assertEqual(report["installed"], "0.2.15")

    def test_with_the_switch_off_the_same_feed_is_offered(self):
        """The coverage of the update flows stays: the switch is the only difference."""
        with mock.patch.object(updater, "SELF_UPDATE_OFF", False), mock.patch.object(updater, "active_control", return_value={"version": "0.1.60"}), \
                mock.patch.object(ec, "runtime_version", return_value="0.1.60"):
            self.assertEqual(updater.decide_control(_feed(), _ctx(), None)["status"], "available")
            self.assertEqual(updater.decide_app(_feed(), _ctx())["status"], "available")

    def test_the_engine_decision_does_not_look_at_the_switch(self):
        self.assertNotIn("SELF_UPDATE_OFF", inspect.getsource(updater.decide_engine))
        self.assertNotIn("SELF_UPDATE_OFF", inspect.getsource(updater.check))


if __name__ == "__main__":
    unittest.main()
