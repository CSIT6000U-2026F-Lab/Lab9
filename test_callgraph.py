#!/usr/bin/env python3
"""Call-graph tests. Run from Lab9: python3 test_callgraph.py

Each case lives in data/test{1-5}.py. The expected edge list is compared
with build_call_graph() and with GET /callgraph/{filename}.
"""

import os
import sys
import unittest

_ROOT = os.path.dirname(os.path.abspath(__file__))
_BACKEND = os.path.join(_ROOT, "backend")
_DATA = os.path.join(_ROOT, "data")
sys.path.insert(0, _BACKEND)

from callgraph import build_call_graph  # noqa: E402
from rest_service import app  # noqa: E402

from fastapi.testclient import TestClient  # noqa: E402


# test1.py — direct calls only
TEST1_EDGES = [
    ("<module>", "run"),
    ("greet", "hello"),
    ("hello", "format_message"),
    ("run", "greet"),
]

# test2.py — function assignment / aliases
TEST2_EDGES = [
    ("<module>", "start"),
    ("apply", "foo"),
    ("bar", "foo"),
    ("start", "apply"),
    ("start", "bar"),
]

# test3.py — virtual method calls
TEST3_EDGES = [
    ("<module>", "start"),
    ("say", "Cat.speak"),
    ("say", "Dog.speak"),
    ("start", "say"),
]

# test4.py — direct + assignment + virtual
TEST4_EDGES = [
    ("<module>", "start"),
    ("Greeter.say", "greet"),
    ("LoudGreeter.say", "log"),
    ("greet", "log"),
    ("speak", "Greeter.say"),
    ("speak", "LoudGreeter.say"),
    ("start", "greet"),
    ("start", "speak"),
]

# test5.py — direct + assignment + virtual (larger)
TEST5_EDGES = [
    ("<module>", "start"),
    ("Encoder.encode", "ident"),
    ("UpperEncoder.encode", "add1"),
    ("WrapEncoder.encode", "ident"),
    ("add1", "ident"),
    ("apply", "add1"),
    ("run_encoder", "Encoder.encode"),
    ("run_encoder", "UpperEncoder.encode"),
    ("run_encoder", "WrapEncoder.encode"),
    ("start", "apply"),
    ("start", "run_encoder"),
]


def load_case(name):
    path = os.path.join(_DATA, name)
    with open(path, encoding="utf-8") as handle:
        return handle.read()


class TestCallGraph(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(app)

    def _check(self, filename, expected):
        source = load_case(filename)
        self.assertEqual(build_call_graph(source), expected)
        response = self.client.get(f"/callgraph/{filename}")
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(set(body.keys()), {"edges"})
        self.assertEqual([tuple(edge) for edge in body["edges"]], expected)

    def test_1_direct_calls(self):
        self._check("test1.py", TEST1_EDGES)

    def test_2_assignment(self):
        self._check("test2.py", TEST2_EDGES)

    def test_3_virtual_calls(self):
        self._check("test3.py", TEST3_EDGES)

    def test_4_mixed(self):
        self._check("test4.py", TEST4_EDGES)

    def test_5_mixed_larger(self):
        self._check("test5.py", TEST5_EDGES)


if __name__ == "__main__":
    unittest.main(verbosity=2)
