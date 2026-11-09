"""Mesh post-processing & export: crop, re-orient, clean, smooth, decimate, write formats,
and produce a lightweight Y-up GLB for the in-browser viewer."""
import argparse
import os
import shutil
import time

import numpy as np
import open3d as o3d
import trimesh

from progress import M, P, fail, log
from scene_geom import ZUP_TO_YUP, load_cameras, rotation_to_z, scene_frame


def o3d_to_trimesh(m, colors=True):
    v = np.asarray(m.vertices)
    f = np.asarray(m.triangles)
    vc = None
    if colors and m.has_vertex_colors():
        vc = (np.clip(np.asarray(m.vertex_colors), 0, 1) * 255).astype(np.uint8)
        vc = np.concatenate([vc, np.full((len(vc), 1), 255, np.uint8)], axis=1)
    return trimesh.Trimesh(vertices=v, faces=f, vertex_colors=vc, process=False)


def transform(m, Rm=None, t=None):
    v = np.asarray(m.vertices)
    if t is not None:
        v = v + t
    if Rm is not None:
        v = v @ Rm.T
    m.vertices = o3d.utility.Vector3dVector(v)
    return m


def decimate(m, target):
    if target <= 0 or len(m.triangles) <= target:
        return m
    return m.simplify_quadric_decimation(int(target))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--mesh", required=True)
    ap.add_argument("--cache", default="", help="copy the raw mesh here before processing")
    ap.add_argument("--model", default="", help="trained model dir (for cameras.json)")
    ap.add_argument("--out", required=True)
    ap.add_argument("--basename", default="mesh")
    ap.add_argument("--crop", default="auto", choices=["none", "auto"])
    ap.add_argument("--crop_scale", type=float, default=1.0)
    ap.add_argument("--axis", default="zup", choices=["zup", "yup", "orig"])
    ap.add_argument("--min_component", type=int, default=500)
    ap.add_argument("--smooth", type=int, default=0)
    ap.add_argument("--target_faces", type=int, default=0)
    ap.add_argument("--colors", type=int, default=1)
    ap.add_argument("--formats", default="ply,glb")
    ap.add_argument("--preview_faces", type=int, default=600_000)
    a = ap.parse_args()

    os.makedirs(a.out, exist_ok=True)
    t_start = time.time()

    # 1. load ------------------------------------------------------------
    P("post_load", 5, "running", "读取原始网格")
    if a.cache and os.path.abspath(a.cache) != os.path.abspath(a.mesh):
        os.makedirs(os.path.dirname(a.cache), exist_ok=True)
        shutil.copy2(a.mesh, a.cache)
    m = o3d.io.read_triangle_mesh(a.mesh)
    if len(m.triangles) == 0:
        fail("原始网格为空")
    raw_v, raw_f = len(m.vertices), len(m.triangles)
    log(f"[INFO] 原始网格：{raw_v:,} 顶点 / {raw_f:,} 面")
    M(raw_vertices=raw_v, raw_faces=raw_f)
    frame = scene_frame(load_cameras(a.model)) if a.model else None
    P("post_load", 100, "done", f"{raw_f:,} 面")

    # 2. crop ------------------------------------------------------------
    P("post_crop", 0, "running", "裁剪场景")
    if a.crop == "auto" and frame is not None:
        r = frame["radius"] * a.crop_scale
        v = np.asarray(m.vertices)
        keep = np.linalg.norm(v - frame["target"], axis=1) <= r
        m.remove_vertices_by_mask(~keep)
        log(f"[INFO] 自动裁剪：以相机注视点为中心、半径 {r:.2f}，保留 {keep.mean() * 100:.1f}% 顶点")
        P("post_crop", 100, "done", f"半径 {r:.2f}，保留 {keep.mean() * 100:.0f}% 顶点")
    else:
        if a.crop == "auto":
            log("[WARN] 找不到 cameras.json，跳过自动裁剪")
        P("post_crop", 100, "done", "未裁剪")

    # 3. clean -----------------------------------------------------------
    P("post_clean", 10, "running", "去除漂浮碎片")
    m.remove_duplicated_vertices()
    m.remove_degenerate_triangles()
    m.remove_unreferenced_vertices()
    if a.min_component > 0 and len(m.triangles) > 0:
        P("post_clean", 40, None, "分析连通分量")
        cl, n_tri, _ = m.cluster_connected_triangles()
        cl = np.asarray(cl)
        n_tri = np.asarray(n_tri)
        small = n_tri[cl] < a.min_component
        n_removed = int((n_tri < a.min_component).sum())
        m.remove_triangles_by_mask(small)
        m.remove_unreferenced_vertices()
        log(f"[INFO] 移除 {n_removed:,} 个小于 {a.min_component} 面的碎片")
    if len(m.triangles) == 0:
        fail("清理后网格为空：请降低“最小碎片面数”或放大裁剪范围")
    P("post_clean", 100, "done", f"剩余 {len(m.triangles):,} 面")

    # 4. smooth ----------------------------------------------------------
    if a.smooth > 0:
        P("post_smooth", 0, "running", f"Taubin 平滑 × {a.smooth}")
        has_c = m.has_vertex_colors()
        cols = np.asarray(m.vertex_colors).copy() if has_c else None
        m = m.filter_smooth_taubin(number_of_iterations=a.smooth)
        if has_c and not m.has_vertex_colors():
            m.vertex_colors = o3d.utility.Vector3dVector(cols)
        P("post_smooth", 100, "done", f"{a.smooth} 次迭代")
    else:
        P("post_smooth", 100, "done", "未平滑")

    # 5. decimate --------------------------------------------------------
    if a.target_faces > 0 and len(m.triangles) > a.target_faces:
        P("post_decimate", 5, "running", f"二次误差减面 {len(m.triangles):,} → {a.target_faces:,}")
        m = decimate(m, a.target_faces)
        m.remove_unreferenced_vertices()
        P("post_decimate", 100, "done", f"{len(m.triangles):,} 面")
    else:
        P("post_decimate", 100, "done", "保持原面数")

    # 6. orientation -----------------------------------------------------
    if a.axis != "orig" and frame is not None:
        Rz = rotation_to_z(frame["up"])
        transform(m, Rz, -frame["target"])
        v = np.asarray(m.vertices)
        transform(m, None, np.array([0.0, 0.0, -np.percentile(v[:, 2], 2)]))  # ground at z = 0
        zup = True
    else:
        zup = False
    if not a.colors:
        m.vertex_colors = o3d.utility.Vector3dVector()
    m.compute_vertex_normals()

    # 7. write -----------------------------------------------------------
    fmts = [f.strip().lower() for f in a.formats.split(",") if f.strip()]
    files = []
    for i, fmt in enumerate(fmts):
        P("post_write", i / len(fmts) * 100, "running", f"写出 {fmt.upper()}")
        out_path = os.path.join(a.out, f"{a.basename}.{fmt}")
        mm = o3d.geometry.TriangleMesh(m)
        if zup and (a.axis == "yup" or fmt == "glb"):
            transform(mm, ZUP_TO_YUP)  # glTF is always Y-up
        if fmt == "ply":
            o3d.io.write_triangle_mesh(out_path, mm, write_ascii=False, compressed=False,
                                       write_vertex_normals=True, write_vertex_colors=bool(a.colors))
        else:
            tm = o3d_to_trimesh(mm, colors=bool(a.colors))
            if fmt == "obj":
                tm.export(out_path, file_type="obj", include_color=bool(a.colors), include_normals=True)
            elif fmt == "glb":
                tm.export(out_path, file_type="glb")
            elif fmt == "stl":
                tm.export(out_path, file_type="stl")
            else:
                fail(f"不支持的格式 {fmt}")
        files.append({"name": os.path.basename(out_path), "format": fmt, "size": os.path.getsize(out_path)})
        log(f"[INFO] 已写出 {os.path.basename(out_path)}（{os.path.getsize(out_path) / 1e6:.1f} MB）")
    P("post_write", 100, "done", "、".join(f["format"].upper() for f in files))

    # 8. preview ---------------------------------------------------------
    P("post_preview", 5, "running", "生成网页预览模型")
    pv = o3d.geometry.TriangleMesh(m)
    if len(pv.triangles) > a.preview_faces:
        pv = decimate(pv, a.preview_faces)
        pv.remove_unreferenced_vertices()
    P("post_preview", 70, None, "写出 preview.glb")
    if zup:
        transform(pv, ZUP_TO_YUP)
    else:
        if frame is not None:  # original COLMAP frame: still show it upright in the viewer
            transform(pv, ZUP_TO_YUP @ rotation_to_z(frame["up"]), -frame["target"])
    o3d_to_trimesh(pv, colors=bool(a.colors)).export(os.path.join(a.out, "preview.glb"), file_type="glb")
    P("post_preview", 100, "done", f"{len(pv.triangles):,} 面")

    v = np.asarray(m.vertices)
    M(vertices=len(m.vertices), faces=len(m.triangles), files=files,
      extent=[round(float(x), 3) for x in (v.max(0) - v.min(0))], has_colors=bool(a.colors and m.has_vertex_colors()),
      preview_faces=len(pv.triangles), post_seconds=round(time.time() - t_start, 1))
    log(f"[INFO] 导出完成：{len(m.vertices):,} 顶点 / {len(m.triangles):,} 面，用时 {time.time() - t_start:.1f}s")


if __name__ == "__main__":
    main()
