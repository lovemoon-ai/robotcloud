#!/usr/bin/env python
from __future__ import annotations

import argparse
import math
import os
import sys
import time
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np


DEFAULT_URDF_PATH = Path(
    "/Users/duino/ws/robotcloud/desktop/src-tauri/resources/assets/so101_new_calib.urdf"
)
DEFAULT_TARGET_FRAME = "gripper_frame_link"
DEFAULT_ARM_JOINTS = [
    "shoulder_pan",
    "shoulder_lift",
    "elbow_flex",
    "wrist_flex",
    "wrist_roll",
]


@dataclass(frozen=True)
class JointLimit:
    lower_rad: float | None
    upper_rad: float | None


@dataclass(frozen=True)
class UrdfJoint:
    name: str
    joint_type: str
    parent: str
    child: str
    xyz: np.ndarray
    rpy: np.ndarray
    axis: np.ndarray
    limit: JointLimit


@dataclass(frozen=True)
class CircleWaypoint:
    target_pos_m: np.ndarray
    joints_deg: dict[str, float]
    ik_error_m: float


@dataclass(frozen=True)
class PlanStats:
    duration_s: float
    max_joint_step_deg: float
    max_joint_speed_deg_s: float
    max_ik_error_m: float
    mean_ik_error_m: float


@dataclass(frozen=True)
class SendStats:
    limited_frames: int
    max_command_delta_deg: float


def parse_xyz(value: str | None, default: tuple[float, float, float]) -> np.ndarray:
    if not value:
        return np.array(default, dtype=float)
    parts = [float(part) for part in value.split()]
    if len(parts) != 3:
        raise ValueError(f"Expected a 3-vector, got: {value!r}")
    return np.array(parts, dtype=float)


def rpy_to_matrix(rpy: np.ndarray) -> np.ndarray:
    roll, pitch, yaw = rpy
    cr, sr = math.cos(roll), math.sin(roll)
    cp, sp = math.cos(pitch), math.sin(pitch)
    cy, sy = math.cos(yaw), math.sin(yaw)

    rx = np.array([[1, 0, 0], [0, cr, -sr], [0, sr, cr]], dtype=float)
    ry = np.array([[cp, 0, sp], [0, 1, 0], [-sp, 0, cp]], dtype=float)
    rz = np.array([[cy, -sy, 0], [sy, cy, 0], [0, 0, 1]], dtype=float)
    return rz @ ry @ rx


def axis_angle_to_matrix(axis: np.ndarray, angle_rad: float) -> np.ndarray:
    norm = float(np.linalg.norm(axis))
    if norm == 0.0:
        return np.eye(3, dtype=float)
    x, y, z = axis / norm
    c = math.cos(angle_rad)
    s = math.sin(angle_rad)
    one_c = 1.0 - c
    return np.array(
        [
            [c + x * x * one_c, x * y * one_c - z * s, x * z * one_c + y * s],
            [y * x * one_c + z * s, c + y * y * one_c, y * z * one_c - x * s],
            [z * x * one_c - y * s, z * y * one_c + x * s, c + z * z * one_c],
        ],
        dtype=float,
    )


def make_transform(rotation: np.ndarray, translation: np.ndarray) -> np.ndarray:
    transform = np.eye(4, dtype=float)
    transform[:3, :3] = rotation
    transform[:3, 3] = translation
    return transform


def origin_transform(joint: UrdfJoint) -> np.ndarray:
    return make_transform(rpy_to_matrix(joint.rpy), joint.xyz)


def revolute_transform(joint: UrdfJoint, angle_rad: float) -> np.ndarray:
    return make_transform(axis_angle_to_matrix(joint.axis, angle_rad), np.zeros(3, dtype=float))


