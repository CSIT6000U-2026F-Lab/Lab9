# Lab 9 — Call Graph Analysis

In this lab, a new REST endpoint `GET /callgraph/{filename}` is already
implemented in `backend/rest_service.py`.
+ It receives a Python file name, reads the file, and calls
  `callgraph.build_call_graph()`.
+ Based on the results, the frontend draws an SVG call graph.

Your task is to implement the call graph (`callgraph.build_call_graph()`)
using a Python static analysis framework **PyFlow**.


## 1. Setup

```bash
pip install -r requirements.txt
```

In this lab, a new package `pyflow-analysis` will be used (import name: `pyflow`).


## 2. Start

```bash
python3 backend/rest_service.py
python3 frontend/serve.py
```

Open http://127.0.0.1:5500/, select a `.py` file, click **Call graph**.

If a port is busy:

```bash
lsof -tiTCP:8000,5500 -sTCP:LISTEN | xargs kill
```


## 3. TODO

Implement `build_call_graph()` in `backend/callgraph.py`.
+ The input is the file content (a string).
+ The output is a list of call-graph edges.
  - Each edge is a `(caller, callee)` pair.
  - Sort the list by `caller`, then by `callee`.

You do not need to implement a new call-graph algorithm for Python.
`pyflow-analysis` already contains call-graph algorithms that we can reuse.

However, there are two issues that you need to resolve:
+ First, PyFlow has several implementations. Some algorithms are not powerful
  enough to pass all test cases (see section 5). You need to choose the right one.
+ Second, PyFlow's result format may not match our specification (see section 4).
  Adjust node names and keep only the required edges.


## 4. Call Graph Specification

In a call graph:
+ a node refers to a function (or method)
+ an edge refers to a call relation between two functions
  - For an edge `(u, v)`: `u` is the caller, `v` is the callee
  - as long as a caller `u` **MAY** call the callee `v`, there is an edge `(u, v)`

### 4.1. Nodes

There are 3 rules regarding the names of nodes:
+ For a function, the node name is the same as the function name (e.g. `foo`).
+ For a method, the node name is `{class_name}.{method_name}` (e.g. `Greeter.say`).
+ The top-level module itself is also a node; its name is fixed as `<module>`.

### 4.2. Edges

Keep an edge `(u, v)` only if `u` is **reachable** from `<module>`.
+ That is, there is a path `<module> → … → u` along call edges.
+ Unreachable functions and isolated class nodes are dropped.


## 5. Tests

You can use the following test script to evaluate your implementation:
```bash
python3 test_callgraph.py
```

It uses five programs in `data/test{1-5}.py` as test cases.
+ Each case is compared against a full expected edge list.


## 6. Layout

```
Lab9/
├── frontend/              # Call graph button + SVG panel
├── backend/
│   ├── data_logic.py
│   ├── rest_service.py    # Backend interfaces (provided)
│   └── callgraph.py       # Implement build_call_graph here
├── data/
│   ├── test1.py … test5.py  # Test cases
│   ├── main.py
│   └── utils.js
├── test_callgraph.py        # Test script
└── requirements.txt
```
