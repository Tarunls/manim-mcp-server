from manim import *
import numpy as np


class GeneratedScene(Scene):
    def construct(self):
        self.camera.background_color = BLACK

        grid = VGroup()
        for y in np.linspace(-2.4, 2.4, 7):
            grid.add(Line(LEFT * 6.6 + UP * y, RIGHT * 6.6 + UP * y, color="#24445b", stroke_width=1.2, stroke_opacity=0.28))
        for x in np.linspace(-6.0, 6.0, 13):
            grid.add(Line(DOWN * 2.7 + RIGHT * x, UP * 2.7 + RIGHT * x, color="#24445b", stroke_width=1.0, stroke_opacity=0.18))

        zero = Line(LEFT * 6.6, RIGHT * 6.6, color="#6f91a6", stroke_width=2, stroke_opacity=0.38)
        phase = ValueTracker(0)

        def signal(x):
            p = phase.get_value()
            return 1.18 * np.sin(1.22 * x - p) + 0.56 * np.sin(2.8 * x - 1.75 * p + 0.7) + 0.28 * np.sin(5.1 * x - 2.6 * p - 0.4)

        glow = always_redraw(lambda: ParametricFunction(
            lambda t: np.array([t, signal(t), 0]),
            t_range=[-6.5, 6.5, 0.025],
            color="#22d3ee",
            stroke_width=15,
            stroke_opacity=0.13,
        ))
        wave = always_redraw(lambda: ParametricFunction(
            lambda t: np.array([t, signal(t), 0]),
            t_range=[-6.5, 6.5, 0.02],
            color="#8be9fd",
            stroke_width=5.5,
        ))
        spark = always_redraw(lambda: Dot(
            np.array([2.25, signal(2.25), 0]),
            radius=0.09,
            color="#fbbf24",
        ))

        self.add(grid, zero, glow, wave, spark)
        self.play(phase.animate.set_value(4 * PI), run_time=10, rate_func=linear)