class UrdfKinematics:
    def __init__(
        self,
        urdf_path: Path,
        target_frame_name: str = DEFAULT_TARGET_FRAME,
        joint_names: list[str] | None = None,
    ) -> None:
        self.urdf_path = urdf_path
        self.target_frame_name = target_frame_name
        self.joints_by_name = self._read_joints(urdf_path)
        self.chain = self._build_chain(target_frame_name)
        chain_joint_names = [
            joint.name
            for joint in self.chain
            if joint.joint_type in {"revolute", "continuous", "prismatic"}
        ]

        if joint_names is None:
            self.joint_names = chain_joint_names
        else:
            missing = [name for name in joint_names if name not in chain_joint_names]
            if missing:
                raise ValueError(
                    f"Joint(s) not on chain to {target_frame_name}: {', '.join(missing)}"
                )
            self.joint_names = joint_names

        if not self.joint_names:
            raise ValueError(f"No actuated joints found on chain to {target_frame_name}")

    @staticmethod
    def _read_joints(urdf_path: Path) -> dict[str, UrdfJoint]:
        if not urdf_path.exists():
            raise FileNotFoundError(f"URDF not found: {urdf_path}")

        root = ET.parse(urdf_path).getroot()
        joints: dict[str, UrdfJoint] = {}
        for joint_el in root.findall("joint"):
            name = joint_el.attrib["name"]
            joint_type = joint_el.attrib.get("type", "fixed")
            parent_el = joint_el.find("parent")
            child_el = joint_el.find("child")
            if parent_el is None or child_el is None:
                raise ValueError(f"Joint {name!r} is missing parent or child")

            origin_el = joint_el.find("origin")
            xyz = parse_xyz(origin_el.attrib.get("xyz") if origin_el is not None else None, (0, 0, 0))
            rpy = parse_xyz(origin_el.attrib.get("rpy") if origin_el is not None else None, (0, 0, 0))

            axis_el = joint_el.find("axis")
            axis = parse_xyz(axis_el.attrib.get("xyz") if axis_el is not None else None, (0, 0, 1))

            limit_el = joint_el.find("limit")
            lower = float(limit_el.attrib["lower"]) if limit_el is not None and "lower" in limit_el.attrib else None
            upper = float(limit_el.attrib["upper"]) if limit_el is not None and "upper" in limit_el.attrib else None

            joints[name] = UrdfJoint(
                name=name,
                joint_type=joint_type,
                parent=parent_el.attrib["link"],
                child=child_el.attrib["link"],
                xyz=xyz,
                rpy=rpy,
                axis=axis,
                limit=JointLimit(lower, upper),
            )
        return joints

    def _build_chain(self, target_frame_name: str) -> list[UrdfJoint]:
        joint_by_child = {joint.child: joint for joint in self.joints_by_name.values()}
        reversed_chain: list[UrdfJoint] = []
        link = target_frame_name
        while link in joint_by_child:
            joint = joint_by_child[link]
            reversed_chain.append(joint)
            link = joint.parent

        if not reversed_chain:
            raise ValueError(f"Could not find a URDF joint chain to {target_frame_name!r}")
        return list(reversed(reversed_chain))

    def joint_limits_deg(self) -> dict[str, tuple[float, float]]:
        limits: dict[str, tuple[float, float]] = {}
        for name in self.joint_names:
            joint = self.joints_by_name[name]
            lower = -math.inf if joint.limit.lower_rad is None else math.degrees(joint.limit.lower_rad)
            upper = math.inf if joint.limit.upper_rad is None else math.degrees(joint.limit.upper_rad)
            limits[name] = (lower, upper)
        return limits

    def forward_kinematics(self, joints_deg: dict[str, float]) -> np.ndarray:
        transform = np.eye(4, dtype=float)
        for joint in self.chain:
            transform = transform @ origin_transform(joint)
            if joint.joint_type in {"revolute", "continuous"}:
                angle_deg = float(joints_deg.get(joint.name, 0.0))
                transform = transform @ revolute_transform(joint, math.radians(angle_deg))
            elif joint.joint_type == "prismatic":
                distance = float(joints_deg.get(joint.name, 0.0))
                translation = make_transform(np.eye(3), joint.axis * distance)
                transform = transform @ translation
            elif joint.joint_type != "fixed":
                raise ValueError(f"Unsupported URDF joint type {joint.joint_type!r} on {joint.name}")
        return transform

    def ee_position(self, joints_deg: dict[str, float]) -> np.ndarray:
        return self.forward_kinematics(joints_deg)[:3, 3]

    def _vector_to_dict(self, values_deg: np.ndarray) -> dict[str, float]:
        return {name: float(values_deg[index]) for index, name in enumerate(self.joint_names)}

    def inverse_position(
        self,
        target_pos_m: np.ndarray,
        start_joints_deg: dict[str, float],
        *,
        max_iterations: int,
        tolerance_m: float,
        damping: float,
        regularization: float,
        max_step_deg: float,
    ) -> tuple[dict[str, float], float, int]:
        joint_count = len(self.joint_names)
        q = np.array([float(start_joints_deg[name]) for name in self.joint_names], dtype=float)
        q_ref = q.copy()
        limits = self.joint_limits_deg()
        lower = np.array([limits[name][0] for name in self.joint_names], dtype=float)
        upper = np.array([limits[name][1] for name in self.joint_names], dtype=float)
        eps_deg = 0.05

        for iteration in range(1, max_iterations + 1):
            q_dict = self._vector_to_dict(q)
            current_pos = self.ee_position(q_dict)
            error = target_pos_m - current_pos
            error_norm = float(np.linalg.norm(error))
            if error_norm <= tolerance_m:
                return q_dict, error_norm, iteration

            jacobian = np.zeros((3, joint_count), dtype=float)
            for index in range(joint_count):
                q_perturbed = q.copy()
                q_perturbed[index] += eps_deg
                pos_perturbed = self.ee_position(self._vector_to_dict(q_perturbed))
                jacobian[:, index] = (pos_perturbed - current_pos) / eps_deg

            lhs = np.vstack(
                [
                    jacobian,
                    math.sqrt(max(damping, 0.0)) * np.eye(joint_count),
                    math.sqrt(max(regularization, 0.0)) * np.eye(joint_count),
                ]
            )
            rhs = np.concatenate(
                [
                    error,
                    np.zeros(joint_count, dtype=float),
                    math.sqrt(max(regularization, 0.0)) * (q_ref - q),
                ]
            )
            delta_deg = np.linalg.lstsq(lhs, rhs, rcond=None)[0]
            step_norm = float(np.linalg.norm(delta_deg, ord=np.inf))
            if step_norm > max_step_deg:
                delta_deg *= max_step_deg / step_norm

            q_next = np.clip(q + delta_deg, lower, upper)
            if np.allclose(q_next, q, atol=1e-7):
                break
            q = q_next

        q_dict = self._vector_to_dict(q)
        error_norm = float(np.linalg.norm(target_pos_m - self.ee_position(q_dict)))
        return q_dict, error_norm, max_iterations


