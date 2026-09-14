#!/usr/bin/env python3
"""Unit tests for tools/opencode-adapter.py model listing (stdlib only).

Run:  python tools/test_opencode_adapter.py
"""

import importlib.util
import os
import sys
import unittest

_ADAPTER_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                             "opencode-adapter.py")


def _load_adapter():
    spec = importlib.util.spec_from_file_location("opencode_adapter", _ADAPTER_PATH)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


class ListAllModelsTests(unittest.TestCase):
    def setUp(self):
        self.adapter = _load_adapter()

    def test_enumerates_all_provider_models(self):
        self.adapter._req = lambda *a, **k: {
            "providers": [
                {"id": "opencode", "models": {"big-pickle": {}, "other": {}}},
                {"id": "openai", "models": {"gpt-x": {}}},
                {"id": "empty", "models": {}},
            ],
            "default": {"opencode": "big-pickle"},
        }
        models = self.adapter.list_all_models()
        ids = [m["id"] for m in models]
        self.assertIn("opencode/big-pickle", ids)
        self.assertIn("opencode/other", ids)
        self.assertIn("openai/gpt-x", ids)
        self.assertIn("default", ids)  # back-compat alias
        self.assertEqual(len(ids), len(set(ids)))  # no dupes
        for m in models:
            self.assertEqual(m["object"], "model")
            self.assertIn("owned_by", m)

    def test_dedupes_and_skips_bad_entries(self):
        self.adapter._req = lambda *a, **k: {
            "providers": [
                {"id": "p", "models": {"a": {}, "a": {}}},
                {"id": "", "models": {"x": {}}},
                {"id": "q", "models": ["m1", "", None, "m1"]},
                "not-a-dict",
            ],
        }
        models = self.adapter.list_all_models()
        ids = [m["id"] for m in models]
        self.assertIn("p/a", ids)
        self.assertIn("q/m1", ids)
        self.assertEqual(len(ids), len(set(ids)))

    def test_raises_when_nothing_found(self):
        self.adapter._req = lambda *a, **k: {"providers": []}
        with self.assertRaises(RuntimeError):
            self.adapter.list_all_models()
        self.adapter._req = lambda *a, **k: (_ for _ in ()).throw(
            ConnectionError("down"))
        with self.assertRaises(Exception):
            self.adapter.list_all_models()

    def test_default_fallback_shape(self):
        # Simulate opencode unreachable: get_default_model falls back to env.
        self.adapter._req = lambda *a, **k: (_ for _ in ()).throw(
            ConnectionError("down"))
        os.environ["OPENCODE_PROVIDER"] = "opencode"
        os.environ["OPENCODE_MODEL"] = "big-pickle"
        try:
            pid, mid = self.adapter.get_default_model()
        finally:
            os.environ.pop("OPENCODE_PROVIDER", None)
            os.environ.pop("OPENCODE_MODEL", None)
        fallback = [
            {"id": f"{pid}/{mid}", "object": "model", "owned_by": "opencode"},
            {"id": "default", "object": "model", "owned_by": "opencode"},
        ]
        self.assertEqual(fallback[0]["id"], "opencode/big-pickle")
        self.assertEqual(fallback[1]["id"], "default")


class ResolveModelRefTests(unittest.TestCase):
    """Root-cause regression: `default` ignored the stored string while explicit
    IDs were forwarded verbatim (no trim), so copy-pasted whitespace failed
    with an opencode 500 and bare IDs were silently replaced by the default."""

    def setUp(self):
        self.adapter = _load_adapter()
        # Pin the default so no network is needed.
        self.adapter.get_default_model = lambda: ("opencode", "big-pickle")

    def test_default_and_empty_resolve_to_default(self):
        self.assertEqual(self.adapter.resolve_model_ref("default"), ("opencode", "big-pickle"))
        self.assertEqual(self.adapter.resolve_model_ref(""), ("opencode", "big-pickle"))
        self.assertEqual(self.adapter.resolve_model_ref(None), ("opencode", "big-pickle"))
        self.assertEqual(self.adapter.resolve_model_ref("   "), ("opencode", "big-pickle"))

    def test_explicit_id_verbatim(self):
        self.assertEqual(
            self.adapter.resolve_model_ref("opencode/muse-spark-1.3-contributor-free"),
            ("opencode", "muse-spark-1.3-contributor-free"),
        )

    def test_whitespace_is_stripped(self):
        self.assertEqual(
            self.adapter.resolve_model_ref("  opencode/muse-spark-1.3-contributor-free  "),
            ("opencode", "muse-spark-1.3-contributor-free"),
        )
        self.assertEqual(
            self.adapter.resolve_model_ref("opencode / muse-spark-1.3-contributor-free"),
            ("opencode", "muse-spark-1.3-contributor-free"),
        )

    def test_bare_id_uses_default_provider(self):
        self.assertEqual(
            self.adapter.resolve_model_ref("muse-spark-1.3-contributor-free"),
            ("opencode", "muse-spark-1.3-contributor-free"),
        )

    def test_multi_slash_keeps_rest_as_model(self):
        self.assertEqual(
            self.adapter.resolve_model_ref("openrouter/qwen/qwen3-32b"),
            ("openrouter", "qwen/qwen3-32b"),
        )

    def test_dangling_slash_falls_back_to_default(self):
        self.assertEqual(self.adapter.resolve_model_ref("opencode/"), ("opencode", "big-pickle"))
        self.assertEqual(self.adapter.resolve_model_ref("/muse"), ("opencode", "big-pickle"))


if __name__ == "__main__":
    unittest.main(verbosity=2)
