from __future__ import annotations

import unittest

from scripts.scene_contract import semantic_sample_times, validate_narration_spec, validate_scene_source


VALID_SCENE = """
from manim import *
from manim_layout import assert_inside, assert_scene_safe, fit_inside, stack_in_panel

class GeneratedScene(Scene):
    def construct(self):
        panel = RoundedRectangle(width=4, height=2).move_to(ORIGIN)
        title = Text("Measured first", font="Manrope")
        content = stack_in_panel(panel, title, padding=0.3)
        assert_inside(panel, content, padding=0.16)
        assert_scene_safe(panel, content, margin=0.32)
        self.play(FadeIn(panel), run_time=0.5)
        self.wait(2)
"""


class SceneContractTests(unittest.TestCase):
    def test_valid_scene_reports_layout_timing_and_fonts(self) -> None:
        report = validate_scene_source(VALID_SCENE)

        self.assertTrue(report.valid, report.issues)
        self.assertEqual(report.scene_classes, ["GeneratedScene"])
        self.assertEqual(report.panel_variables, ["panel"])
        self.assertEqual(report.guarded_panels, ["panel"])
        self.assertEqual(report.font_families, ["Manrope"])
        self.assertEqual(report.explicit_wait_seconds, 2.0)
        self.assertEqual(report.estimated_duration_seconds, 2.5)

    def test_invalid_helper_keyword_and_missing_argument_are_reported(self) -> None:
        source = VALID_SCENE.replace(
            "content = stack_in_panel(panel, title, padding=0.3)",
            "content = fit_inside(panel, margin=0.3)",
        )
        report = validate_scene_source(source)
        messages = [issue.message for issue in report.issues]

        self.assertIn("fit_inside() needs at least 2 positional arguments.", messages)
        self.assertIn("fit_inside() does not accept the keyword argument 'margin'.", messages)

    def test_each_named_rounded_panel_requires_its_own_guard(self) -> None:
        source = VALID_SCENE.replace(
            "title = Text(\"Measured first\", font=\"Manrope\")",
            "title = Text(\"Measured first\", font=\"Manrope\")\n"
            "        secondary_panel = RoundedRectangle(width=2, height=1)",
        )
        report = validate_scene_source(source)

        self.assertIn(
            "Panel 'secondary_panel' must be passed as the first argument to assert_inside().",
            [issue.message for issue in report.issues],
        )

    def test_additional_scene_subclass_is_rejected(self) -> None:
        source = VALID_SCENE + "\nclass AccidentalPreview(Scene):\n    pass\n"
        report = validate_scene_source(source)

        self.assertFalse(report.valid)
        self.assertIn("AccidentalPreview", report.issues[0].message)

    def test_unseeded_randomness_is_rejected(self) -> None:
        source = VALID_SCENE.replace(
            "panel = RoundedRectangle(width=4, height=2).move_to(ORIGIN)",
            "value = np.random.uniform()\n"
            "        panel = RoundedRectangle(width=4, height=2).move_to(ORIGIN)",
        )
        report = validate_scene_source(source)

        self.assertIn(
            "Random scene generation must set an explicit seed before use: np.random.uniform.",
            [issue.message for issue in report.issues],
        )

    def test_seeded_randomness_is_accepted(self) -> None:
        source = VALID_SCENE.replace(
            "panel = RoundedRectangle(width=4, height=2).move_to(ORIGIN)",
            "np.random.seed(7)\n"
            "        value = np.random.uniform()\n"
            "        panel = RoundedRectangle(width=4, height=2).move_to(ORIGIN)",
        )
        report = validate_scene_source(source)

        self.assertTrue(report.valid, report.issues)

    def test_semantic_samples_cover_beats_and_are_bounded(self) -> None:
        samples = semantic_sample_times(20.0, [0.0, 8.0, 14.0], count=6)

        self.assertEqual(len(samples), 6)
        self.assertEqual(samples, sorted(samples))
        self.assertTrue(all(0 <= sample <= 19.9 for sample in samples))
        self.assertTrue(any(abs(sample - 0.35) < 0.01 for sample in samples))
        self.assertTrue(any(abs(sample - 8.35) < 0.01 for sample in samples))

    def test_timing_inside_a_loop_is_marked_dynamic(self) -> None:
        source = VALID_SCENE.replace(
            "self.play(FadeIn(panel), run_time=0.5)",
            "for _ in range(3):\n"
            "            self.play(FadeIn(panel), run_time=0.5)",
        )
        report = validate_scene_source(source)

        self.assertEqual(report.dynamic_timing_calls, 1)
        self.assertEqual(report.estimated_duration_seconds, 2.0)

    def test_narration_budget_rejects_an_undersized_visual_timeline(self) -> None:
        passage = "Every visual beat needs enough time for spoken explanation while the scene continues changing with clear purpose."
        spec = {
            "segments": [
                {"start": 0, "text": passage},
                {"start": 8, "text": passage},
                {"start": 16, "text": passage},
            ]
        }
        report = validate_narration_spec(spec, estimated_scene_duration=12)

        self.assertFalse(report.valid)
        self.assertEqual(report.word_counts, [17, 17, 17])
        messages = [issue.message for issue in report.issues]
        self.assertTrue(any("18-45 words" in message for message in messages))
        self.assertTrue(any("explicit scene timeline" in message for message in messages))

    def test_valid_narration_reports_minimum_duration(self) -> None:
        passage = "Every visual beat needs enough time for a spoken explanation while the scene keeps changing with clarity and purpose."
        spec = {
            "segments": [
                {"start": 0, "text": passage},
                {"start": 10, "text": passage},
                {"start": 20, "text": passage},
            ]
        }
        report = validate_narration_spec(spec, estimated_scene_duration=30)

        self.assertTrue(report.valid, report.issues)
        self.assertEqual(report.word_counts, [19, 19, 19])
        self.assertGreater(report.minimum_duration_seconds, 25)


if __name__ == "__main__":
    unittest.main()