def plane_axes(plane: str, clockwise: bool) -> tuple[np.ndarray, np.ndarray]:
    axes = {
        "xy": (np.array([1.0, 0.0, 0.0]), np.array([0.0, 1.0, 0.0])),
        "xz": (np.array([1.0, 0.0, 0.0]), np.array([0.0, 0.0, 1.0])),
        "yz": (np.array([0.0, 1.0, 0.0]), np.array([0.0, 0.0, 1.0])),
    }
    first, second = axes[plane]
    return (first, -second) if clockwise else (first, second)


def parse_start_joints(value: str | None, joint_names: list[str]) -> dict[str, float]:
    if not value:
        return {name: 0.0 for name in joint_names}

    parts = [part.strip() for part in value.split(",") if part.strip()]
    if not parts:
        return {name: 0.0 for name in joint_names}

    if all("=" in part for part in parts):
        parsed: dict[str, float] = {}
        for part in parts:
            name, raw_value = part.split("=", 1)
            parsed[name.strip()] = float(raw_value.strip())
        missing = [name for name in joint_names if name not in parsed]
        if missing:
            raise ValueError(f"Missing start joint(s): {', '.join(missing)}")
        return {name: parsed[name] for name in joint_names}

    if len(parts) != len(joint_names):
        raise ValueError(
            f"Expected {len(joint_names)} comma-separated joint values, got {len(parts)}"
        )
    return {name: float(parts[index]) for index, name in enumerate(joint_names)}


def format_pos(pos: np.ndarray) -> str:
    return f"({pos[0]:+.4f}, {pos[1]:+.4f}, {pos[2]:+.4f}) m"


def clamp(value: float, lower: float, upper: float) -> float:
    return max(lower, min(value, upper))


def extract_current_joints(observation: dict[str, Any], joint_names: list[str]) -> dict[str, float]:
    joints: dict[str, float] = {}
    for name in joint_names:
        key = f"{name}.pos"
        if key not in observation:
            raise RuntimeError(f"Robot observation is missing {key!r}")
        joints[name] = float(observation[key])
    return joints


def extract_gripper(observation: dict[str, Any], override: float | None) -> float | None:
    if override is not None:
        return override
    if "gripper.pos" in observation:
        return float(observation["gripper.pos"])
    return None


