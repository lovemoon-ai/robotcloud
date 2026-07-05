#!/usr/bin/env python
import json
import logging
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
from lerobot.robots import RobotConfig, make_robot_from_config, so_follower  # noqa: F401
from lerobot.teleoperators import TeleoperatorConfig, make_teleoperator_from_config, so_leader  # noqa: F401
from lerobot.utils.import_utils import register_third_party_plugins
from lerobot.utils.robot_utils import precise_sleep
from lerobot.utils.utils import init_logging


HOLD_TIME_S = 3.0
STATIONARY_TOLERANCE = 1.0
RESET_POSE_VERSION = 1


@dataclass
class ResetPoseConfig:
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


def reset_pose_path(robot_id: str | None) -> Path:
    path = data_dir() / "reset_poses" / f"{safe_stem(robot_id or 'so101_follower')}.json"
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
    if not values:
        raise RuntimeError("No numeric '.pos' action fields were read from the teleoperator.")
    return values


def max_window_span(samples: deque[tuple[float, dict[str, float]]]) -> float:
    keys = samples[0][1].keys()
    span = 0.0
    for key in keys:
        values = [sample[key] for _, sample in samples if key in sample]
        if len(values) != len(samples):
            return float("inf")
        span = max(span, max(values) - min(values))
    return span


def mean_pose(samples: deque[tuple[float, dict[str, float]]]) -> dict[str, float]:
    keys = sorted(samples[0][1].keys())
    return {
        key: statistics.fmean(sample[key] for _, sample in samples)
        for key in keys
    }


@parser.wrap()
def save_reset_pose(cfg: ResetPoseConfig) -> None:
    init_logging()
    logging.info(pformat(asdict(cfg)))

    robot = make_robot_from_config(cfg.robot)
    teleop = make_teleoperator_from_config(cfg.teleop)
    samples: deque[tuple[float, dict[str, float]]] = deque()

    try:
        robot.connect()
        teleop.connect()
        print(f"Hold the reset action still for {HOLD_TIME_S:.0f}s.")

        while True:
            start_loop_t = time.perf_counter()
            _ = robot.get_observation()
            action = numeric_action(teleop.get_action())
            now = time.perf_counter()
            samples.append((now, action))
            while samples and now - samples[0][0] > HOLD_TIME_S:
                samples.popleft()

            window_s = samples[-1][0] - samples[0][0] if len(samples) > 1 else 0.0
            if window_s >= HOLD_TIME_S and max_window_span(samples) <= STATIONARY_TOLERANCE:
                pose = mean_pose(samples)
                path = reset_pose_path(cfg.robot.id)
                payload = {
                    "version": RESET_POSE_VERSION,
                    "robot_type": cfg.robot.type,
                    "robot_id": cfg.robot.id,
                    "teleop_type": cfg.teleop.type,
                    "teleop_id": cfg.teleop.id,
                    "source": "teleop_action",
                    "hold_time_s": HOLD_TIME_S,
                    "stationary_tolerance": STATIONARY_TOLERANCE,
                    "joints": pose,
                    "created_at": int(time.time()),
                }
                path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")
                print(f"Reset action saved: {path}")
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
    save_reset_pose()


if __name__ == "__main__":
    main()
