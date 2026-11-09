"""Background job queue with live progress parsing.

Every GPU-heavy action (data preparation, training, export) is a Job made of one or
more subprocess Steps. Jobs run one at a time (single GPU). Each output line from
a subprocess is fed to the step's handler, which updates the job's stages/metrics.
Progress sources:
  * tqdm bars printed by MILo scripts (parsed generically)
  * "@@P {json}" / "@@M {json}" lines printed by our own tools in webui/tools
"""
import json
import os
import queue
import re
import subprocess
import threading
import time
import traceback
from collections import deque

ANSI_RE = re.compile(r"\x1b\[[0-9;]*[A-Za-z]")
TQDM_RE = re.compile(
    r"^(?P<desc>.*?):?\s*(?P<pct>\d{1,3})%\|.*?\|\s*(?P<n>\d+)/(?P<total>\d+)\s*"
    r"\[(?P<elapsed>[^<\]]*)<(?P<eta>[^,\]]*)(?:,\s*(?P<rate>[^,\]]*))?(?:,\s*(?P<post>.*?))?\]?\s*$"
)
KV_RE = re.compile(r"([A-Za-z_]+)=([-+0-9.eE]+)")


def parse_tqdm(line: str):
    m = TQDM_RE.match(line)
    if not m:
        return None
    d = m.groupdict()
    post = {}
    for k, v in KV_RE.findall(d.get("post") or ""):
        try:
            post[k] = float(v)
        except ValueError:
            pass
    return {
        "desc": d["desc"].strip(),
        "n": int(d["n"]),
        "total": max(int(d["total"]), 1),
        "elapsed": (d["elapsed"] or "").strip(),
        "eta": (d["eta"] or "").strip(),
        "rate": (d["rate"] or "").strip(),
        "post": post,
    }


class Stage(dict):
    def __init__(self, key, label, weight=1.0):
        super().__init__(key=key, label=label, pct=0.0, state="pending", detail="", weight=weight)


class Step:
    def __init__(self, cmd, cwd, handler=None, label="", env=None):
        self.cmd = cmd
        self.cwd = cwd
        self.handler = handler  # fn(job, line, tqdm_or_None)
        self.label = label
        self.env = env or {}


