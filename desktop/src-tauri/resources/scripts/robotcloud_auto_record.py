#!/usr/bin/env python
import inspect
import json
import logging
import os
import re
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path
from pprint import pformat
from typing import Any

from lerobot.cameras import CameraConfig  # noqa: F401
from lerobot.cameras.opencv.configuration_opencv import OpenCVCameraConfig  # noqa: F401
from lerobot.cameras.reachy2_camera.configuration_reachy2_camera import Reachy2CameraConfig  # noqa: F401
from lerobot.cameras.realsense.configuration_realsense import RealSenseCameraConfig  # noqa: F401
from lerobot.cameras.zmq.configuration_zmq import ZMQCameraConfig  # noqa: F401
from lerobot.configs import parser
from lerobot.configs.policies import PreTrainedConfig
from lerobot.datasets.image_writer import safe_stop_image_writer
from lerobot.datasets.lerobot_dataset import LeRobotDataset
from lerobot.datasets.pipeline_features import aggregate_pipeline_dataset_features, create_initial_features
from lerobot.datasets.utils import build_dataset_frame, combine_feature_dicts
from lerobot.datasets.video_utils import VideoEncodingManager
from lerobot.policies.factory import make_policy, make_pre_post_processors
from lerobot.policies.pretrained import PreTrainedPolicy
from lerobot.policies.utils import make_robot_action
from lerobot.processor import (
    PolicyAction,
    PolicyProcessorPipeline,
    RobotAction,
    RobotObservation,
    RobotProcessorPipeline,
    make_default_processors,
)
from lerobot.processor.rename_processor import rename_stats
from lerobot.robots import (
    Robot,
    RobotConfig,
    bi_openarm_follower,
    bi_so_follower,
    earthrover_mini_plus,
    hope_jr,
    koch_follower,
    make_robot_from_config,
    omx_follower,
    openarm_follower,
    reachy2,
    so_follower,
    unitree_g1 as unitree_g1_robot,
)  # noqa: F401
from lerobot.teleoperators import (
    Teleoperator,
    TeleoperatorConfig,
    bi_openarm_leader,
    bi_so_leader,
    homunculus,
    koch_leader,
    make_teleoperator_from_config,
    omx_leader,
    openarm_leader,
    reachy2_teleoperator,
    so_leader,
    unitree_g1,
)  # noqa: F401
from lerobot.utils.constants import ACTION, OBS_STR
from lerobot.utils.control_utils import (
    init_keyboard_listener,
    is_headless,
    predict_action,
    sanity_check_dataset_name,
    sanity_check_dataset_robot_compatibility,
)
from lerobot.utils.import_utils import register_third_party_plugins
from lerobot.utils.robot_utils import precise_sleep
from lerobot.utils.utils import get_safe_torch_device, init_logging, log_say
from lerobot.utils.visualization_utils import init_rerun, log_rerun_data


RESET_HOLD_TIME_S = 3.0
RESET_ACTION_TOLERANCE = 3.0


@dataclass
class DatasetAutoRecordConfig:
    repo_id: str
    single_task: str
    root: str | Path | None = None
    fps: int = 30
    num_episodes: int = 50
    video: bool = True
    push_to_hub: bool = True
    private: bool = False
    tags: list[str] | None = None
    num_image_writer_processes: int = 0
    num_image_writer_threads_per_camera: int = 4
    video_encoding_batch_size: int = 1
    vcodec: str = "libsvtav1"
    rename_map: dict[str, str] = field(default_factory=dict)
    streaming_encoding: bool = False
    encoder_threads: int | None = None

    def __post_init__(self) -> None:
        if self.single_task is None:
            raise ValueError("You need to provide a task as argument in `single_task`.")


