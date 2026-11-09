"""Scene frame estimation from 3DGS cameras.json (world up, look-at target, scale)."""
import json
import os

import numpy as np


def load_cameras(model_path):
    path = os.path.join(model_path, "cameras.json")
    if not os.path.isfile(path):
        return None
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def scene_frame(cams):
    """Returns dict(target, up, radius, positions, forwards) or None."""
    if not cams:
        return None
    C = np.array([c["position"] for c in cams], dtype=np.float64)
    R = np.array([c["rotation"] for c in cams], dtype=np.float64)  # camera-to-world
    fwd = R[:, :, 2]
    up = (-R[:, :, 1]).mean(0)
    up /= np.linalg.norm(up) + 1e-12
    A = np.zeros((3, 3))
    b = np.zeros(3)
    for c, d in zip(C, fwd):
        Pm = np.eye(3) - np.outer(d, d)
        A += Pm
        b += Pm @ c
    try:
        target = np.linalg.solve(A + 1e-6 * np.eye(3), b)
    except np.linalg.LinAlgError:
        target = C.mean(0)
    # guard against degenerate (e.g. all cameras parallel): fall back to camera centroid
    dist = np.linalg.norm(C - target, axis=1)
    if not np.isfinite(target).all() or np.median(dist) > 20 * (np.linalg.norm(C - C.mean(0), axis=1).max() + 1e-6):
        target = C.mean(0) + fwd.mean(0)
        dist = np.linalg.norm(C - target, axis=1)
    return {
        "target": target,
        "up": up,
        "radius": float(np.median(dist)),
        "positions": C,
        "forwards": fwd,
    }


def rotation_to_z(up):
    """Rotation matrix mapping vector `up` onto +Z."""
    z = np.array([0.0, 0.0, 1.0])
    up = up / np.linalg.norm(up)
    v = np.cross(up, z)
    s = np.linalg.norm(v)
    c = float(up @ z)
    if s < 1e-8:
        return np.eye(3) if c > 0 else np.diag([1.0, -1.0, -1.0])
    K = np.array([[0, -v[2], v[1]], [v[2], 0, -v[0]], [-v[1], v[0], 0]])
    return np.eye(3) + K + K @ K * ((1 - c) / s**2)


ZUP_TO_YUP = np.array([[1.0, 0, 0], [0, 0, 1.0], [0, -1.0, 0]])  # (x,y,z) -> (x,z,-y)