class Job:
    def __init__(self, kind, title, project, ref, stages, steps, on_finish=None, on_start=None):
        self.id = f"j{int(time.time() * 1000)}"
        self.kind = kind
        self.title = title
        self.project = project
        self.ref = ref
        self.stages = stages
        self.steps = steps
        self.on_finish = on_finish
        self.on_start = on_start
        self.status = "queued"
        self.error = ""
        self.metrics = {}
        self.series = {}  # name -> list of [x, y]
        self.created = time.time()
        self.started = None
        self.finished = None
        self.log = deque(maxlen=3000)
        self.log_base = 0  # index of log[0] in the full log stream
        self._last_tqdm_desc = None
        self.proc = None
        self.cancel_requested = False
        self.log_path = None
        self._log_file = None
        self.lock = threading.RLock()

    # -- helpers used by handlers
    def stage(self, key):
        for s in self.stages:
            if s["key"] == key:
                return s
        return None

    def set_stage(self, key, pct=None, state=None, detail=None):
        with self.lock:
            s = self.stage(key)
            if s is None:
                return
            if state == "running":
                # everything before this stage is done
                for other in self.stages:
                    if other is s:
                        break
                    if other["state"] in ("pending", "running"):
                        other["state"] = "done"
                        other["pct"] = 100.0
            if pct is not None:
                s["pct"] = max(0.0, min(100.0, float(pct)))
            if state is not None:
                s["state"] = state
                if state == "done":
                    s["pct"] = 100.0
            if detail is not None:
                s["detail"] = detail

    def push_series(self, name, x, y, max_points=600):
        arr = self.series.setdefault(name, [])
        if arr and arr[-1][0] == x:
            return
        arr.append([x, y])
        if len(arr) > max_points:
            # thin out older half
            self.series[name] = arr[: len(arr) // 2 : 2] + arr[len(arr) // 2 :]

    def add_log(self, line, tq=None):
        with self.lock:
            if tq is not None and self._last_tqdm_desc == tq["desc"] and self.log:
                self.log[-1] = line  # collapse in-place tqdm refreshes
            else:
                if len(self.log) == self.log.maxlen:
                    self.log_base += 1
                self.log.append(line)
            self._last_tqdm_desc = tq["desc"] if tq else None
        if self._log_file and tq is None:
            try:
                self._log_file.write(line + "\n")
            except Exception:
                pass

    def overall(self):
        tw = sum(s["weight"] for s in self.stages) or 1
        return round(sum(s["weight"] * s["pct"] for s in self.stages) / tw, 2)

    def to_dict(self, since=None):
        with self.lock:
            d = {
                "id": self.id,
                "kind": self.kind,
                "title": self.title,
                "project": self.project,
                "ref": self.ref,
                "status": self.status,
                "error": self.error,
                "stages": [dict(s) for s in self.stages],
                "overall": self.overall(),
                "metrics": dict(self.metrics),
                "created": self.created,
                "started": self.started,
                "finished": self.finished,
                "log_end": self.log_base + len(self.log),
            }
            if since is not None:
                start = max(int(since), self.log_base)
                lines = list(self.log)[start - self.log_base :]
                # the last line may be a live tqdm line that changes in place: always resend it
                d["log_start"] = start
                d["log"] = lines
                d["series"] = self.series
            return d


def kill_tree(pid: int):
    subprocess.run(["taskkill", "/T", "/F", "/PID", str(pid)], capture_output=True)


class JobManager:
    def __init__(self):
        self.jobs = {}
        self.order = []
        self.q = queue.Queue()
        self.current = None
        threading.Thread(target=self._worker, daemon=True).start()

    def submit(self, job: Job, log_path=None):
        job.log_path = log_path
        self.jobs[job.id] = job
        self.order.append(job.id)
        self.q.put(job.id)
        return job

    def get(self, jid):
        return self.jobs.get(jid)

    def list(self):
        return [self.jobs[j].to_dict() for j in reversed(self.order)]

    def active_for(self, kind, ref):
        for jid in reversed(self.order):
            j = self.jobs[jid]
            if j.kind == kind and j.ref == ref and j.status in ("queued", "running"):
                return j
        return None

    def cancel(self, jid):
        job = self.jobs.get(jid)
        if not job:
            return False
        job.cancel_requested = True
        if job.status == "queued":
            job.status = "canceled"
            job.finished = time.time()
            self._finish(job, False)
        elif job.proc and job.proc.poll() is None:
            kill_tree(job.proc.pid)
        return True

    def shutdown(self):
        for j in self.jobs.values():
            if j.proc and j.proc.poll() is None:
                kill_tree(j.proc.pid)

    # -- internals
    def _finish(self, job, ok):
        if job.on_finish:
            try:
                job.on_finish(job, ok)
            except Exception:
                traceback.print_exc()
        if job._log_file:
            job._log_file.close()
            job._log_file = None

    def _worker(self):
        while True:
            jid = self.q.get()
            job = self.jobs.get(jid)
            if job is None or job.status != "queued":
                continue
            self.current = job
            job.status = "running"
            job.started = time.time()
            if job.log_path:
                os.makedirs(os.path.dirname(job.log_path), exist_ok=True)
                job._log_file = open(job.log_path, "a", encoding="utf-8", buffering=1)
            ok = True
            try:
                if job.on_start:
                    job.on_start(job)
                for step in job.steps:
                    if job.cancel_requested:
                        ok = False
                        break
                    if not self._run_step(job, step):
                        ok = False
                        break
            except Exception as e:  # noqa: BLE001
                ok = False
                job.error = job.error or f"{type(e).__name__}: {e}"
                job.add_log(traceback.format_exc())
            job.finished = time.time()
            if job.cancel_requested:
                job.status = "canceled"
                job.error = "已取消"
            else:
                job.status = "done" if ok else "failed"
            if ok and not job.cancel_requested:
                for s in job.stages:
                    s["state"], s["pct"] = "done", 100.0
            else:
                for s in job.stages:
                    if s["state"] == "running":
                        s["state"] = "failed" if not job.cancel_requested else "canceled"
            self._finish(job, ok and not job.cancel_requested)
            self.current = None

    def _run_step(self, job, step):
        env = os.environ.copy()
        env.update({"PYTHONUNBUFFERED": "1", "PYTHONIOENCODING": "utf-8", "PYTHONUTF8": "1"})
        env.update(step.env)
        job.add_log(f"$ {' '.join(str(c) for c in step.cmd)}")
        job.proc = subprocess.Popen(
            [str(c) for c in step.cmd],
            cwd=step.cwd,
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            stdin=subprocess.DEVNULL,
            bufsize=0,
        )
        buf = b""
        tail = deque(maxlen=40)
        stream = job.proc.stdout
        while True:
            chunk = stream.read1(65536) if hasattr(stream, "read1") else stream.read(4096)
            if not chunk:
                break
            buf += chunk
            parts = re.split(rb"[\r\n]", buf)
            buf = parts.pop()
            for raw in parts:
                self._handle_line(job, step, raw, tail)
        if buf:
            self._handle_line(job, step, buf, tail)
        code = job.proc.wait()
        if code != 0 and not job.cancel_requested:
            last = [l for l in tail if l.strip()]
            hint = ""
            for l in reversed(last):
                if "Error" in l or "error" in l or "Exception" in l:
                    hint = l.strip()
                    break
            job.error = f"{step.label or '步骤'}失败（退出码 {code}）" + (f"：{hint}" if hint else "")
            return False
        return code == 0

    def _handle_line(self, job, step, raw, tail):
        try:
            line = raw.decode("utf-8")
        except UnicodeDecodeError:
            line = raw.decode("gbk", errors="replace")
        line = ANSI_RE.sub("", line).rstrip()
        if not line.strip():
            return
        if line.startswith("@@P "):
            try:
                p = json.loads(line[4:])
                job.set_stage(p["stage"], pct=p.get("pct"), state=p.get("state"), detail=p.get("detail"))
            except Exception:
                pass
            return
        if line.startswith("@@M "):
            try:
                with job.lock:
                    job.metrics.update(json.loads(line[4:]))
            except Exception:
                pass
            return
        if "UserWarning: Error checking compiler version" in line or "warnings.warn(f'Error checking" in line:
            return
        tq = parse_tqdm(line)
        tail.append(line)
        job.add_log(line, tq)
        if step.handler:
            try:
                step.handler(job, line, tq)
            except Exception:
                traceback.print_exc()


MANAGER = JobManager()
