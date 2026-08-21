from manim import *
import numpy as np


class GeneratedScene(Scene):
    def construct(self):
        self.camera.background_color = BLACK
        clock = ValueTracker(0)
        origin = LEFT * 2.7
        radii = [1.5, 0.78, 0.42]
        rates = [1.0, 2.7, 4.8]
        phases = [0.0, 0.7, -0.5]
        colors = ["#67e8f9", "#fb7185", "#fbbf24"]

        def points_at(t):
            points = [origin]
            point = origin.copy()
            for radius, rate, offset in zip(radii, rates, phases):
                point = point + radius * np.array([np.cos(rate * t + offset), np.sin(rate * t + offset), 0])
                points.append(point.copy())
            return points

        circles = always_redraw(lambda: VGroup(*[
            Circle(radius=radii[i], color=colors[i], stroke_width=2.2, stroke_opacity=0.28).move_to(points_at(clock.get_value())[i])
            for i in range(3)
        ]))

        arrows = always_redraw(lambda: VGroup(*[
            Arrow(
                points_at(clock.get_value())[i],
                points_at(clock.get_value())[i + 1],
                buff=0,
                color=colors[i],
                stroke_width=5,
                max_tip_length_to_length_ratio=0.14,
            )
            for i in range(3)
        ]))

        endpoint = always_redraw(lambda: Dot(points_at(clock.get_value())[-1], radius=0.085, color="#f8fafc"))
        guide = always_redraw(lambda: DashedLine(
            points_at(clock.get_value())[-1],
            np.array([5.8, points_at(clock.get_value())[-1][1], 0]),
            color="#8be9fd",
            stroke_width=2,
            dash_length=0.12,
            stroke_opacity=0.5,
        ))

        def trail():
            t = clock.get_value()
            samples = np.linspace(max(0, t - 2.8), t, 170)
            curve = VMobject(color="#8be9fd", stroke_width=4.5)
            coords = []
            for sample in samples:
                end = points_at(sample)[-1]
                x = 5.8 - (t - sample) * 2.25
                coords.append(np.array([x, end[1], 0]))
            if len(coords) > 1:
                curve.set_points_smoothly(coords)
            return curve

        trace = always_redraw(trail)
        axis = Line(RIGHT * 0.1 + DOWN * 2.7, RIGHT * 0.1 + UP * 2.7, color="#38556a", stroke_width=1.5, stroke_opacity=0.5)

        self.add(axis, circles, arrows, guide, trace, endpoint)
        self.play(clock.animate.set_value(2 * PI), run_time=10, rate_func=linear)
