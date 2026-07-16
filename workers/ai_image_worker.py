"""Optional Real-ESRGAN image worker.

The Node application discovers this worker dynamically. It is intentionally
dependency-free for --capabilities and imports heavy AI modules only when a job
is executed.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import os
import shutil
import sys
import time
from pathlib import Path
from types import SimpleNamespace

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")

def module_available(name: str) -> bool:
    return importlib.util.find_spec(name) is not None


def model_paths() -> dict[str, str | None]:
    return {
        "photo2": os.getenv("REALESRGAN_MODEL_X2_PATH"),
        "photo4": os.getenv("REALESRGAN_MODEL_X4_PATH"),
        "anime4": os.getenv("REALESRGAN_MODEL_ANIME_PATH"),
        "gfpgan": os.getenv("GFPGAN_MODEL_PATH"),
    }


def capabilities() -> dict[str, object]:
    required = ["torch", "realesrgan", "basicsr", "cv2", "numpy"]
    missing = [name for name in required if not module_available(name)]
    paths = model_paths()
    existing_models = {
        name: bool(path and Path(path).is_file()) for name, path in paths.items()
    }
    gpu = False
    gpu_memory_mb = 0
    if "torch" not in missing:
        try:
            import torch

            gpu = bool(torch.cuda.is_available())
            if gpu:
                gpu_memory_mb = int(torch.cuda.get_device_properties(0).total_memory / (1024**2))
        except Exception:
            gpu = False

    real_models = [existing_models["photo2"], existing_models["photo4"], existing_models["anime4"]]
    ready = not missing and any(real_models)
    gfpgan_ready = module_available("gfpgan") and existing_models["gfpgan"]
    reason = None
    if missing:
        reason = "不足しているPythonモジュール: " + ", ".join(missing)
    elif not any(real_models):
        reason = (
            "Real-ESRGANモデルが未設定です。REALESRGAN_MODEL_X2_PATH、"
            "REALESRGAN_MODEL_X4_PATH、REALESRGAN_MODEL_ANIME_PATHを設定してください。"
        )
    return {
        "python": True,
        "realEsrgan": ready,
        "gfpgan": gfpgan_ready,
        "gpu": gpu,
        "gpuMemoryMb": gpu_memory_mb,
        "ncnnVulkan": bool(
            shutil.which(os.getenv("REALESRGAN_NCNN_PATH", "realesrgan-ncnn-vulkan"))
        ),
        "models": existing_models,
        "reason": reason,
    }


def select_model(model_kind: str, scale: int):
    from basicsr.archs.rrdbnet_arch import RRDBNet

    paths = model_paths()
    if model_kind == "anime":
        path = paths["anime4"]
        network_scale = 4
        blocks = 6
    elif scale == 2 and paths["photo2"]:
        path = paths["photo2"]
        network_scale = 2
        blocks = 23
    else:
        path = paths["photo4"]
        network_scale = 4
        blocks = 23

    if not path or not Path(path).is_file():
        raise RuntimeError("選択したReal-ESRGANモデルの重みファイルがありません。")
    model = RRDBNet(
        num_in_ch=3,
        num_out_ch=3,
        num_feat=64,
        num_block=blocks,
        num_grow_ch=32,
        scale=network_scale,
    )
    return model, path, network_scale


def create_processor(args: argparse.Namespace):
    import cv2
    import numpy as np
    import torch
    from realesrgan import RealESRGANer

    model, model_path, network_scale = select_model(args.model, args.scale)
    tile = args.tile
    if tile < 0:
        if torch.cuda.is_available():
            total_memory = torch.cuda.get_device_properties(0).total_memory
            gib = total_memory / (1024**3)
            tile = 512 if gib >= 12 else 384 if gib >= 8 else 256 if gib >= 4 else 128
        else:
            tile = 256
    upsampler = RealESRGANer(
        scale=network_scale,
        model_path=model_path,
        model=model,
        tile=tile,
        tile_pad=10,
        pre_pad=0,
        half=bool(torch.cuda.is_available()),
        gpu_id=0 if torch.cuda.is_available() else None,
    )
    face_enhancer = None
    if args.face_strength > 0:
        from gfpgan import GFPGANer

        face_model = model_paths()["gfpgan"]
        if not face_model or not Path(face_model).is_file():
            raise RuntimeError("GFPGANモデルの重みファイルがありません。")
        face_enhancer = GFPGANer(
            model_path=face_model,
            upscale=args.scale,
            arch="clean",
            channel_multiplier=2,
            bg_upsampler=None,
        )
    return cv2, np, torch, upsampler, face_enhancer


PROCESSOR_CACHE: dict[tuple[object, ...], object] = {}


def processor_key(args: argparse.Namespace) -> tuple[object, ...]:
    return (args.model, args.scale, args.tile, args.face_strength > 0)


def get_processor(args: argparse.Namespace):
    key = processor_key(args)
    started = time.perf_counter()
    reused = key in PROCESSOR_CACHE
    if not reused:
        PROCESSOR_CACHE[key] = create_processor(args)
    return PROCESSOR_CACHE[key], (time.perf_counter() - started) * 1000, reused


def process_file(
    input_path: Path,
    output_path: Path,
    args: argparse.Namespace,
    processor,
) -> None:
    cv2, np, torch, upsampler, face_enhancer = processor
    image = cv2.imread(str(input_path), cv2.IMREAD_UNCHANGED)
    if image is None:
        raise RuntimeError(f"入力画像を読み込めませんでした: {input_path.name}")

    if args.denoise > 0:
        if image.ndim == 3 and image.shape[2] == 4:
            rgb, alpha = image[:, :, :3], image[:, :, 3]
            rgb = cv2.fastNlMeansDenoisingColored(
                rgb, None, args.denoise, args.denoise, 7, 21
            )
            image = np.dstack((rgb, alpha))
        else:
            image = cv2.fastNlMeansDenoisingColored(
                image, None, args.denoise, args.denoise, 7, 21
            )

    with torch.inference_mode():
        enhanced, _ = upsampler.enhance(image, outscale=args.scale)

        if face_enhancer is not None:
            _, _, restored = face_enhancer.enhance(
                enhanced,
                has_aligned=False,
                only_center_face=False,
                paste_back=True,
                weight=args.face_strength,
            )
            if restored is not None:
                enhanced = restored

    if args.strength < 1:
        base = cv2.resize(
            image,
            (enhanced.shape[1], enhanced.shape[0]),
            interpolation=cv2.INTER_LANCZOS4,
        )
        enhanced = cv2.addWeighted(
            enhanced, args.strength, base, 1.0 - args.strength, 0
        )

    output_path.parent.mkdir(parents=True, exist_ok=True)
    if not cv2.imwrite(str(output_path), enhanced):
        raise RuntimeError("AI処理後の画像を書き込めませんでした。")


def run_job(args: argparse.Namespace) -> None:
    import torch

    processor, model_load_ms, reused = get_processor(args)
    inference_started = time.perf_counter()
    process_file(Path(args.input), Path(args.output), args, processor)
    print(json.dumps({
        "ok": True,
        "gpu": bool(torch.cuda.is_available()),
        "modelLoadMs": model_load_ms,
        "modelReused": reused,
        "inferenceMs": (time.perf_counter() - inference_started) * 1000,
    }))


def run_directory(args: argparse.Namespace, request_id: str | None = None) -> dict[str, object]:
    import torch

    source = Path(args.input_dir)
    destination = Path(args.output_dir)
    frames = sorted(source.glob("*.png"))
    if not frames:
        raise RuntimeError("AI処理する動画フレームがありません。")
    destination.mkdir(parents=True, exist_ok=True)
    processor, model_load_ms, reused = get_processor(args)
    inference_started = time.perf_counter()
    total = len(frames)
    for index, frame in enumerate(frames, start=1):
        process_file(frame, destination / frame.name, args, processor)
        print(
            json.dumps(
                    {"id": request_id, "type": "progress", "current": index, "total": total},
                ensure_ascii=False,
            ),
            flush=True,
        )
    result = {
        "ok": True,
        "gpu": bool(torch.cuda.is_available()),
        "modelLoadMs": model_load_ms,
        "modelReused": reused,
        "inferenceMs": (time.perf_counter() - inference_started) * 1000,
    }
    if request_id is None:
        print(json.dumps(result))
    return result


def serve() -> int:
    for line in sys.stdin:
        try:
            request = json.loads(line)
            request_id = str(request.get("id", ""))
            if not request_id or len(request_id) > 128:
                raise RuntimeError("invalid request id")
            request_type = request.get("type")
            args = SimpleNamespace(
                input=request.get("inputPath"),
                output=request.get("outputPath"),
                input_dir=request.get("inputDirectory"),
                output_dir=request.get("outputDirectory"),
                scale=int(request.get("scale", 2)),
                model=request.get("model", "photo"),
                denoise=float(request.get("denoise", 0)),
                strength=float(request.get("strength", 1)),
                tile=-1,
                face_strength=float(request.get("faceStrength", 0)),
            )
            if args.scale not in (2, 4) or args.model not in ("photo", "anime"):
                raise RuntimeError("invalid AI settings")
            if request_type == "directory":
                result = run_directory(args, request_id)
            elif request_type == "image" and args.input and args.output:
                import torch

                processor, model_load_ms, reused = get_processor(args)
                inference_started = time.perf_counter()
                process_file(Path(args.input), Path(args.output), args, processor)
                result = {
                    "ok": True,
                    "gpu": bool(torch.cuda.is_available()),
                    "modelLoadMs": model_load_ms,
                    "modelReused": reused,
                    "inferenceMs": (time.perf_counter() - inference_started) * 1000,
                }
            else:
                raise RuntimeError("invalid AI job type")
            print(json.dumps({"id": request_id, **result}, ensure_ascii=False), flush=True)
        except Exception as exc:
            request_id = locals().get("request_id", "unknown")
            print(
                json.dumps({"id": request_id, "ok": False, "error": str(exc)}, ensure_ascii=False),
                flush=True,
            )
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--capabilities", action="store_true")
    parser.add_argument("--serve", action="store_true")
    parser.add_argument("--input")
    parser.add_argument("--output")
    parser.add_argument("--input-dir")
    parser.add_argument("--output-dir")
    parser.add_argument("--scale", type=int, choices=[2, 4], default=2)
    parser.add_argument("--model", choices=["photo", "anime"], default="photo")
    parser.add_argument("--denoise", type=float, default=0)
    parser.add_argument("--strength", type=float, default=1)
    parser.add_argument("--tile", type=int, default=0)
    parser.add_argument("--face-strength", type=float, default=0)
    args = parser.parse_args()

    if args.capabilities:
        print(json.dumps(capabilities(), ensure_ascii=False))
        return 0
    if args.serve:
        return serve()
    image_job = bool(args.input and args.output)
    directory_job = bool(args.input_dir and args.output_dir)
    if image_job == directory_job:
        parser.error("provide either --input/--output or --input-dir/--output-dir")
    if not 0 <= args.denoise <= 30:
        parser.error("--denoise must be between 0 and 30")
    if not 0.1 <= args.strength <= 1:
        parser.error("--strength must be between 0.1 and 1")
    if not 0 <= args.face_strength <= 1:
        parser.error("--face-strength must be between 0 and 1")

    try:
        if directory_job:
            run_directory(args)
        else:
            run_job(args)
        return 0
    except Exception as exc:  # Worker boundary: emit a concise error for Node.
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