@dataclass
class AutoRecordConfig:
    robot: RobotConfig
    dataset: DatasetAutoRecordConfig
    min_episode_time_s: int | float = 2
    max_episode_time_s: int | float = 60
    teleop: TeleoperatorConfig | None = None
    policy: PreTrainedConfig | None = None
    display_data: bool = False
    display_ip: str | None = None
    display_port: int | None = None
    display_compressed_images: bool = False
    play_sounds: bool = True
    resume: bool = False

    def __post_init__(self) -> None:
        policy_path = parser.get_path_arg("policy")
        if policy_path:
            cli_overrides = parser.get_cli_overrides("policy")
            self.policy = PreTrainedConfig.from_pretrained(policy_path, cli_overrides=cli_overrides)
            self.policy.pretrained_path = policy_path
        if self.teleop is None and self.policy is None:
            raise ValueError("Choose a policy, a teleoperator or both to control the robot")
        if self.min_episode_time_s < 0:
            raise ValueError("min_episode_time_s must be >= 0")
        if self.max_episode_time_s <= 0:
            raise ValueError("max_episode_time_s must be > 0")
        if self.max_episode_time_s < self.min_episode_time_s:
            raise ValueError("max_episode_time_s must be >= min_episode_time_s")

    @classmethod
    def __get_path_fields__(cls) -> list[str]:
        return ["policy"]


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
    return data_dir() / "reset_poses" / f"{safe_stem(robot_id or 'so101_follower')}.json"


def load_reset_action(robot_id: str | None) -> dict[str, float]:
    path = reset_pose_path(robot_id)
    if not path.exists():
        raise FileNotFoundError(f"Reset action file not found: {path}")
    payload = json.loads(path.read_text(encoding="utf-8"))
    joints = payload.get("joints")
    if not isinstance(joints, dict) or not joints:
        raise ValueError(f"Reset action file has no joints: {path}")
    return {str(key): float(value) for key, value in joints.items()}


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
        raise RuntimeError("No numeric '.pos' action fields were available.")
    return values


def near_reset(action: dict[str, Any], reset_action: dict[str, float]) -> bool:
    current = numeric_action(action)
    for key, reset_value in reset_action.items():
        if key not in current:
            return False
        if abs(current[key] - reset_value) > RESET_ACTION_TOLERANCE:
            return False
    return True


def supported_kwargs(fn: Any, kwargs: dict[str, Any]) -> dict[str, Any]:
    try:
        signature = inspect.signature(fn)
    except (TypeError, ValueError):
        return kwargs
    if any(param.kind == inspect.Parameter.VAR_KEYWORD for param in signature.parameters.values()):
        return kwargs
    return {key: value for key, value in kwargs.items() if key in signature.parameters}


def call_supported(fn: Any, *args: Any, **kwargs: Any) -> Any:
    return fn(*args, **supported_kwargs(fn, kwargs))


def get_action_values(
    robot: Robot,
    dataset: LeRobotDataset,
    teleop_action_processor: RobotProcessorPipeline[tuple[RobotAction, RobotObservation], RobotAction],
    robot_observation_processor: RobotProcessorPipeline[RobotObservation, RobotObservation],
    teleop: Teleoperator | None,
    policy: PreTrainedPolicy | None,
    preprocessor: PolicyProcessorPipeline[dict[str, Any], dict[str, Any]] | None,
    postprocessor: PolicyProcessorPipeline[PolicyAction, PolicyAction] | None,
    single_task: str | None,
) -> tuple[RobotObservation, RobotObservation, dict[str, Any], RobotAction]:
    obs = robot.get_observation()
    obs_processed = robot_observation_processor(obs)
    observation_frame = build_dataset_frame(dataset.features, obs_processed, prefix=OBS_STR)

    if policy is not None and preprocessor is not None and postprocessor is not None:
        action_values = predict_action(
            observation=observation_frame,
            policy=policy,
            device=get_safe_torch_device(policy.config.device),
            preprocessor=preprocessor,
            postprocessor=postprocessor,
            use_amp=policy.config.use_amp,
            task=single_task,
            robot_type=robot.robot_type,
        )
        return obs, obs_processed, observation_frame, make_robot_action(action_values, dataset.features)

    if teleop is not None:
        return obs, obs_processed, observation_frame, teleop_action_processor((teleop.get_action(), obs))

    raise RuntimeError("Auto recording requires a teleoperator or policy.")


