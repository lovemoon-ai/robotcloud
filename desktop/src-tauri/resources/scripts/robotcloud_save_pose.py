import json
import logging
import math
import os
import re
import statistics
import time
from collections import deque
from dataclasses import asdict, dataclass
from pathlib import Path
from pprint import pformat
from typing import Any

from lerobot.configs import parser
from lerobot.processor import make_default_processors
from lerobot.robots import RobotConfig, make_robot_from_config, so_follower  # noqa: F401
from lerobot.teleoperators import TeleoperatorConfig, make_teleoperator_from_config, so_leader  # noqa: F401
from lerobot.utils.import_utils import register_third_party_plugins
from lerobot.utils.robot_utils import precise_sleep
from lerobot.utils.utils import init_logging

HOLD_TIME_S = 3.0
STATIONARY_TOLERANCE = 1.0
EXPECTED_JOINT_COUNT = 6
SAVED_POSE_VERSION = 1


@dataclass
class SavePoseConfig:
    robot: RobotConfig
    teleop: TeleoperatorConfig
    fps: int = 30


def data_dir() -> Path:
    root = os.environ.get("ROBOTCLOUD_DATA_DIR")
    if root:
        return Path(root)
    if os.name == "nt":
        local_app_data = os.environ.get("LOCALAPPDATA")
        if local_app_data:
            return Path(local_app_data) / "RobotCloud" / "so101-data"
    return Path.home() / ".robotcloud" / "so101-data"


def safe_stem(value: str) -> str:
    stem = re.sub(r"[^A-Za-z0-9_.-]+", "_", value).strip("_.")
    return stem or "so101_follower"


def saved_pose_path(robot_id: str | None) -> Path:
    path = data_dir() / "saved_poses" / f"{safe_stem(robot_id or 'so101_follower')}.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


def numeric_action(action: dict[str, Any]) -> dict[str, float]:
    values: dict[str, float] = {}
    for key, value in action.items():
        if not key.endswith(".pos"):
            continue
        try:
            values[key] = float(value)
        except (TypeError, ValueError):
            continue
    if len(values) != EXPECTED_JOINT_COUNT:
        raise RuntimeError(
            f"Expected {EXPECTED_JOINT_COUNT} numeric '.pos' action fields, got {len(values)}."
        )
    return values


def action_distance(first: dict[str, float], second: dict[str, float]) -> float:
    if first.keys() != second.keys():
        return float("inf")
    return max(abs(second[key] - first[key]) for key in first)


def mean_pose(samples: deque[tuple[float, dict[str, float]]]) -> dict[str, float]:
    keys = sorted(samples[0][1].keys())
    return {
        key: statistics.fmean(sample[key] for _, sample in samples)
        for key in keys
    }


@parser.wrap()
def save_pose(cfg: SavePoseConfig) -> None:
    init_logging()
    logging.info(pformat(asdict(cfg)))

    robot = make_robot_from_config(cfg.robot)
    teleop = make_teleoperator_from_config(cfg.teleop)
    teleop_action_processor, robot_action_processor, _ = make_default_processors()
    samples: deque[tuple[float, dict[str, float]]] = deque()
    countdown_started_at: float | None = None
    countdown_reference: dict[str, float] | None = None
    last_action: dict[str, float] | None = None
    last_countdown_value: int | None = None

    try:
        robot.connect()
        teleop.connect()
        print("Teleoperation active. Use the leader to move the follower into the pose to save.")
        print(f"Hold still; the pose will be saved after a {HOLD_TIME_S:.0f}s countdown.")

        while True:
            start_loop_t = time.perf_counter()
            obs = robot.get_observation()
            action_values = teleop_action_processor((teleop.get_action(), obs))
            robot_action_to_send = robot_action_processor((action_values, obs))
            _ = robot.send_action(robot_action_to_send)
            action = numeric_action(action_values)
            now = time.perf_counter()

            moved_since_last = (
                last_action is not None and action_distance(last_action, action) > STATIONARY_TOLERANCE
            )
            last_action = action

            if moved_since_last:
                if countdown_started_at is not None and now - countdown_started_at >= 0.5:
                    print("Movement detected. Countdown reset.")
                countdown_started_at = None
                countdown_reference = None
                samples.clear()
                last_countdown_value = None
            else:
                if (
                    countdown_reference is not None
                    and action_distance(countdown_reference, action) > STATIONARY_TOLERANCE
                ):
                    print("Movement detected. Countdown reset.")
                    countdown_started_at = None
                    countdown_reference = None
                    samples.clear()
                    last_countdown_value = None

                if countdown_started_at is None:
                    countdown_started_at = now
                    countdown_reference = action
                    samples.clear()
                    last_countdown_value = None
                    print("Countdown started. Keep the leader still.")

                samples.append((now, action))
                elapsed_s = now - countdown_started_at
                countdown_value = math.ceil(max(HOLD_TIME_S - elapsed_s, 0.0))
                if countdown_value > 0 and countdown_value != last_countdown_value:
                    print(f"Saving pose in {countdown_value}...")
                    last_countdown_value = countdown_value

                if elapsed_s < HOLD_TIME_S:
                    dt_s = time.perf_counter() - start_loop_t
                    precise_sleep(max(1 / cfg.fps - dt_s, 0.0))
                    continue

                pose = mean_pose(samples)
                path = saved_pose_path(cfg.robot.id)
                payload = {
                    "version": SAVED_POSE_VERSION,
                    "robot_type": cfg.robot.type,
                    "robot_id": cfg.robot.id,
                    "teleop_type": cfg.teleop.type,
                    "teleop_id": cfg.teleop.id,
                    "source": "teleop_action",
                    "hold_time_s": HOLD_TIME_S,
                    "stationary_tolerance": STATIONARY_TOLERANCE,
                    "joint_count": len(pose),
                    "joints": pose,
                    "created_at": int(time.time()),
                }
                path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")
                print(f"Pose saved: {path}")
                return

            dt_s = time.perf_counter() - start_loop_t
            precise_sleep(max(1 / cfg.fps - dt_s, 0.0))
    finally:
        if teleop.is_connected:
            teleop.disconnect()
        if robot.is_connected:
            robot.disconnect()


def main() -> None:
    register_third_party_plugins()
    save_pose()


if __name__ == "__main__":
    main()
