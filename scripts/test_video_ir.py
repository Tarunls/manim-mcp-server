from __future__ import annotations

from copy import deepcopy
import json
from pathlib import Path
import tempfile
import unittest

from scripts.scene_contract import validate_narration_spec, validate_scene_source
from scripts.video_ir import VideoIRValidationError, compile_project, compile_video_ir, validate_video_ir


NARRATION = (
    "This clear visual establishes the main idea, then connects each element so the next step follows naturally "
    "without unnecessary distraction."
)


def valid_video_ir() -> dict:
    def beat(index: int) -> dict:
        return {
            "id": f"beat-{index}",
            "intent": f"Establish visual relationship number {index}",
            "focus": "message",
            "duration": 9 if index < 3 else 8.5,
            "narration": NARRATION,
            **({"transitionDuration": 0.5} if index < 3 else {}),
            "nodes": [
                {
                    "id": "panel",
                    "type": "panel",
                    "width": 9.5,
                    "height": 4.8,
                    "cornerRadius": 0.2,
                    "style": {"fill": "surface", "stroke": "muted", "fillOpacity": 1},
                },
                {"id": "headline", "type": "text", "text": f"Beat {index}", "role": "headline"},
                {"id": "message", "type": "text", "text": "A precise relationship", "role": "body"},
                {
                    "id": "content",
                    "type": "group",
                    "children": ["headline", "message"],
                    "layout": "column",
                    "gap": "md",
                    "align": "center",
                },
            ],
            "constraints": [
                {"type": "anchor", "target": "panel", "anchor": "center"},
                {"type": "inside", "target": "content", "container": "panel", "padding": "lg"},
            ],
            "cues": [
                {"start": 0, "duration": 0.8, "action": "fadeIn", "targets": ["panel"]},
                {"start": 0.8, "duration": 0.8, "action": "write", "targets": ["content"]},
                {"start": 2, "duration": 0.8, "action": "indicate", "targets": ["message"]},
                {"start": 3.4, "duration": 0.8, "action": "indicate", "targets": ["message"]},
                {"start": 4.8, "duration": 0.8, "action": "indicate", "targets": ["message"]},
                {"start": 6.2, "duration": 0.8, "action": "indicate", "targets": ["message"]},
                {"start": 7.3, "duration": 0.8, "action": "indicate", "targets": ["message"]},
            ],
        }

    return {
        "schemaVersion": "0.1",
        "format": {"width": 1920, "height": 1080, "fps": 30, "background": "background", "safeArea": 0.32},
        "theme": {
            "fontFamily": "DejaVu Sans",
            "palette": {
                "background": "#F6F5F2",
                "surface": "#FFFFFF",
                "text": "#17202A",
                "muted": "#AAB2BD",
                "accent": "#4C6FFF",
            },
            "spacing": {"sm": 0.18, "md": 0.32, "lg": 0.5},
            "textStyles": {
                "headline": {"fontSize": 52, "color": "text", "weight": "BOLD"},
                "body": {"fontSize": 31, "color": "text", "weight": "NORMAL"},
                "caption": {"fontSize": 22, "color": "muted", "weight": "MEDIUM"},
            },
        },
        "beats": [beat(1), beat(2), beat(3)],
    }


