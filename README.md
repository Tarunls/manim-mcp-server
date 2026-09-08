# Manim MCP Server

## Orune MVP

The production foundation and custom-domain staging infrastructure are implemented; final narrated-generation and launch certification remain. The trust boundaries and data flow are documented in [docs/PRODUCTION_ARCHITECTURE.md](docs/PRODUCTION_ARCHITECTURE.md), current evidence and blockers are in [docs/IMPLEMENTATION_STATUS.md](docs/IMPLEMENTATION_STATUS.md), and the exact next-agent continuation is in [docs/GCP_ADMIN_LLM_HANDOFF.md](docs/GCP_ADMIN_LLM_HANDOFF.md).

Current staging is online at `https://useorune.com`. Auth, Stripe sandbox provisioning/Portal, private PostgreSQL/GCS data, E2B/Codex execution, and a complete silent video have passed real staging tests. The deployed release `004c9c7` is **not** fully certified: its paid narrated test exposed a relocatable Manim launcher path. Commit `c74eb0d` fixes the renderer and has a successfully built application image, but its matching E2B template still must be built, smoked, deployed, and retested. Do not treat the current staging environment as public-production ready.

Hosted mode uses `EXECUTION_MODE=e2b`, PostgreSQL, Cloud Tasks, private GCS artifacts, and a pinned E2B template. Build that template with `npm run e2b:build-template`; production startup intentionally fails if any required hosted dependency is missing.

Deployment is defined in [infra/terraform](infra/terraform/README.md). Follow [the GCP runbook](docs/DEPLOYMENT_RUNBOOK.md) and [production checklist](docs/PRODUCTION_CHECKLIST.md); applying Terraform is a deliberate billable operation and is not part of ordinary application CI.

This repository includes a local prompt-to-video studio. Every lesson is rendered with Manim Community Edition; there is one renderer and one layout engine, so nothing competes for the final canvas.

Rendered revisions include a seven-frame filmstrip. Pause anywhere, select **Review frame**, draw with the default pen or choose a circle, arrow, or rectangle, add a note, and send the clean plus annotated frame to the model as direct high-detail image inputs. The reviewer isolates the smallest marked target and records nearby objects that must remain unchanged.

Images imported through the asset picker (Wikimedia Commons, with creator, license, source URL, and SHA-256 digest recorded) are listed to the scene model with their paths so it can use them. Project settings expose a plain-language Thinking control, font categories, colour palettes, and voice control; the font and palette are offered to the model as defaults, not enforced. The request selector can force a new video or a revision; Auto starts standalone video prompts in a fresh project.

### Run it

Prerequisites:

