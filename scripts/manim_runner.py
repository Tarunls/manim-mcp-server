"""Run Manim's CLI with a faster frame writer.

Where Manim's time went on a typical lesson: a forty-second video is mostly
held frames, and Manim converts and encodes each one separately, single
threaded, at libx264's default preset. Two changes remove most of that:

1. A held frame is encoded once with a presentation timestamp that covers the
   whole hold. The partial movie files become variable-frame-rate; the render
   script then makes one native ffmpeg pass to a constant 30 fps file, which is
   many times faster than encoding the duplicates here.
2. The partial-file encoder uses a fast preset with threads. It is an
   intermediate that gets re-encoded, so its preset only affects speed.

ORUNE_X264_PRESET overrides the intermediate preset.
"""

from __future__ import annotations

import collections
import os

from manim.scene import scene_file_writer as writer_module


def open_partial_movie_stream(self, file_path=None):
    if file_path is None:
        file_path = self.partial_movie_files[self.renderer.num_plays]
    self.partial_movie_file_path = file_path

    config = writer_module.config
    fps = writer_module.to_av_frame_rate(config.frame_rate)

    codec = "libx264"
    pix_fmt = "yuv420p"
    av_options = {
        "an": "1",
        "crf": "18",
        "preset": os.environ.get("ORUNE_X264_PRESET", "ultrafast").strip() or "ultrafast",
        # No B-frames, so packets leave the encoder in the order frames went in
        # and each one can carry the duration of the frame it encodes.
        "bf": "0",
    }
    if config.movie_file_extension == ".webm":
        codec = "libvpx-vp9"
        av_options["-auto-alt-ref"] = "1"
        del av_options["preset"]
        if config.transparent:
            pix_fmt = "yuva420p"
    elif config.transparent:
        codec = "qtrle"
        pix_fmt = "argb"
        del av_options["preset"]

    video_container = writer_module.av.open(file_path, mode="w")
    stream = video_container.add_stream(codec, rate=fps, options=av_options)
    stream.pix_fmt = pix_fmt
    stream.width = config.pixel_width
    stream.height = config.pixel_height
    if codec == "libx264":
        try:
            stream.codec_context.thread_type = "AUTO"
            stream.codec_context.thread_count = max(1, os.cpu_count() or 1)
        except Exception:
            pass

    self.video_container = video_container
    self.video_stream = stream
    self._orune_pts = 0
    self._orune_durations = collections.deque()
    self.queue = writer_module.Queue()
    self.writer_thread = writer_module.Thread(target=self.listen_and_write, args=())
    self.writer_thread.start()


def _mux_with_durations(self, packets):
    for packet in packets:
        if self._orune_durations:
            packet.duration = self._orune_durations.popleft()
        self.video_container.mux(packet)


def encode_and_write_frame(self, frame, num_frames):
    """Encode one frame whose timestamp and duration span ``num_frames`` periods."""
    span = max(1, int(num_frames))
    av_frame = writer_module.av.VideoFrame.from_ndarray(frame, format="rgba")
    av_frame.pts = self._orune_pts
    self._orune_pts += span
    self._orune_durations.append(span)
    _mux_with_durations(self, self.video_stream.encode(av_frame))


def close_partial_movie_stream(self):
    """Flush the encoder, giving the trailing packets their durations too."""
    self.queue.put((-1, None))
    self.writer_thread.join()
    _mux_with_durations(self, self.video_stream.encode())
    self.video_container.close()
    writer_module.logger.info(
        f"Animation {self.renderer.num_plays} : Partial movie file written in %(path)s",
        {"path": f"'{self.partial_movie_file_path}'"},
    )


writer_module.SceneFileWriter.open_partial_movie_stream = open_partial_movie_stream
writer_module.SceneFileWriter.encode_and_write_frame = encode_and_write_frame
writer_module.SceneFileWriter.close_partial_movie_stream = close_partial_movie_stream


if __name__ == "__main__":
    from manim.__main__ import main

    main()