def valid_video_ir_v02() -> dict:
    data = valid_video_ir()
    data["schemaVersion"] = "0.2"
    data["theme"]["motion"] = {
        "durations": {"fast": 0.4, "base": 0.8, "slow": 1.2},
        "distance": 0.6,
        "defaultEase": "smooth",
    }
    for beat in data["beats"]:
        beat["nodes"].append(
            {
                "id": "relationship",
                "type": "connector",
                "from": "headline",
                "to": "message",
                "kind": "arrow",
                "color": "accent",
                "strokeWidth": 3,
                "buff": "sm",
            }
        )
        beat["nodes"][3]["gap"] = 0.9
    data["beats"][0]["transition"] = {
        "style": "push", "duration": "slow", "direction": "left", "distance": 0.7
    }
    data["beats"][0].pop("transitionDuration")
    data["beats"][1]["transition"] = {"style": "morph", "duration": "slow"}
    data["beats"][1].pop("transitionDuration")
    data["beats"][0]["cues"] = [
        {"start": 0, "duration": "base", "action": "slideIn", "targets": ["panel"], "direction": "down"},
        {"start": 0.8, "duration": "slow", "action": "write", "targets": ["content"]},
        {"start": 2, "duration": "fast", "action": "draw", "targets": ["relationship"]},
        {"start": 2.8, "duration": "base", "action": "circumscribe", "targets": ["message"], "color": "accent"},
        {"start": 4, "duration": "fast", "action": "flash", "targets": ["message"]},
        {"start": 4.8, "duration": "slow", "action": "wiggle", "targets": ["message"]},
        {"start": 6.6, "duration": "base", "action": "indicate", "targets": ["message"]},
    ]
    data["beats"][1]["cues"] = [
        {"start": 0, "duration": "base", "action": "circumscribe", "targets": ["panel"]},
        {"start": 1.2, "duration": "slow", "action": "wiggle", "targets": ["headline", "message"], "stagger": 0.18},
        {"start": 2.8, "duration": "fast", "action": "flash", "targets": ["message"]},
        {"start": 3.6, "duration": "base", "action": "indicate", "targets": ["relationship"]},
        {"start": 4.8, "duration": "base", "action": "circumscribe", "targets": ["message"]},
        {"start": 6, "duration": "slow", "action": "wiggle", "targets": ["message"]},
    ]
    data["beats"][2]["duration"] = 8.4
    data["beats"][2]["cues"] = [
        {"start": 0, "duration": "base", "action": "circumscribe", "targets": ["panel"]},
        {"start": 1.2, "duration": "slow", "action": "wiggle", "targets": ["message"]},
        {"start": 2.8, "duration": "fast", "action": "flash", "targets": ["message"]},
        {"start": 3.6, "duration": "base", "action": "indicate", "targets": ["relationship"]},
        {"start": 4.8, "duration": "base", "action": "circumscribe", "targets": ["message"]},
        {"start": 6, "duration": "slow", "action": "wiggle", "targets": ["message"]},
        {"start": 7.6, "duration": "fast", "action": "indicate", "targets": ["message"]},
    ]
    return data


