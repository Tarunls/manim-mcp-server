# Manim MCP Server

## Manim Studio MVP

This repository now includes a minimal local prompt-to-video website backed by Manim. It provides a collapsible project sidebar, streamed Codex agent activity, an optional declarative Video IR, 1080p browser playback, revision history, timed AI narration, and MP4 download.

### Run it

Prerequisites:

- Node.js 20 or newer
- Python 3.10 or newer
- [`uv`](https://docs.astral.sh/uv/getting-started/installation/)
- FFmpeg and FFprobe available on `PATH`
- The [Codex CLI](https://developers.openai.com/codex/cli/) installed and authenticated

From a fresh clone:

```sh
npm install
npm run setup:manim
npm run build
npm run dev
```

Open `http://127.0.0.1:4321`.

`npm run setup:manim` creates a repository-local `.venv` and installs Manim Community Edition 0.19.x. The app stores local conversations and rendered media under `studio/projects/`; that directory is intentionally excluded from Git.

For narration, revoke any key that has been pasted into chat or committed anywhere, then place a replacement in a local `.env` file that is never committed:

```sh
cp .env.example .env
# Edit .env and set SPEECHIFY_API_KEY on the server only.
npm run dev
```

Or export it for the current shell before starting the server:

```sh
export SPEECHIFY_API_KEY="your-replacement-key"
npm run dev
```

Never put the key in a `VITE_*` variable. Vite exposes those values to browser code. Narration is generated server-side through `https://api.speechify.ai` with Speechify `simba-3.2`; the UI labels the result as an AI voice. The default voice is `geffen_32`, configurable through `SPEECHIFY_VOICE_ID`.

Narration uses 3-5 chapter-length passages instead of isolated sentence clips. The server adds warm SSML delivery, a slightly slower speaking rate, 160 kbps source audio, short fades, and loudness normalization. Timing is validated against the scene: a render fails if a passage overlaps the next visual chapter. Fallback TTS providers are forbidden, and completed videos are accepted only when metadata confirms Speechify `simba-3.2` and FFprobe finds a real audio track.

The app starts a local Codex App Server and reuses your existing Codex CLI authentication. If Codex is signed out, select **Connect Codex** in the sidebar and complete the managed ChatGPT browser flow. You can also authenticate before starting the app:

```sh
codex login
```

### Useful commands

```sh
npm run dev          # local server with reload
npm run check        # TypeScript validation
npm run build        # production client build + validation
npm start            # serve the production build
npm run setup:manim  # create/update the local Manim environment
```

If the app reports that Manim or FFmpeg is unavailable, confirm `.venv/bin/manim --version`, `ffmpeg -version`, and `ffprobe -version` work from the repository root. The MVP binds to `127.0.0.1:4321` by default; set `PORT` to use another local port.

### How generation works

1. The Node backend starts one long-lived `codex app-server` process over stdio.
2. Each video gets its own folder under `studio/projects/` and its own Codex thread.
3. For text, panel, and basic-shape videos, Codex writes or revises `video.vir.json`. For advanced mathematical graphics it can still author `scene.py` directly.
4. `scripts/render_scene.py` strictly validates Video IR when present, deterministically compiles `scene.py` and `narration.json`, validates the Python scene contract with the AST, and renders in a clean isolated Manim media directory. It then validates scene and panel bounds, optimizes MP4 seeking, extracts a poster and narration-aware six-frame contact sheet, and records reproducible render metadata.
5. If `narration.json` and a server API key are present, timed speech segments are generated and muxed into the MP4.
6. Every successful result is copied to an immutable `versions/vNNN/` folder, so older revisions remain playable in the same conversation.
7. Server-sent events stream normalized agent and render state to the browser. Raw reasoning and command output stay on the backend.

Render metadata includes canonical and file-level Video IR hashes, a generated-source fingerprint, narration-spec fingerprint, Manim and Python versions, referenced font families, semantic contact-sheet timestamps, and explicit static-wait metrics. The IR contract rejects unpositioned top-level nodes, invalid constraint ordering, group cycles, uncontained panels, impossible visibility transitions, overlapping cues, and unexplained static holds before invoking Manim. The Python contract remains active for both compiled and hand-authored scenes.

### Video IR

`studio/video-ir.schema.json` defines the renderer-independent authoring contract and `studio/video-ir.example.json` is a complete working v0.2 example. The compiler remains backward compatible with v0.1.

Video IR v0.2 adds:

- frame-aligned motion tokens and named easing curves;
- boundary-derived arrow and line connectors that remain attached after relational layout;
- directional entrance and exit presets, drawing, flashes, wiggles, and circumscription;
- staggered multi-object animation;
- fade, slide, shrink, uncreate, crossfade, push, and shape-matching morph transitions;
- continuity-aware visibility validation and a motion-variety lint that prevents repetitive slideshow animation.
- Pango-measured text wrapping with a declared minimum readable font size, plus deterministic grid groups for comparison and dashboard compositions.

Compile without rendering with `python3 scripts/compile_vir.py studio/projects/PROJECT_ID`. If `video.vir.json` is present, `scripts/render_scene.py` always recompiles generated artifacts before rendering, preventing drift between the declarative source and the final video. Hand-authored Manim remains the escape hatch for unsupported graphics.

The server binds to `127.0.0.1` for local MVP use. Do not expose it directly to the internet. A hosted version should move rendering into isolated workers and add application authentication, rate limits, object storage, and per-user project authorization.

### Production build

```sh
npm run build
npm start
```

### Project output

Every successful generation remains editable:

```text
studio/projects/<project-id>/
  video.vir.json       # optional authoritative source; archived when present
  scene.py
  narration.json
  output.mp4
  poster.png
  contact-sheet.png
  metadata.json
  versions/
    v001/
    v002/
```

## MCP server

![Manim MCP Demo](Demo-manim-mcp.gif)


## Overview

This is an MCP (Model Context Protocol) server that executes Manim animation code and returns the generated video. It allows users to send Manim scripts and receive the rendered animation.

## Features

- Executes Manim Python scripts.
- Saves animation output in a visible media folder.
- Allows users to clean up temporary files after execution.
- Portable and configurable via environment variables.

## Installation

### Prerequisites

Ensure you have the following installed:

- Python 3.8+
- Manim (Community Version)
- MCP

### Install Manim

```sh
pip install manim
```

### Install MCP

```sh
pip install mcp
```

### Clone the Repository

```sh
git clone https://github.com/abhiemj/manim-mcp-server.git
cd manim-mcp-server
```

## Integration with Claude

To integrate the Manim MCP server with Claude, add the following to your `claude_desktop_config.json` file:

```json
{
  "mcpServers": {
     "manim-server": {
      "command": "/absolute/path/to/python",
      "args": [
        "/absolute/path/to/manim-mcp-server/src/manim_server.py"
      ],
      "env": {
        "MANIM_EXECUTABLE": "/Users/[Your_username]/anaconda3/envs/manim2/Scripts/manim.exe"
      }
    }
  }
}
```

### Finding Your Python Path

To find your Python executable path, use the following command:

#### Windows (PowerShell):
```sh
(Get-Command python).Source
```

#### Windows (Command Prompt/Terminal):
```sh
where python
```

#### Linux/macOS (Terminal):
```sh
which python
```

This ensures that Claude can communicate with the Manim MCP server to generate animations dynamically.

## Contributing

1. Fork the repository.
2. Create a new branch:
   ```sh
   git checkout -b add-feature
   ```
3. Make changes and commit:
   ```sh
   git commit -m "Added a new feature"
   ```
4. Push to your fork:
   ```sh
   git push origin add-feature
   ```
5. Open a pull request.

## License

This MCP server is licensed under the MIT License. This means you are free to use, modify, and distribute the software, subject to the terms and conditions of the MIT License. For more details, please see the LICENSE file in the project repository.

## Author

Created by **[abhiemj](https://github.com/abhiemj)**. Contributions welcome! 🚀

### **Listed in Awesome MCP Servers**  
This repository is featured in the [Awesome MCP Servers](https://github.com/punkpeye/awesome-mcp-servers) repository under the **Animation & Video** category. Check it out along with other great MCP server implementations!


## **Acknowledgments**  
- Thanks to the [Manim Community](https://www.manim.community/) for their amazing animation library.  
- Inspired by the open-source MCP ecosystem.

## Find me at
<a href="https://www.instagram.com/aiburner_official" target="blank"><img align="center" src="https://raw.githubusercontent.com/rahuldkjain/github-profile-readme-generator/master/src/images/icons/Social/instagram.svg" alt="aiburner_official" height="30" width="40" /></a>
@aiburner_official