def plan_circle(
    kinematics: UrdfKinematics,
    start_joints_deg: dict[str, float],
    *,
    radius_m: float,
    plane: str,
    clockwise: bool,
    period_s: float,
    cycles: int,
    fps: int,
    ik_tolerance_m: float,
    max_target_error_m: float,
    ik_max_iterations: int,
    ik_damping: float,
    ik_regularization: float,
    ik_max_step_deg: float,
    max_command_step_deg: float,
) -> list[CircleWaypoint]:
    if radius_m <= 0.0:
        raise ValueError("--radius-m must be positive")
    if cycles <= 0:
        raise ValueError("--cycles must be positive")
    if period_s <= 0.0:
        raise ValueError("--period-s must be positive")
    if fps <= 0:
        raise ValueError("--fps must be positive")

    first_axis, second_axis = plane_axes(plane, clockwise)
    start_pos = kinematics.ee_position(start_joints_deg)
    center = start_pos - radius_m * first_axis
    total_steps = max(3, int(round(period_s * cycles * fps)))
    waypoints: list[CircleWaypoint] = []
    seed_joints = dict(start_joints_deg)

    for step in range(total_steps + 1):
        theta = 2.0 * math.pi * cycles * step / total_steps
        target_pos = center + radius_m * (math.cos(theta) * first_axis + math.sin(theta) * second_axis)
        joints_deg, ik_error_m, _ = kinematics.inverse_position(
            target_pos,
            seed_joints,
            max_iterations=ik_max_iterations,
            tolerance_m=ik_tolerance_m,
            damping=ik_damping,
            regularization=ik_regularization,
            max_step_deg=ik_max_step_deg,
        )
        if ik_error_m > max_target_error_m:
            raise RuntimeError(
                f"IK target error {ik_error_m:.4f} m exceeds --max-target-error-m "
                f"at waypoint {step}/{total_steps}; target={format_pos(target_pos)}"
            )
        if waypoints:
            max_step = max(
                abs(joints_deg[name] - waypoints[-1].joints_deg[name])
                for name in kinematics.joint_names
            )
            if max_step > max_command_step_deg:
                raise RuntimeError(
                    f"Joint step {max_step:.2f} deg exceeds --max-command-step-deg "
                    f"at waypoint {step}/{total_steps}. Increase --period-s/--fps or reduce --radius-m."
                )
        waypoints.append(CircleWaypoint(target_pos, joints_deg, ik_error_m))
        seed_joints = joints_deg

    return waypoints


def plan_stats(kinematics: UrdfKinematics, waypoints: list[CircleWaypoint], fps: int) -> PlanStats:
    errors = [waypoint.ik_error_m for waypoint in waypoints]
    duration_s = (len(waypoints) - 1) / fps
    max_joint_step = 0.0
    for previous, current in zip(waypoints, waypoints[1:], strict=False):
        step = max(
            abs(current.joints_deg[name] - previous.joints_deg[name])
            for name in kinematics.joint_names
        )
        max_joint_step = max(max_joint_step, step)
    return PlanStats(
        duration_s=duration_s,
        max_joint_step_deg=max_joint_step,
        max_joint_speed_deg_s=max_joint_step * fps,
        max_ik_error_m=max(errors),
        mean_ik_error_m=float(np.mean(errors)),
    )


def print_plan_summary(kinematics: UrdfKinematics, waypoints: list[CircleWaypoint], fps: int) -> None:
    stats = plan_stats(kinematics, waypoints, fps)

    print(f"URDF: {kinematics.urdf_path}")
    print(f"Target frame: {kinematics.target_frame_name}")
    print(f"Joint chain: {', '.join(kinematics.joint_names)}")
    print(f"Waypoints: {len(waypoints)} ({stats.duration_s:.2f}s @ {fps} fps)")
    print(f"Start EE: {format_pos(waypoints[0].target_pos_m)}")
    print(f"IK error: max={stats.max_ik_error_m:.5f} m, mean={stats.mean_ik_error_m:.5f} m")
    print(
        f"Max joint step: {stats.max_joint_step_deg:.2f} deg "
        f"({stats.max_joint_speed_deg_s:.1f} deg/s @ {fps} fps)"
    )