def wait_until_leave_reset(
    robot: Robot,
    events: dict,
    fps: int,
    teleop_action_processor: RobotProcessorPipeline[tuple[RobotAction, RobotObservation], RobotAction],
    robot_action_processor: RobotProcessorPipeline[tuple[RobotAction, RobotObservation], RobotAction],
    robot_observation_processor: RobotProcessorPipeline[RobotObservation, RobotObservation],
    reset_action: dict[str, float],
    dataset: LeRobotDataset,
    teleop: Teleoperator | None,
    policy: PreTrainedPolicy | None,
    preprocessor: PolicyProcessorPipeline[dict[str, Any], dict[str, Any]] | None,
    postprocessor: PolicyProcessorPipeline[PolicyAction, PolicyAction] | None,
    single_task: str | None,
    display_data: bool,
    display_compressed_images: bool,
) -> None:
    while not events["stop_recording"]:
        start_loop_t = time.perf_counter()
        if events["exit_early"]:
            events["exit_early"] = False
            return

        obs, obs_processed, _observation_frame, action_values = get_action_values(
            robot=robot,
            dataset=dataset,
            teleop_action_processor=teleop_action_processor,
            robot_observation_processor=robot_observation_processor,
            teleop=teleop,
            policy=policy,
            preprocessor=preprocessor,
            postprocessor=postprocessor,
            single_task=single_task,
        )
        robot_action_to_send = robot_action_processor((action_values, obs))
        _ = robot.send_action(robot_action_to_send)

        if display_data:
            log_rerun_data(
                observation=obs_processed,
                action=action_values,
                compress_images=display_compressed_images,
            )

        if not near_reset(action_values, reset_action):
            return

        dt_s = time.perf_counter() - start_loop_t
        precise_sleep(max(1 / fps - dt_s, 0.0))


@safe_stop_image_writer
def auto_record_loop(
    robot: Robot,
    events: dict,
    fps: int,
    teleop_action_processor: RobotProcessorPipeline[tuple[RobotAction, RobotObservation], RobotAction],
    robot_action_processor: RobotProcessorPipeline[tuple[RobotAction, RobotObservation], RobotAction],
    robot_observation_processor: RobotProcessorPipeline[RobotObservation, RobotObservation],
    reset_action: dict[str, float],
    min_episode_time_s: float,
    max_episode_time_s: float,
    dataset: LeRobotDataset,
    teleop: Teleoperator | None = None,
    policy: PreTrainedPolicy | None = None,
    preprocessor: PolicyProcessorPipeline[dict[str, Any], dict[str, Any]] | None = None,
    postprocessor: PolicyProcessorPipeline[PolicyAction, PolicyAction] | None = None,
    single_task: str | None = None,
    display_data: bool = False,
    display_compressed_images: bool = False,
) -> str:
    if dataset.fps != fps:
        raise ValueError(f"The dataset fps should be equal to requested fps ({dataset.fps} != {fps}).")

    if policy is not None and preprocessor is not None and postprocessor is not None:
        policy.reset()
        preprocessor.reset()
        postprocessor.reset()

    reset_near_since: float | None = None
    pending_delimiter_frames: list[dict[str, Any]] = []
    start_episode_t = time.perf_counter()

    def flush_pending_delimiter_frames() -> None:
        for pending_frame in pending_delimiter_frames:
            dataset.add_frame(pending_frame)
        pending_delimiter_frames.clear()

    while True:
        start_loop_t = time.perf_counter()
        elapsed_s = start_loop_t - start_episode_t

        if events["exit_early"]:
            events["exit_early"] = False
            flush_pending_delimiter_frames()
            return "exit_early"

        obs, obs_processed, observation_frame, action_values = get_action_values(
            robot=robot,
            dataset=dataset,
            teleop_action_processor=teleop_action_processor,
            robot_observation_processor=robot_observation_processor,
            teleop=teleop,
            policy=policy,
            preprocessor=preprocessor,
            postprocessor=postprocessor,
            single_task=single_task,
        )

        robot_action_to_send = robot_action_processor((action_values, obs))
        _ = robot.send_action(robot_action_to_send)

        action_frame = build_dataset_frame(dataset.features, action_values, prefix=ACTION)
        dataset_frame = {**observation_frame, **action_frame, "task": single_task}

        if display_data:
            log_rerun_data(
                observation=obs_processed,
                action=action_values,
                compress_images=display_compressed_images,
            )

        now = time.perf_counter()
        if near_reset(action_values, reset_action):
            if reset_near_since is None:
                reset_near_since = now
            pending_delimiter_frames.append(dataset_frame)
        else:
            reset_near_since = None
            flush_pending_delimiter_frames()
            dataset.add_frame(dataset_frame)

        if (
            elapsed_s >= min_episode_time_s
            and reset_near_since is not None
            and now - reset_near_since >= RESET_HOLD_TIME_S
        ):
            pending_delimiter_frames.clear()
            return "reset_action"

        if elapsed_s >= max_episode_time_s:
            flush_pending_delimiter_frames()
            return "max_time"

        dt_s = time.perf_counter() - start_loop_t
        precise_sleep(max(1 / fps - dt_s, 0.0))


