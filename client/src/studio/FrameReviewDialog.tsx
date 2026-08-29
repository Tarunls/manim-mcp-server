import {
  ArrowUpRight,
  Circle,
  CircleNotch,
  PaperPlaneRight,
  PencilSimple,
  Rectangle,
  Trash,
} from "@phosphor-icons/react";
import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as CanvasPointerEvent,
} from "react";
import { errorMessage, request } from "../lib/api";
import type { ProjectVersion, StudioProject } from "../types";
import { Modal } from "./Modal";

type AnnotationTool = "pen" | "circle" | "rectangle" | "arrow";
type Point = { x: number; y: number };
type Annotation = { tool: AnnotationTool; points: Point[] };

function drawAnnotation(
  context: CanvasRenderingContext2D,
  annotation: Annotation,
  scale: number,
) {
  const [start, end = start] = annotation.points;
  if (!start) return;
  context.strokeStyle = "#ff334f";
  context.fillStyle = "#ff334f";
  context.lineWidth = Math.max(5, scale * 7);
  context.lineCap = "round";
  context.lineJoin = "round";
  if (annotation.tool === "pen") {
    context.beginPath();
    annotation.points.forEach((point, index) =>
      index
        ? context.lineTo(point.x, point.y)
        : context.moveTo(point.x, point.y),
    );
    context.stroke();
  } else if (annotation.tool === "circle") {
    context.beginPath();
    context.ellipse(
      (start.x + end.x) / 2,
      (start.y + end.y) / 2,
      Math.abs(end.x - start.x) / 2,
      Math.abs(end.y - start.y) / 2,
      0,
      0,
      Math.PI * 2,
    );
    context.stroke();
  } else if (annotation.tool === "rectangle") {
    context.strokeRect(start.x, start.y, end.x - start.x, end.y - start.y);
  } else {
    context.beginPath();
    context.moveTo(start.x, start.y);
    context.lineTo(end.x, end.y);
    context.stroke();
    const angle = Math.atan2(end.y - start.y, end.x - start.x);
    const head = Math.max(22, scale * 28);
    context.beginPath();
    context.moveTo(end.x, end.y);
    context.lineTo(
      end.x - head * Math.cos(angle - Math.PI / 6),
      end.y - head * Math.sin(angle - Math.PI / 6),
    );
    context.lineTo(
      end.x - head * Math.cos(angle + Math.PI / 6),
      end.y - head * Math.sin(angle + Math.PI / 6),
    );
    context.closePath();
    context.fill();
  }
}