def plan_circle_with_speed_limit(
    kinematics: UrdfKinematics,
    start_joints_deg: dict[str, float],
    args: argparse.Namespace,
) -> list[CircleWaypoint]:
    period_s = args.period_s
    for attempt in range(4):
        max_step_per_frame = args.max_joint_speed_deg_s / args.fps
        waypoints = plan_circle(
            kinematics,
            start_joints_deg,
            radius_m=args.radius_m,
            plane=args.plane,
            clockwise=args.clockwise,
            period_s=period_s,
            cycles=args.cycles,
            fps=args.fps,
            ik_tolerance_m=args.ik_tolerance_m,
            max_target_error_m=args.max_target_error_m,
            ik_max_iterations=args.ik_max_iterations,
            ik_damping=args.ik_damping,
            ik_regularization=args.ik_regularization,
            ik_max_step_deg=args.ik_max_step_deg,
            max_command_step_deg=max(args.max_command_step_deg, max_step_per_frame),
        )
        stats = plan_stats(kinematics, waypoints, args.fps)
        if not args.auto_slowdown or stats.max_joint_speed_deg_s <= args.max_joint_speed_deg_s:
            if period_s != args.period_s:
                print(f"Auto slowdown: using period {period_s:.2f}s per circle.")
            return waypoints

        next_period_s = period_s * (stats.max_joint_speed_deg_s / args.max_joint_speed_deg_s) * 1.1
        print(
            "Auto slowdown: planned max joint speed "
            f"{stats.max_joint_speed_deg_s:.1f} deg/s exceeds "
            f"{args.max_joint_speed_deg_s:.1f} deg/s; "
            f"increasing period {period_s:.2f}s -> {next_period_s:.2f}s."
        )
        period_s = next_period_s

    return waypoints


def wait_for_start(args: argparse.Namespace) -> None:
    if args.yes or args.dry_run:
        return
    print()
    print("The first waypoint is the current end-effector position, so the motion starts smoothly.")
    print("Check that the arm has clearance for the full circle, then press Enter to start.")
    input()


def send_waypoints(
    robot: Any,
    kinematics: UrdfKinematics,
    waypoints: list[CircleWaypoint],
    *,
    fps: int,
    gripper_pos: float | None,
    max_joint_speed_deg_s: float,
    closed_loop: bool,
) -> SendStats:
    start_time = time.perf_counter()
    period = 1.0 / fps
    max_delta_deg = max_joint_speed_deg_s / fps
    limited_frames = 0
    max_command_delta_deg = 0.0

    for index, waypoint in enumerate(waypoints):
        if closed_loop:
            observation = robot.get_observation()
            current_joints = extract_current_joints(observation, kinematics.joint_names)
            action = {}
            limited = False
            for name in kinematics.joint_names:
                delta = waypoint.joints_deg[name] - current_joints[name]
                command_delta = clamp(delta, -max_delta_deg, max_delta_deg)
                if abs(command_delta - delta) > 1e-6:
                    limited = True
                max_command_delta_deg = max(max_command_delta_deg, abs(command_delta))
                action[f"{name}.pos"] = current_joints[name] + command_delta
            if limited:
                limited_frames += 1
        else:
            action = {f"{name}.pos": waypoint.joints_deg[name] for name in kinematics.joint_names}
            if index > 0:
                previous = waypoints[index - 1].joints_deg
                max_command_delta_deg = max(
                    max_command_delta_deg,
                    max(abs(waypoint.joints_deg[name] - previous[name]) for name in kinematics.joint_names),
                )

        if gripper_pos is not None:
            action["gripper.pos"] = gripper_pos
        robot.send_action(action)

        next_time = start_time + (index + 1) * period
        sleep_s = next_time - time.perf_counter()
        if sleep_s > 0.0:
            time.sleep(sleep_s)

    return SendStats(limited_frames=limited_frames, max_command_delta_deg=max_command_delta_deg)


