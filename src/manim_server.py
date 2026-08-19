import subprocess
import os
import re
import shutil
import base64
from mcp.server.fastmcp import FastMCP
from mcp.server.fastmcp.utilities.types import Image

mcp = FastMCP()

# Get Manim executable path from environment variables or assume it's in the system PATH
MANIM_EXECUTABLE = os.getenv("MANIM_EXECUTABLE", "manim")

# Get ffmpeg executable path from environment variables or assume it's in the system PATH
FFMPEG_EXECUTABLE = os.getenv("FFMPEG_EXECUTABLE", "ffmpeg")

TEMP_DIRS = {}
BASE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "media")
os.makedirs(BASE_DIR, exist_ok=True)  # Ensure the media folder exists

QUALITY_FLAGS = {
    "low": "-ql",       # 480p15  - fast iteration
    "medium": "-qm",    # 720p30
    "high": "-qh",      # 1080p60 - final render
    "4k": "-qk",        # 2160p60
}


def _find_scene_classes(manim_code: str):
    return re.findall(r"class\s+(\w+)\s*\(\s*(?:\w+\.)?Scene\s*\)", manim_code)


def _find_output_video(tmpdir: str, scene_name: str):
    """Search the media dir for the rendered mp4 for this scene."""
    videos_dir = os.path.join(tmpdir, "media", "videos")
    if not os.path.isdir(videos_dir):
        return None
    candidates = []
    for root, _dirs, files in os.walk(videos_dir):
        for f in files:
            if f.endswith(".mp4") and (scene_name is None or f == f"{scene_name}.mp4"):
                candidates.append(os.path.join(root, f))
    if not candidates:
        return None
    # Prefer the highest-resolution render if several quality dirs exist
    candidates.sort(key=lambda p: os.path.getmtime(p), reverse=True)
    return candidates[0]


@mcp.tool()
def execute_manim_code(manim_code: str, scene_name: str = "", quality: str = "low") -> str:
    """Render Manim code to a video.

    Args:
        manim_code: Full contents of a Manim Python script (must define at least one Scene subclass).
        scene_name: Which Scene class to render. If empty, the first Scene class found in the code is used.
        quality: One of "low" (480p15, fast preview), "medium" (720p30), "high" (1080p60, final), "4k" (2160p60).

    Returns:
        A message with success/failure and, on success, the absolute path to the rendered mp4
        (pass that path to get_preview_frame to inspect stills before finalizing).
    """
    tmpdir = os.path.join(BASE_DIR, "manim_tmp")
    os.makedirs(tmpdir, exist_ok=True)
    script_path = os.path.join(tmpdir, "scene.py")

    scenes = _find_scene_classes(manim_code)
    if not scenes:
        return "Error: no class inheriting from Scene was found in manim_code."
    target_scene = scene_name.strip() or scenes[0]
    if target_scene not in scenes:
        return f"Error: scene '{target_scene}' not found. Available scenes: {scenes}"

    quality_flag = QUALITY_FLAGS.get(quality, QUALITY_FLAGS["low"])

    try:
        with open(script_path, "w", encoding="utf-8") as script_file:
            script_file.write(manim_code)

        result = subprocess.run(
            [MANIM_EXECUTABLE, quality_flag, "--disable_caching", script_path, target_scene],
            capture_output=True,
            text=True,
            cwd=tmpdir,
            timeout=600,
        )

        if result.returncode == 0:
            TEMP_DIRS[tmpdir] = True
            video_path = _find_output_video(tmpdir, target_scene)
            if video_path:
                return f"Execution successful. Video generated at: {video_path}"
            return "Execution successful, but the output video file could not be located."
        else:
            return f"Execution failed:\n{result.stderr[-4000:]}"

    except subprocess.TimeoutExpired:
        return "Execution failed: render timed out after 600 seconds."
    except Exception as e:
        return f"Error during execution: {str(e)}"


@mcp.tool()
def get_preview_frame(video_path: str, timestamp: float = 0.0) -> Image:
    """Extract a single still frame from a rendered video so it can be visually inspected.

    Args:
        video_path: Absolute path to the mp4 returned by execute_manim_code.
        timestamp: Time in seconds into the video to grab the frame from.

    Returns:
        The frame as a PNG image.
    """
    if not os.path.exists(video_path):
        raise FileNotFoundError(f"Video not found: {video_path}")

    frame_path = os.path.join(os.path.dirname(video_path), f"__preview_{timestamp}.png".replace(":", "_"))

    result = subprocess.run(
        [FFMPEG_EXECUTABLE, "-y", "-ss", str(timestamp), "-i", video_path, "-frames:v", "1", frame_path],
        capture_output=True,
        text=True,
    )

    if result.returncode != 0 or not os.path.exists(frame_path):
        raise RuntimeError(f"ffmpeg failed to extract frame: {result.stderr[-2000:]}")

    with open(frame_path, "rb") as f:
        data = f.read()

    return Image(data=data, format="png")


@mcp.tool()
def get_video_duration(video_path: str) -> str:
    """Return the duration in seconds of a rendered video, using ffprobe."""
    if not os.path.exists(video_path):
        return f"Video not found: {video_path}"
    ffprobe = os.getenv("FFPROBE_EXECUTABLE", "ffprobe")
    result = subprocess.run(
        [ffprobe, "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", video_path],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        return f"ffprobe failed: {result.stderr[-1000:]}"
    return result.stdout.strip()


@mcp.tool()
def cleanup_manim_temp_dir(directory: str) -> str:
    """Clean up the specified Manim temporary directory after execution."""
    try:
        if os.path.exists(directory):
            shutil.rmtree(directory)
            return f"Cleanup successful for directory: {directory}"
        else:
            return f"Directory not found: {directory}"
    except Exception as e:
        return f"Failed to clean up directory: {directory}. Error: {str(e)}"


if __name__ == "__main__":
    mcp.run(transport="stdio")