export function FrameReviewDialog({
  project,
  version,
  time,
  onClose,
}: {
  project: StudioProject;
  version: ProjectVersion;
  time: number;
  onClose: () => void;
}) {
  const [tool, setTool] = useState<AnnotationTool>("pen");
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [current, setCurrent] = useState<Annotation>();
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const currentRef = useRef<Annotation | undefined>(undefined);
  const fps = version.render?.fps || 30;
  const frame = Math.max(0, Math.round(time * fps));
  const frameUrl = `/api/projects/${project.id}/frames?version=${encodeURIComponent(version.id)}&time=${(frame / fps).toFixed(6)}`;

  // The frame itself is a plain <img>; the canvas only holds annotations, so
  // it stays transparent and is composited with the image at submit time.
  useEffect(() => {
    const canvas = canvasRef.current;
    const image = imageRef.current;
    if (!canvas || !image || !loaded) return;
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    for (const annotation of annotations)
      drawAnnotation(context, annotation, canvas.width / 1920);
    if (current) drawAnnotation(context, current, canvas.width / 1920);
  }, [annotations, current, loaded]);

  function point(event: CanvasPointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current!;
    const bounds = canvas.getBoundingClientRect();
    return {
      x: Math.min(
        canvas.width,
        Math.max(
          0,
          ((event.clientX - bounds.left) * canvas.width) / bounds.width,
        ),
      ),
      y: Math.min(
        canvas.height,
        Math.max(
          0,
          ((event.clientY - bounds.top) * canvas.height) / bounds.height,
        ),
      ),
    };
  }

  function pointerDown(event: CanvasPointerEvent<HTMLCanvasElement>) {
    if (!loaded) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const annotation = { tool, points: [point(event)] };
    currentRef.current = annotation;
    setCurrent(annotation);
  }

  function pointerMove(event: CanvasPointerEvent<HTMLCanvasElement>) {
    const active = currentRef.current;
    if (!active) return;
    const next = point(event);
    const updated = {
      ...active,
      points:
        active.tool === "pen"
          ? [...active.points, next]
          : [active.points[0], next],
    };
    currentRef.current = updated;
    setCurrent(updated);
  }

  function pointerUp(event: CanvasPointerEvent<HTMLCanvasElement>) {
    const active = currentRef.current;
    if (!active) return;
    const next = point(event);
    const completed = {
      ...active,
      points:
        active.tool === "pen"
          ? [...active.points, next]
          : [active.points[0], next],
    };
    setAnnotations((items) => [...items, completed]);
    currentRef.current = undefined;
    setCurrent(undefined);
  }

  async function submit() {
    const image = imageRef.current;
    if (!image || !loaded || !note.trim() || !annotations.length) {
      setError("Mark the frame and add a short note.");
      return;
    }
    setSending(true);
    setError("");
    try {
      const composite = document.createElement("canvas");
      composite.width = image.naturalWidth;
      composite.height = image.naturalHeight;
      const context = composite.getContext("2d");
      if (!context) throw new Error("Could not prepare the annotated frame.");
      context.drawImage(image, 0, 0, composite.width, composite.height);
      for (const annotation of annotations)
        drawAnnotation(context, annotation, composite.width / 1920);
      await request(`/api/projects/${project.id}/reviews`, {
        method: "POST",
        body: JSON.stringify({
          versionId: version.id,
          time: frame / fps,
          note: note.trim(),
          annotatedImageData: composite.toDataURL("image/png"),
        }),
      });
      onClose();
    } catch (reason) {
      setError(errorMessage(reason, "Could not send frame feedback."));
    } finally {
      setSending(false);
    }
  }

  return (
    <Modal
      label="Annotate video frame"
      kicker="Frame feedback"
      title="Mark what should change"
      subtitle={
        <span className="mono">
          {version.id} · frame {frame} · {(frame / fps).toFixed(2)}s
        </span>
      }
      className="review-dialog"
      onClose={onClose}
      footer={
        <>
          <button className="button button-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            className="button button-primary"
            disabled={sending || !loaded}
            onClick={() => void submit()}
          >
            {sending ? (
              <CircleNotch className="spin" size={16} />
            ) : (
              <PaperPlaneRight size={16} />
            )}{" "}
            Send to model
          </button>
        </>
      }
    >
      <div className="annotation-toolbar">
        <div
          className="annotation-tools"
          role="group"
          aria-label="Annotation tools"
        >
          <button
            className={tool === "pen" ? "active" : ""}
            onClick={() => setTool("pen")}
            title="Draw"
            aria-label="Draw"
            aria-pressed={tool === "pen"}
          >
            <PencilSimple size={16} />
          </button>
          <button
            className={tool === "circle" ? "active" : ""}
            onClick={() => setTool("circle")}
            title="Circle"
            aria-label="Circle"
            aria-pressed={tool === "circle"}
          >
            <Circle size={16} />
          </button>
          <button
            className={tool === "rectangle" ? "active" : ""}
            onClick={() => setTool("rectangle")}
            title="Rectangle"
            aria-label="Rectangle"
            aria-pressed={tool === "rectangle"}
          >
            <Rectangle size={16} />
          </button>
          <button
            className={tool === "arrow" ? "active" : ""}
            onClick={() => setTool("arrow")}
            title="Arrow"
            aria-label="Arrow"
            aria-pressed={tool === "arrow"}
          >
            <ArrowUpRight size={16} />
          </button>
        </div>
        <span />
        <button
          className="button button-ghost"
          onClick={() => setAnnotations((items) => items.slice(0, -1))}
          disabled={!annotations.length}
        >
          Undo
        </button>
        <button
          className="button button-ghost"
          onClick={() => setAnnotations([])}
          disabled={!annotations.length}
        >
          <Trash size={15} /> Clear
        </button>
      </div>
      <div className="annotation-canvas-wrap">
        {!loaded && !error && <CircleNotch className="spin" size={22} />}
        <img
          ref={imageRef}
          src={frameUrl}
          alt=""
          draggable={false}
          onLoad={() => setLoaded(true)}
          onError={() => setError("Could not load this frame.")}
        />
        <canvas
          ref={canvasRef}
          onPointerDown={pointerDown}
          onPointerMove={pointerMove}
          onPointerUp={pointerUp}
          onPointerCancel={pointerUp}
        />
      </div>
      <label className="review-note">
        What should change?
        <textarea
          rows={3}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="For example: Move this label above the curve and keep it clear during the transition."
        />
      </label>
      {error && <span className="form-error">{error}</span>}
    </Modal>
  );
}
