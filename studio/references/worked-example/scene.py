from manim import (
    DOWN,
    LEFT,
    RIGHT,
    UP,
    AnimationGroup,
    Arrow,
    Create,
    DashedLine,
    Dot,
    FadeIn,
    FadeOut,
    GrowArrow,
    Line,
    Rectangle,
    Scene,
    Transform,
    VGroup,
)

from manim_layout import assert_inside, assert_no_overlap, assert_scene_safe, watch_no_overlap
from manim_paper import claim, expr, fit_stage, label, load_design, running_head, swap_claim


class GeneratedScene(Scene):
    def make_grid(self, design, transformed=False):
        """A small lattice before or after A = [[2, .6], [0, 1]]."""
        lines = VGroup()
        x_values = (-2, -1, 0, 1, 2)
        y_values = (-1.5, -0.75, 0, 0.75, 1.5)
        for x in x_values:
            if transformed:
                start = (2 * x + 0.6 * -1.5, -1.5, 0)
                end = (2 * x + 0.6 * 1.5, 1.5, 0)
            else:
                start = (x, -1.5, 0)
                end = (x, 1.5, 0)
            lines.add(Line(start, end, color=design["rule"], stroke_width=1.25))
        for y in y_values:
            if transformed:
                start = (2 * -2 + 0.6 * y, y, 0)
                end = (2 * 2 + 0.6 * y, y, 0)
            else:
                start = (-2, y, 0)
                end = (2, y, 0)
            lines.add(Line(start, end, color=design["rule"], stroke_width=1.25))
        return lines

    def construct(self):
        d = load_design(".")
        self.camera.background_color = d["background"]

        head = running_head(d, "Eigenvectors")
        title = claim(d, "A linear transformation moves every vector.", head)

        grid_before = self.make_grid(d, transformed=False)
        grid_after = self.make_grid(d, transformed=True)
        axes_before = VGroup(
            Line((-2.35, 0, 0), (2.35, 0, 0), color=d["rule"], stroke_width=1.8),
            Line((0, -1.75, 0), (0, 1.75, 0), color=d["rule"], stroke_width=1.8),
        )
        axes_after = VGroup(
            Line((-4.7, 0, 0), (4.7, 0, 0), color=d["rule"], stroke_width=1.8),
            Line((-1.05, -1.75, 0), (1.05, 1.75, 0), color=d["rule"], stroke_width=1.8),
        )

        diagonal_before = Arrow((0, 0, 0), (1.2, 1.1, 0), buff=0, color=d["primary"], stroke_width=5)
        diagonal_after = Arrow((0, 0, 0), (3.06, 1.1, 0), buff=0, color=d["primary"], stroke_width=5)
        horizontal_before = Arrow((0, 0, 0), (1.8, 0, 0), buff=0, color=d["primary"], stroke_width=5)
        horizontal_after = Arrow((0, 0, 0), (3.6, 0, 0), buff=0, color=d["primary"], stroke_width=5)
        diagonal_ghost = DashedLine((0, 0, 0), (1.2, 1.1, 0), color=d["muted"], stroke_width=2.2, dash_length=0.12)
        original_horizontal = Arrow((0, 0, 0), (1.8, 0, 0), buff=0, color=d["primary"], stroke_width=3.2).set_opacity(0.28)

        diagonal_label = label(d, diagonal_after, "turned", UP, color=d["primary"], buff=0.16)
        eigen_label = label(d, horizontal_after, "eigenvector", UP, color=d["primary"], buff=0.18)
        payoff_dot = Dot(horizontal_after.get_end(), radius=0.09, color=d["accent"])
        payoff_label = label(d, payoff_dot, "same line", DOWN, color=d["accent"], buff=0.16)
        equation = expr(d, ("A", "it"), ("v", "it"), ("=", "up"), ("2", "up"), ("v", "it"))
        equation.move_to((0.0, -2.28, 0))

        # This invisible stage-sized anchor lets all diagram states share one
        # editorial placement before any state is animated on screen.
        anchor = Line((-5.35, -2.62, 0), (5.35, 1.46, 0), stroke_opacity=0)
        layout = VGroup(
            anchor, grid_before, grid_after, axes_before, axes_after,
            diagonal_before, diagonal_after, horizontal_before, horizontal_after,
            diagonal_ghost, original_horizontal, diagonal_label, eigen_label,
            payoff_dot, payoff_label, equation,
        )
        fit_stage(layout)
        stage_frame = Rectangle(width=11.6, height=4.75).move_to((0, -0.575, 0))

        beat_one = VGroup(grid_before, axes_before, diagonal_before, horizontal_before)
        self.add(head, title)
        self.play(Create(grid_before), Create(axes_before), GrowArrow(diagonal_before), GrowArrow(horizontal_before), run_time=1.7)
        assert_inside(stage_frame, beat_one)
        assert_scene_safe(head, title, beat_one)
        assert_no_overlap(head, title, beat_one, names=("head", "claim", "plane"))
        self.wait(9.2)

        title_two = claim(d, "Most vectors change both length and direction.", head)
        swap_claim(self, title, title_two)
        title = title_two
        watcher = watch_no_overlap(self, head, title, beat_one, names=("head", "claim", "moving plane"))
        self.play(
            Transform(grid_before, grid_after),
            Transform(axes_before, axes_after),
            Transform(diagonal_before, diagonal_after),
            Transform(horizontal_before, horizontal_after),
            run_time=2.0,
        )
        self.remove(watcher)
        self.play(FadeIn(diagonal_ghost), FadeIn(diagonal_label), run_time=0.55)
        beat_two = VGroup(grid_before, axes_before, diagonal_before, horizontal_before, diagonal_ghost, diagonal_label)
        assert_inside(stage_frame, beat_two)
        assert_scene_safe(head, title, beat_two)
        assert_no_overlap(head, title, beat_two, names=("head", "claim", "transformed plane"))
        self.wait(6.8)

        title_three = claim(d, "An eigenvector stays on the same line.", head)
        swap_claim(self, title, title_three)
        title = title_three
        self.play(
            FadeOut(grid_before), FadeOut(axes_before), FadeOut(diagonal_before),
            FadeOut(diagonal_ghost), FadeOut(diagonal_label), FadeIn(original_horizontal),
            FadeIn(eigen_label), FadeIn(payoff_dot), FadeIn(payoff_label),
            run_time=1.0,
        )
        beat_three = VGroup(horizontal_before, original_horizontal, eigen_label, payoff_dot, payoff_label)
        assert_inside(stage_frame, beat_three)
        assert_scene_safe(head, title, beat_three)
        assert_no_overlap(head, title, beat_three, names=("head", "claim", "invariant direction"))
        self.wait(8.5)

        title_four = claim(d, "The eigenvalue tells how that line is scaled.", head)
        swap_claim(self, title, title_four)
        title = title_four
        self.play(FadeOut(payoff_dot), FadeOut(payoff_label), FadeIn(equation), run_time=0.7)
        beat_four = VGroup(horizontal_before, original_horizontal, eigen_label, equation)
        assert_inside(stage_frame, beat_four)
        assert_scene_safe(head, title, beat_four)
        assert_no_overlap(head, title, beat_four, names=("head", "claim", "scaling relationship"))
        self.wait(10.6)