def make_robot(args: argparse.Namespace) -> Any:
    try:
        from lerobot.robots.so_follower import SO101Follower, SO101FollowerConfig
    except ImportError as exc:
        raise RuntimeError(
            "Could not import LeRobot SO101 support. Run this script with the bundled lerobot-env Python."
        ) from exc

    config = SO101FollowerConfig(
        port=args.follower_port,
        id=args.robot_id,
        max_relative_target=args.max_relative_target,
        disable_torque_on_disconnect=not args.keep_torque_on_disconnect,
        use_degrees=True,
    )
    return SO101Follower(config)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Move an SO101 follower end-effector in a circular path using the URDF for IK."
    )
    parser.add_argument("--follower-port", default=os.environ.get("SO101_FOLLOWER_PORT", ""))
    parser.add_argument("--robot-id", default="so101_follower")
    parser.add_argument(
        "--urdf",
        type=Path,
        default=Path(os.environ.get("SO101_URDF", DEFAULT_URDF_PATH)),
        help=f"SO101 URDF path. Default: {DEFAULT_URDF_PATH}",
    )
    parser.add_argument("--target-frame", default=DEFAULT_TARGET_FRAME)
    parser.add_argument("--radius-m", type=float, default=0.025)
    parser.add_argument("--period-s", type=float, default=6.0, help="Seconds per full circle.")
    parser.add_argument("--cycles", type=int, default=2)
    parser.add_argument("--fps", type=int, default=30)
    parser.add_argument("--plane", choices=["xy", "xz", "yz"], default="xy")
    parser.add_argument("--clockwise", action="store_true")
    parser.add_argument("--gripper-pos", type=float, default=None)
    parser.add_argument("--max-relative-target", type=float, default=5.0)
    parser.add_argument("--max-command-step-deg", type=float, default=5.0)
    parser.add_argument(
        "--max-joint-speed-deg-s",
        type=float,
        default=90.0,
        help="Closed-loop joint command speed cap. Lower values track more slowly but reduce servo clamping.",
    )
    parser.add_argument(
        "--auto-slowdown",
        action="store_true",
        help="Automatically increase --period-s when the planned joint speed is too high.",
    )
    parser.add_argument(
        "--open-loop-send",
        action="store_true",
        help="Send planned waypoints directly instead of rate-limiting against current motor positions.",
    )
    parser.add_argument("--ik-tolerance-m", type=float, default=0.002)
    parser.add_argument("--max-target-error-m", type=float, default=0.005)
    parser.add_argument("--ik-max-iterations", type=int, default=80)
    parser.add_argument("--ik-damping", type=float, default=1e-8)
    parser.add_argument("--ik-regularization", type=float, default=1e-9)
    parser.add_argument("--ik-max-step-deg", type=float, default=4.0)
    parser.add_argument(
        "--start-joints-deg",
        default=None,
        help=(
            "Dry-run start joints, either comma values in chain order or "
            "name=value pairs, e.g. shoulder_pan=0,shoulder_lift=-20,..."
        ),
    )
    parser.add_argument("--dry-run", action="store_true", help="Plan only; do not connect to hardware.")
    parser.add_argument("--yes", action="store_true", help="Skip the interactive start confirmation.")
    parser.add_argument(
        "--keep-torque-on-disconnect",
        action="store_true",
        help="Leave servo torque enabled after disconnecting.",
    )
    return parser


def main() -> int:
    args = build_parser().parse_args()
    kinematics = UrdfKinematics(args.urdf, args.target_frame, DEFAULT_ARM_JOINTS)

    if args.dry_run:
        start_joints_deg = parse_start_joints(args.start_joints_deg, kinematics.joint_names)
        waypoints = plan_circle_with_speed_limit(kinematics, start_joints_deg, args)
        print_plan_summary(kinematics, waypoints, args.fps)
        print("Dry run only; no hardware command was sent.")
        return 0

    if not args.follower_port:
        print("--follower-port is required unless --dry-run is set.", file=sys.stderr)
        return 2

    robot = make_robot(args)
    try:
        print(f"Connecting to SO101 follower on {args.follower_port}...")
        robot.connect()
        observation = robot.get_observation()
        start_joints_deg = extract_current_joints(observation, kinematics.joint_names)
        gripper_pos = extract_gripper(observation, args.gripper_pos)

        waypoints = plan_circle_with_speed_limit(kinematics, start_joints_deg, args)
        print_plan_summary(kinematics, waypoints, args.fps)
        wait_for_start(args)
        send_stats = send_waypoints(
            robot,
            kinematics,
            waypoints,
            fps=args.fps,
            gripper_pos=gripper_pos,
            max_joint_speed_deg_s=args.max_joint_speed_deg_s,
            closed_loop=not args.open_loop_send,
        )
        if not args.open_loop_send:
            print(
                "Closed-loop send: "
                f"limited_frames={send_stats.limited_frames}, "
                f"max_command_delta={send_stats.max_command_delta_deg:.2f} deg"
            )
        print("Circle motion complete.")
        return 0
    except KeyboardInterrupt:
        print("\nInterrupted; disconnecting robot.")
        return 130
    finally:
        if getattr(robot, "is_connected", False):
            robot.disconnect()


if __name__ == "__main__":
    raise SystemExit(main())