- Node.js 22 or newer
- Python 3.10 or newer
- [`uv`](https://docs.astral.sh/uv/getting-started/installation/)
- FFmpeg and FFprobe available on `PATH`
- An [OpenAI Platform API key](https://platform.openai.com/api-keys)

From a fresh clone:

```sh
npm install
npm run setup:manim
cp .env.example .env
# Set OPENAI_API_KEY, IDENTITY_PLATFORM_API_KEY, and a 32+ character
# SESSION_SECRET in .env. Add the optional provider keys you use.
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

Narration is one clip per storyboard beat, synthesised before the scene is written so the real clip lengths set the timeline. Each clip is trimmed of provider padding and loudness-corrected with one static gain, then mixed in at its start time; if the picture ends before the voice, the last frame is held. Fallback TTS providers are not used.

Local mode calls the OpenAI Responses API directly with `OPENAI_API_KEY`. Hosted E2B workers instead receive an active-job-scoped proxy token; the upstream OpenAI key remains in the API service and direct E2B access to `api.openai.com` is blocked. Orune presents Faster, Balanced, and Try harder choices instead of model or reasoning jargon; the choice picks the code model and its reasoning effort. A normal job makes three to six model calls, and independent estimated-cost limits stop normal work at $2 and Try harder work at $4.

### Billing

The front page and studio use a server-enforced monthly credit model: Free includes 1 credit, Creator is $20/month with 10 credits, Pro is $50/month with 30 credits, and Studio is $100/month with 70 credits. Faster costs 1 credit, Balanced costs 2, and Try harder costs 4. Paid plans unlock Speechify narration and licensed visual search. Checkout and subscription management use Stripe-hosted pages; signed webhooks are the source of truth for paid access.

Install and authenticate the Stripe CLI, then create the test-mode product catalog once:

```sh
stripe login
npm run stripe:setup
```

Copy `.env.example` to `.env`, set `STRIPE_SECRET_KEY` to a Stripe sandbox or test secret, set `ALLOW_TEST_CHECKOUT=true` only for local or staging billing tests, and start the local webhook forwarder in a second terminal. Stripe CLI sandboxes can be kept separate from another Stripe account by naming the profile:

```bash
stripe sandbox create --non-interactive --from-git --project-name lesson-studio
STRIPE_CLI_PROJECT=lesson-studio npm run stripe:setup
stripe --project-name lesson-studio listen --events checkout.session.completed,checkout.session.async_payment_succeeded,customer.subscription.created,customer.subscription.updated,customer.subscription.deleted,invoice.paid,invoice.payment_failed --forward-to http://127.0.0.1:4321/api/stripe/webhook
```

Never commit the sandbox key. Put it in Secret Manager as `stripe_sandbox_api_key` for staging. Production must use a distinct live restricted key and keep `ALLOW_TEST_CHECKOUT=false`.

```sh
npm run stripe:listen
```

Copy the `whsec_...` value printed by the listener into `STRIPE_WEBHOOK_SECRET`, then restart the app. Never commit either secret. The setup script is idempotent because Checkout resolves stable `lesson_studio_<plan>_monthly` lookup keys instead of hard-coded price IDs.

### Google Cloud deployment

The included `Dockerfile` packages Node, FFmpeg, and Manim's Cairo/Pango stack for Cloud Run. `cloudbuild.yaml` caches the heavy rendering layers. The public homepage and pricing page require no account; the studio uses Google Cloud Identity Platform email/password accounts with mandatory email verification. Staff emails receive the full internal plan without requiring a Stripe subscription.

The scalable Terraform deployment expects these existing Secret Manager names:

- `openai_api_key` -> `OPENAI_API_KEY`
- `e2b_api_key` -> `E2B_API_KEY`
- `stripe_sandbox_api_key` -> `STRIPE_SECRET_KEY` in staging; use a separate live-key secret in production
- `stripe_webhook_secret` -> `STRIPE_WEBHOOK_SECRET`
- `speechify_key` -> `SPEECHIFY_API_KEY`
- `identity_platform_api_key` -> `IDENTITY_PLATFORM_API_KEY`
- `staff_emails` -> `STAFF_EMAILS`

Terraform generates the database URL, job callback secret, and audit secret, and grants each Cloud Run identity access only to its required secrets. The API stores metadata in regional Cloud SQL and media in private GCS; E2B generation is asynchronous through Cloud Tasks, so Cloud Run remains stateless and horizontally scalable. The older `identity:setup`, `gcp:storage`, and `stripe:cloud-webhook` scripts exist for the legacy singleton only and must not be used to mutate a Terraform-managed staging or production environment.

Public deployments must use a live Stripe secret before paid buttons are enabled. Keep `ALLOW_TEST_CHECKOUT=false` in production. Before collecting live payments, configure the appropriate tax registrations and decide whether Stripe Tax should be enabled; do not turn on automatic tax collection without those business decisions.

### Useful commands

```sh
npm run dev          # local server with reload
npm run check        # TypeScript validation
npm run build        # production client build + validation
npm run test         # unit and database-gated integration tests
npm run test:e2e     # desktop/mobile route, accessibility, and CSRF tests
npm start            # serve the production build
npm run setup:manim  # create/update the local Manim environment
npm run stripe:setup # create missing test products and monthly prices
npm run stripe:listen # forward selected test webhooks to the local app
npm run stripe:cloud-webhook # create and securely attach a Cloud Run test webhook
npm run identity:setup # provision Identity Platform and staff access
npm run gcp:storage # attach persistent Cloud Storage data
npm run smoke:identity # temporary real Identity Platform account/session test
npm run smoke:stripe # real sandbox Checkout creation against a disposable DB user
npm run smoke:e2b # pinned no-internet E2B runtime test with guaranteed teardown
npm run smoke:staging # public auth, Checkout-session, E2B, artifact, and cleanup smoke
npm run smoke:staging-payment # hosted Checkout, webhook, Portal, paid narration, and cleanup gate
```

If the app reports that Manim or FFmpeg is unavailable, confirm `.venv/bin/python -m manim --version`, `ffmpeg -version`, and `ffprobe -version` work from the repository root. Render helpers use `python -m manim` because a console-script shebang can become invalid when an E2B image is snapshotted or mounted. The MVP binds to `127.0.0.1:4321` by default; set `PORT` to use another local port.

### How generation works

There is no agent. A lesson is a fixed sequence of plain model calls and one render, and every creative choice in it belongs to the model:

1. **Script.** One call to the fast model turns the brief into a storyboard: a title and a list of beats, each with the narration as it will be spoken and a concrete description of what is on screen. No hook is imposed, no length, no word counts, no house style.
2. **Voice.** Every narration line is synthesised immediately (ElevenLabs or Speechify, chosen by the project's voice) and measured. The real clip lengths become the timeline: each beat starts when its line starts. Nothing about timing is guessed.
3. **Scene.** One call to the code model writes `scene.py` from the storyboard and that timeline. It is told the frame size, the installed fonts, that LaTeX is unavailable, and the exact seconds each beat occupies. It writes whatever Manim it wants.
4. **Render.** `scripts/render_scene.py` renders once at final quality, mixes the clips in at their start times, and extracts a poster and contact sheet. If Manim fails, the error and the scene go back to the model for a fix, up to three times. "Try harder" adds one look at the rendered frames.

Models are named in `shared/models.json` and can be overridden with `ORUNE_SCRIPT_MODEL`, `ORUNE_CODE_MODEL`, and `ORUNE_CODE_MODEL_THOROUGH` (plus matching `*_REASONING` variables). Hosted jobs make these calls from inside the E2B sandbox through the job-scoped proxy, which picks the model per stage; local mode calls OpenAI directly with the server key.

The renderer checks only what makes a video unplayable: the scene defines `GeneratedScene`, Manim succeeds, the frame matches the chosen format, and a narrated lesson carries its audio track. Held frames are written once with their duration and turned into a constant 30 fps file in a single FFmpeg pass, which is most of why a render now takes tens of seconds rather than minutes.

Every successful result is copied to an immutable `versions/vNNN/` folder alongside its `storyboard.json`, so a revision can hand the previous storyboard and scene back to the model, and older revisions remain playable in the same conversation.

Local mode binds to `127.0.0.1` and should not be exposed directly. Hosted mode already places rendering in isolated E2B workers and uses Identity Platform, rate limits, PostgreSQL ownership checks, Cloud Tasks, and private object storage. Follow the production architecture and checklist rather than exposing the local mode.

### Production build

```sh
npm run build
npm start
```

### Project output

Every successful generation remains editable:

```text
studio/projects/<project-id>/
  scene.py
  beat-plan.md
  public/assets/ (licensed imported assets)
  assets.json
  asset-decision.json
  review-config.json
  review-report.json
  design-config.json
  reviews/ (clean and annotated frame feedback)
  narration-config.json
  narration.json (only used when AI voice is enabled)
  output.mp4
  poster.png
  contact-sheet.png
  metadata.json
  versions/
    v001/
    v002/
```

### Collision checks

Layout is checked by code as well as by image review. Scenes use `assert_no_overlap` for stable poses and `watch_no_overlap` during motion. Intentional composites should be grouped so container-child overlap is not mistaken for a collision.

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
