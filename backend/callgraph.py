"""
Lab 9 — call graph of one Python source file via PyFlow.
"""

from typing import List, Tuple

import pyflow

CallEdge = Tuple[str, str]


class CallGraphError(Exception):
    def __init__(self, message: str = "Call graph analysis failed") -> None:
        super().__init__(message)


def build_call_graph(source: str) -> List[CallEdge]:
    """TODO: returns list of call graph edges.
    Each element is a caller-callee edge.
    """
    raise NotImplementedError
