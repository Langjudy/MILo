"""Progress protocol shared by webui tools (parsed by core/jobs.py)."""
import json
import sys


def P(stage, pct=None, state=None, detail=None):
    d = {"stage": stage}
    if pct is not None:
        d["pct"] = round(float(pct), 2)
    if state is not None:
        d["state"] = state
    if detail is not None:
        d["detail"] = detail
    print("@@P " + json.dumps(d, ensure_ascii=False), flush=True)


def M(**metrics):
    print("@@M " + json.dumps(metrics, ensure_ascii=False), flush=True)


def log(msg):
    print(msg, flush=True)


def fail(msg, code=1):
    print(f"Error: {msg}", flush=True)
    sys.exit(code)