class VideoIRTests(unittest.TestCase):
    def test_valid_ir_compiles_deterministically(self) -> None:
        data = valid_video_ir()
        first = compile_video_ir(data)
        second = compile_video_ir(deepcopy(data))
        self.assertEqual(first.source, second.source)
        self.assertEqual(first.vir_hash, second.vir_hash)
        self.assertTrue(first.report.valid)
        self.assertIn("GENERATED FROM video.vir.json", first.source)
        self.assertIn("fit_inside(b1_content, b1_panel", first.source)
        self.assertEqual(first.narration["segments"][1]["start"], 9.0)
        self.assertTrue(validate_scene_source(first.source).valid)
        self.assertTrue(validate_narration_spec(first.narration, 27).valid)

    def test_v02_compiles_connectors_motion_tokens_and_continuity(self) -> None:
        compiled = compile_video_ir(valid_video_ir_v02())
        self.assertTrue(compiled.report.valid)
        self.assertIn("connect_mobjects(b1_headline, b1_message", compiled.source)
        self.assertIn("LaggedStart(Wiggle(b2_headline), Wiggle(b2_message), lag_ratio=0.18)", compiled.source)
        self.assertIn("FadeIn(beat_2_group, shift=-LEFT", compiled.source)
        self.assertIn("TransformMatchingShapes(beat_2_group, beat_3_group)", compiled.source)

    def test_v02_features_are_rejected_under_v01_version(self) -> None:
        data = valid_video_ir_v02()
        data["schemaVersion"] = "0.1"
        messages = [issue.message for issue in validate_video_ir(data).issues]
        self.assertTrue(any("require schemaVersion '0.2'" in message for message in messages))

    def test_v02_rejects_repetitive_motion_grammar(self) -> None:
        data = valid_video_ir_v02()
        for cue in data["beats"][2]["cues"]:
            if cue["action"] in {"circumscribe", "flash", "wiggle"}:
                cue["action"] = "indicate"
        messages = [issue.message for issue in validate_video_ir(data).issues]
        self.assertTrue(any("repeat motion actions more than twice" in message for message in messages))

    def test_compile_project_writes_both_generated_artifacts(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            project = Path(temporary)
            (project / "video.vir.json").write_text(json.dumps(valid_video_ir()), encoding="utf-8")
            compiled = compile_project(project)
            self.assertEqual((project / "scene.py").read_text(encoding="utf-8"), compiled.source)
            narration = json.loads((project / "narration.json").read_text(encoding="utf-8"))
            self.assertEqual(len(narration["segments"]), 3)

    def test_unknown_reference_is_rejected(self) -> None:
        data = valid_video_ir()
        data["beats"][0]["constraints"][1]["container"] = "missing"
        messages = [issue.message for issue in validate_video_ir(data).issues]
        self.assertIn("references an unknown node.", messages)

    def test_unpositioned_top_level_node_is_rejected(self) -> None:
        data = valid_video_ir()
        data["beats"][0]["nodes"].append({"id": "orphan", "type": "circle", "radius": 0.5})
        messages = [issue.message for issue in validate_video_ir(data).issues]
        self.assertIn("top-level node 'orphan' is not positioned.", messages)

    def test_panel_without_containment_is_rejected(self) -> None:
        data = valid_video_ir()
        data["beats"][0]["constraints"] = [
            {"type": "anchor", "target": "panel", "anchor": "center"},
            {"type": "anchor", "target": "content", "anchor": "center"},
        ]
        messages = [issue.message for issue in validate_video_ir(data).issues]
        self.assertIn("panel 'panel' must contain content through an inside constraint.", messages)

    def test_group_cycle_is_rejected(self) -> None:
        data = valid_video_ir()
        data["beats"][0]["nodes"].append(
            {"id": "cycle", "type": "group", "children": ["content"], "layout": "row", "gap": "sm", "align": "center"}
        )
        data["beats"][0]["nodes"][3]["children"].append("cycle")
        messages = [issue.message for issue in validate_video_ir(data).issues]
        self.assertTrue(any(message.startswith("group cycle includes") for message in messages))

    def test_overlapping_cues_are_rejected(self) -> None:
        data = valid_video_ir()
        data["beats"][0]["cues"][1]["start"] = 0.4
        messages = [issue.message for issue in validate_video_ir(data).issues]
        self.assertIn("overlaps or is out of order relative to the previous cue.", messages)

    def test_hidden_node_cannot_be_indicated(self) -> None:
        data = valid_video_ir()
        data["beats"][0]["cues"][0] = {
            "start": 0, "duration": 0.8, "action": "indicate", "targets": ["message"]
        }
        messages = [issue.message for issue in validate_video_ir(data).issues]
        self.assertIn("cannot indicate hidden node 'message'.", messages)

    def test_excessive_unexplained_hold_is_rejected(self) -> None:
        data = valid_video_ir()
        data["beats"][0]["cues"] = data["beats"][0]["cues"][:2]
        report = validate_video_ir(data)
        self.assertTrue(any("of the beat static" in issue.message for issue in report.issues))
        with self.assertRaises(VideoIRValidationError):
            compile_video_ir(data)

    def test_unknown_spacing_token_is_rejected(self) -> None:
        data = valid_video_ir()
        data["beats"][0]["nodes"][3]["gap"] = "nonexistent"
        messages = [issue.message for issue in validate_video_ir(data).issues]
        self.assertIn("must be a non-negative number or a defined theme.spacing token.", messages)

    def test_align_cannot_establish_a_position_by_itself(self) -> None:
        data = valid_video_ir()
        data["beats"][0]["constraints"] = [
            {"type": "anchor", "target": "panel", "anchor": "center"},
            {"type": "align", "target": "content", "reference": "panel", "edge": "left"},
            {"type": "inside", "target": "content", "container": "panel", "padding": "lg"},
        ]
        messages = [issue.message for issue in validate_video_ir(data).issues]
        self.assertIn("must already be positioned before it can be aligned.", messages)

    def test_style_numbers_are_validated_before_compilation(self) -> None:
        data = valid_video_ir()
        data["beats"][0]["nodes"][0]["style"]["fillOpacity"] = "opaque"
        messages = [issue.message for issue in validate_video_ir(data).issues]
        self.assertIn("must be from 0 to 1.", messages)

    def test_timing_must_land_on_the_output_frame_grid(self) -> None:
        data = valid_video_ir_v02()
        data["beats"][0]["cues"][0]["start"] = 0.01
        messages = [issue.message for issue in validate_video_ir(data).issues]
        self.assertIn("must align to the 30 fps frame grid.", messages)

    def test_v02_compiles_wrapped_text_and_grid_groups(self) -> None:
        data = valid_video_ir_v02()
        beat = data["beats"][0]
        beat["nodes"][2].update(
            {"text": "A longer relationship that wraps using measured glyph widths", "maxWidth": 3.4,
             "minFontSize": 22, "lineSpacing": 0.16, "align": "center"}
        )
        beat["nodes"][3].update({"layout": "grid", "columns": 2, "rowGap": "sm"})
        compiled = compile_video_ir(data)
        self.assertIn("b1_message = wrapped_text(", compiled.source)
        self.assertIn("b1_content.arrange_in_grid(cols=2", compiled.source)
        self.assertTrue(validate_scene_source(compiled.source).valid)


if __name__ == "__main__":
    unittest.main()
