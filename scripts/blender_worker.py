"""Render a constrained JSON scene description without executing project-authored Python."""

import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector


def vector(value, fallback):
    return tuple(float(part) for part in (value or fallback)[:3])


def material(name, color):
    item = bpy.data.materials.new(name)
    rgba = list(color or [0.35, 0.42, 0.39, 1])[:4]
    while len(rgba) < 4:
        rgba.append(1)
    item.diffuse_color = tuple(float(part) for part in rgba)
    return item


def look_at(obj, target):
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat("-Z", "Y").to_euler()


def main():
    separator = sys.argv.index("--")
    spec_path = Path(sys.argv[separator + 1]).resolve()
    output = Path(sys.argv[separator + 2]).resolve()
    spec = json.loads(spec_path.read_text(encoding="utf-8"))
    bpy.ops.wm.read_factory_settings(use_empty=True)

    world = bpy.data.worlds.new("World")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = tuple(spec.get("worldColor", [0.035, 0.04, 0.038, 1]))
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = float(spec.get("worldStrength", 0.35))
    bpy.context.scene.world = world

    for index, item in enumerate(spec.get("objects", [])):
        primitive = item.get("primitive", "cube")
        if primitive == "sphere":
            bpy.ops.mesh.primitive_uv_sphere_add(segments=48, ring_count=24)
        elif primitive == "cylinder":
            bpy.ops.mesh.primitive_cylinder_add(vertices=48)
        elif primitive == "plane":
            bpy.ops.mesh.primitive_plane_add(size=2)
        elif primitive == "text":
            bpy.ops.object.text_add()
            bpy.context.object.data.body = str(item.get("text", "Text"))[:240]
            bpy.context.object.data.align_x = "CENTER"
            bpy.context.object.data.align_y = "CENTER"
            bpy.context.object.data.extrude = float(item.get("extrude", 0.03))
        else:
            bpy.ops.mesh.primitive_cube_add()
        obj = bpy.context.object
        obj.name = str(item.get("name", f"Object {index + 1}"))[:63]
        obj.location = vector(item.get("location"), [0, 0, 0])
        obj.scale = vector(item.get("scale"), [1, 1, 1])
        obj.rotation_euler = tuple(math.radians(value) for value in vector(item.get("rotation"), [0, 0, 0]))
        obj.data.materials.append(material(f"Material {index + 1}", item.get("color")))
        for keyframe in item.get("keyframes", []):
            frame = max(1, int(keyframe.get("frame", 1)))
            if "location" in keyframe:
                obj.location = vector(keyframe["location"], obj.location)
                obj.keyframe_insert(data_path="location", frame=frame)
            if "rotation" in keyframe:
                obj.rotation_euler = tuple(math.radians(value) for value in vector(keyframe["rotation"], [0, 0, 0]))
                obj.keyframe_insert(data_path="rotation_euler", frame=frame)
            if "scale" in keyframe:
                obj.scale = vector(keyframe["scale"], obj.scale)
                obj.keyframe_insert(data_path="scale", frame=frame)

    for index, item in enumerate(spec.get("lights", [{"type": "AREA", "location": [4, -4, 6], "energy": 1200, "size": 5}])):
        data = bpy.data.lights.new(f"Light {index + 1}", type=str(item.get("type", "AREA")))
        data.energy = float(item.get("energy", 1000))
        data.color = vector(item.get("color"), [1, 0.95, 0.9])
        if data.type == "AREA":
            data.shape = "DISK"
            data.size = float(item.get("size", 5))
        light = bpy.data.objects.new(data.name, data)
        light.location = vector(item.get("location"), [4, -4, 6])
        bpy.context.collection.objects.link(light)
        look_at(light, vector(item.get("target"), [0, 0, 0]))

    camera_data = bpy.data.cameras.new("Camera")
    camera = bpy.data.objects.new("Camera", camera_data)
    camera.location = vector(spec.get("camera", {}).get("location"), [0, -8, 4])
    camera_data.lens = float(spec.get("camera", {}).get("lens", 50))
    look_at(camera, vector(spec.get("camera", {}).get("target"), [0, 0, 0]))
    bpy.context.collection.objects.link(camera)
    bpy.context.scene.camera = camera

    render = bpy.context.scene.render
    render.engine = "BLENDER_EEVEE_NEXT"
    render.resolution_x = int(spec["width"])
    render.resolution_y = int(spec["height"])
    render.resolution_percentage = 100
    render.fps = int(spec["fps"])
    bpy.context.scene.frame_start = 1
    bpy.context.scene.frame_end = max(1, int(spec["frames"]))
    render.image_settings.file_format = "FFMPEG"
    render.ffmpeg.format = "MPEG4"
    render.ffmpeg.codec = "H264"
    render.ffmpeg.constant_rate_factor = "HIGH"
    render.filepath = str(output)
    bpy.ops.render.render(animation=True)


if __name__ == "__main__":
    main()