@parser.wrap()
def auto_record(cfg: AutoRecordConfig) -> LeRobotDataset:
    init_logging()
    logging.info(pformat(asdict(cfg)))
    reset_action = load_reset_action(cfg.robot.id)

    if cfg.display_data:
        init_rerun(session_name="auto_recording", ip=cfg.display_ip, port=cfg.display_port)
    display_compressed_images = (
        True
        if (cfg.display_data and cfg.display_ip is not None and cfg.display_port is not None)
        else cfg.display_compressed_images
    )

    robot = make_robot_from_config(cfg.robot)
    teleop = make_teleoperator_from_config(cfg.teleop) if cfg.teleop is not None else None
    teleop_action_processor, robot_action_processor, robot_observation_processor = make_default_processors()

    dataset_features = combine_feature_dicts(
        aggregate_pipeline_dataset_features(
            pipeline=teleop_action_processor,
            initial_features=create_initial_features(action=robot.action_features),
            use_videos=cfg.dataset.video,
        ),
        aggregate_pipeline_dataset_features(
            pipeline=robot_observation_processor,
            initial_features=create_initial_features(observation=robot.observation_features),
            use_videos=cfg.dataset.video,
        ),
    )

    dataset = None
    listener = None

    try:
        if cfg.resume:
            dataset = call_supported(
                LeRobotDataset,
                cfg.dataset.repo_id,
                root=cfg.dataset.root,
                batch_encoding_size=cfg.dataset.video_encoding_batch_size,
                vcodec=cfg.dataset.vcodec,
                streaming_encoding=cfg.dataset.streaming_encoding,
                encoder_threads=cfg.dataset.encoder_threads,
            )
            if hasattr(robot, "cameras") and len(robot.cameras) > 0:
                dataset.start_image_writer(
                    num_processes=cfg.dataset.num_image_writer_processes,
                    num_threads=cfg.dataset.num_image_writer_threads_per_camera * len(robot.cameras),
                )
            sanity_check_dataset_robot_compatibility(dataset, robot, cfg.dataset.fps, dataset_features)
        else:
            sanity_check_dataset_name(cfg.dataset.repo_id, cfg.policy)
            dataset = call_supported(
                LeRobotDataset.create,
                cfg.dataset.repo_id,
                cfg.dataset.fps,
                root=cfg.dataset.root,
                robot_type=robot.name,
                features=dataset_features,
                use_videos=cfg.dataset.video,
                image_writer_processes=cfg.dataset.num_image_writer_processes,
                image_writer_threads=cfg.dataset.num_image_writer_threads_per_camera * len(robot.cameras),
                batch_encoding_size=cfg.dataset.video_encoding_batch_size,
                vcodec=cfg.dataset.vcodec,
                streaming_encoding=cfg.dataset.streaming_encoding,
                encoder_threads=cfg.dataset.encoder_threads,
            )

        policy = None if cfg.policy is None else make_policy(cfg.policy, ds_meta=dataset.meta)
        preprocessor = None
        postprocessor = None
        if cfg.policy is not None:
            preprocessor, postprocessor = make_pre_post_processors(
                policy_cfg=cfg.policy,
                pretrained_path=cfg.policy.pretrained_path,
                dataset_stats=rename_stats(dataset.meta.stats, cfg.dataset.rename_map),
                preprocessor_overrides={
                    "device_processor": {"device": cfg.policy.device},
                    "rename_observations_processor": {"rename_map": cfg.dataset.rename_map},
                },
            )

        robot.connect()
        if teleop is not None:
            teleop.connect()

        listener, events = init_keyboard_listener()

        with VideoEncodingManager(dataset):
            recorded_episodes = 0
            while recorded_episodes < cfg.dataset.num_episodes and not events["stop_recording"]:
                log_say("Move away from reset action to start the next episode", cfg.play_sounds)
                wait_until_leave_reset(
                    robot=robot,
                    events=events,
                    fps=cfg.dataset.fps,
                    teleop_action_processor=teleop_action_processor,
                    robot_action_processor=robot_action_processor,
                    robot_observation_processor=robot_observation_processor,
                    reset_action=reset_action,
                    dataset=dataset,
                    teleop=teleop,
                    policy=policy,
                    preprocessor=preprocessor,
                    postprocessor=postprocessor,
                    single_task=cfg.dataset.single_task,
                    display_data=cfg.display_data,
                    display_compressed_images=display_compressed_images,
                )
                if events["stop_recording"]:
                    break

                log_say(f"Auto recording episode {dataset.num_episodes}", cfg.play_sounds)
                reason = auto_record_loop(
                    robot=robot,
                    events=events,
                    fps=cfg.dataset.fps,
                    teleop_action_processor=teleop_action_processor,
                    robot_action_processor=robot_action_processor,
                    robot_observation_processor=robot_observation_processor,
                    reset_action=reset_action,
                    min_episode_time_s=float(cfg.min_episode_time_s),
                    max_episode_time_s=float(cfg.max_episode_time_s),
                    teleop=teleop,
                    policy=policy,
                    preprocessor=preprocessor,
                    postprocessor=postprocessor,
                    dataset=dataset,
                    single_task=cfg.dataset.single_task,
                    display_data=cfg.display_data,
                    display_compressed_images=display_compressed_images,
                )

                if events["rerecord_episode"]:
                    log_say("Re-record episode", cfg.play_sounds)
                    events["rerecord_episode"] = False
                    events["exit_early"] = False
                    dataset.clear_episode_buffer()
                    continue

                if dataset.episode_buffer is not None and dataset.episode_buffer["size"] > 0:
                    log_say(f"Saving episode ({reason})", cfg.play_sounds)
                    dataset.save_episode()
                    recorded_episodes += 1
                else:
                    dataset.clear_episode_buffer()
    finally:
        log_say("Stop recording", cfg.play_sounds, blocking=True)
        if dataset:
            dataset.finalize()
        if robot.is_connected:
            robot.disconnect()
        if teleop and teleop.is_connected:
            teleop.disconnect()
        if not is_headless() and listener:
            listener.stop()
        if dataset and cfg.dataset.push_to_hub:
            dataset.push_to_hub(tags=cfg.dataset.tags, private=cfg.dataset.private)
        log_say("Exiting", cfg.play_sounds)
    return dataset


def main() -> None:
    register_third_party_plugins()
    auto_record()


if __name__ == "__main__":
    main()
