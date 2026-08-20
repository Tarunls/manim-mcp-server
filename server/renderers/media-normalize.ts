import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function normalizeShot(input: string, output: string, format: { width: number; height: number; fps: number }, duration: number) {
  const probe = await execFileAsync("ffprobe", ["-v", "error", "-select_streams", "a", "-show_entries", "stream=index", "-of", "csv=p=0", input]);
  const hasAudio = Boolean(probe.stdout.trim());
  const scale = `tpad=stop_mode=clone:stop_duration=${duration},scale=${format.width}:${format.height}:force_original_aspect_ratio=decrease,pad=${format.width}:${format.height}:(ow-iw)/2:(oh-ih)/2:color=black,fps=${format.fps},format=yuv420p`;
  const args = ["-y", "-i", input];
  if (!hasAudio) args.push("-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=48000");
  args.push("-vf", scale, "-map", "0:v:0", "-map", hasAudio ? "0:a:0" : "1:a:0", "-t", String(duration), "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-video_track_timescale", "90000", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-movflags", "+faststart", output);
  await execFileAsync("ffmpeg", args, { maxBuffer: 4 * 1024 * 1024 });
  return output;
}
