export type TrainingModelParams = Record<string, string | number | boolean | string[] | number[]>;

export type TrainingModelDefaults = {
  learningRate: number;
  steps: number;
  batchSize: number;
  params: TrainingModelParams;
};

export type TrainingModelOption = {
  label: string;
  value: string;
  description: {
    en: string;
    zh: string;
  };
  requiresTask: boolean;
  defaults: TrainingModelDefaults;
};

const SO101_2_OR_3_CAMERA = "2_or_3_rgb_cameras";
const SO101_6DOF_JOINTS = "6dof_joint_state_action";

export const LEROBOT_TRAINING_MODELS: TrainingModelOption[] = [
  {
    label: "ACT",
    value: "ACT",
    description: {
      en: "Stable SO101 baseline for RGB cameras, 6DoF joint state, and 6DoF joint actions.",
      zh: "稳定的 SO101 基线，适配 RGB 相机、6DoF 关节状态和 6DoF 关节动作。"
    },
    requiresTask: false,
    defaults: {
      learningRate: 0.001,
      steps: 5000,
      batchSize: 16,
      params: {}
    }
  },
  {
    label: "Diffusion Policy",
    value: "DiffusionPolicy",
    description: {
      en: "Stable diffusion baseline for SO101 imitation learning with continuous joint actions.",
      zh: "稳定的 SO101 diffusion 基线，面向连续关节动作模仿学习。"
    },
    requiresTask: false,
    defaults: {
      learningRate: 0.0001,
      steps: 5000,
      batchSize: 16,
      params: {}
    }
  },
  {
    label: "MultiTaskDiT",
    value: "MultiTaskDiT",
    description: {
      en: "Multi-camera DiT policy. SO101 cameras should use matching image shapes.",
      zh: "多相机 DiT 策略。SO101 多路相机需要保持一致的图像 shape。"
    },
    requiresTask: false,
    defaults: {
      learningRate: 0.00002,
      steps: 10000,
      batchSize: 8,
      params: {
        "policy.n_obs_steps": 2,
        "policy.horizon": 32,
        "policy.n_action_steps": 24,
        "policy.image_resize_shape": [256, 256],
        "policy.image_crop_shape": [224, 224],
        "policy.use_separate_rgb_encoder_per_camera": true
      }
    }
  },
  {
    label: "MolmoAct2",
    value: "MolmoAct2",
    description: {
      en: "VLA policy with explicit SO100/SO101 support paths and 6DoF continuous action support.",
      zh: "带 SO100/SO101 兼容路径的 VLA 策略，支持 6DoF 连续动作训练。"
    },
    requiresTask: true,
    defaults: {
      learningRate: 0.00001,
      steps: 10000,
      batchSize: 2,
      params: {
        "policy.setup_type": "so101",
        "policy.control_mode": "joint_6dof",
        "policy.n_obs_steps": 1,
        "policy.chunk_size": 30,
        "policy.n_action_steps": 30
      }
    }
  },
  {
    label: "VLA-JEPA",
    value: "VLA-JEPA",
    description: {
      en: "Multi-view VLA policy. The default disables world-model loss for direct SO101 action training.",
      zh: "多视角 VLA 策略。默认关闭 world-model loss，优先直接训练 SO101 动作。"
    },
    requiresTask: false,
    defaults: {
      learningRate: 0.0001,
      steps: 10000,
      batchSize: 2,
      params: {
        "policy.n_obs_steps": 1,
        "policy.chunk_size": 7,
        "policy.n_action_steps": 7,
        "policy.enable_world_model": false
      }
    }
  },
  {
    label: "Pi0Fast",
    value: "Pi0Fast",
    description: {
      en: "FAST-tokenized Pi0 variant. It consumes SO101 state/action dimensions through tokenizer preprocessing.",
      zh: "FAST action tokenizer 版本 Pi0，通过 tokenizer 预处理消费 SO101 状态和动作维度。"
    },
    requiresTask: true,
    defaults: {
      learningRate: 0.000025,
      steps: 10000,
      batchSize: 2,
      params: {
        "policy.max_state_dim": 32,
        "policy.max_action_dim": 32,
        "policy.max_action_tokens": 256,
        "policy.empty_cameras": 0,
        "policy.chunk_size": 50,
        "policy.n_action_steps": 50
      }
    }
  },
  {
    label: "GR00T N1.7",
    value: "GR00T_N1.7",
    description: {
      en: "GR00T N1.7 fine-tuning preset for new SO101-style embodiments with padded 6DoF actions.",
      zh: "GR00T N1.7 微调预设，适合 SO101 这类新 embodiment，6DoF action 会 padding 到模型内部维度。"
    },
    requiresTask: true,
    defaults: {
      learningRate: 0.0001,
      steps: 10000,
      batchSize: 2,
      params: {
        "policy.embodiment_tag": "new_embodiment",
        "policy.chunk_size": 40,
        "policy.n_action_steps": 40,
        "policy.tune_llm": false,
        "policy.tune_visual": false,
        "policy.tune_projector": true,
        "policy.tune_diffusion_model": true
      }
    }
  },
  {
    label: "XVLA",
    value: "XVLA",
    description: {
      en: "Vision-language-action policy using proprioception and ee6d action mode for SO101.",
      zh: "使用 proprioception 和 ee6d action mode 的 VLA 策略，可适配 SO101。"
    },
    requiresTask: true,
    defaults: {
      learningRate: 0.0001,
      steps: 10000,
      batchSize: 2,
      params: {
        "policy.use_proprio": true,
        "policy.action_mode": "ee6d",
        "policy.max_state_dim": 32,
        "policy.max_action_dim": 20,
        "policy.empty_cameras": 0,
        "policy.chunk_size": 32,
        "policy.n_action_steps": 32
      }
    }
  },
  {
    label: "EO-1",
    value: "EO1",
    description: {
      en: "Qwen2.5-VL based action policy with padded SO101 state/action vectors.",
      zh: "基于 Qwen2.5-VL 的动作策略，SO101 state/action 会 padding 到内部维度。"
    },
    requiresTask: true,
    defaults: {
      learningRate: 0.0001,
      steps: 10000,
      batchSize: 1,
      params: {
        "policy.max_state_dim": 32,
        "policy.max_action_dim": 32,
        "policy.chunk_size": 8,
        "policy.n_action_steps": 8
      }
    }
  },
  {
    label: "WALL-OSS",
    value: "WALL-OSS",
    description: {
      en: "WALL-OSS VLA preset with SO101 6DoF state/action padding.",
      zh: "WALL-OSS VLA 预设，适配 SO101 6DoF state/action padding。"
    },
    requiresTask: true,
    defaults: {
      learningRate: 0.0001,
      steps: 10000,
      batchSize: 1,
      params: {
        "policy.max_state_dim": 20,
        "policy.max_action_dim": 20,
        "policy.chunk_size": 32,
        "policy.n_action_steps": 32
      }
    }
  },
  {
    label: "EVO1",
    value: "EVO1",
    description: {
      en: "VLA policy configured for up to three SO101 RGB camera views and padded 6DoF actions.",
      zh: "VLA 策略，默认支持最多 3 路 SO101 RGB 相机和 padding 后的 6DoF 动作。"
    },
    requiresTask: true,
    defaults: {
      learningRate: 0.0001,
      steps: 10000,
      batchSize: 1,
      params: {
        "policy.max_state_dim": 24,
        "policy.max_action_dim": 24,
        "policy.max_views": 3,
        "policy.empty_cameras": 0,
        "policy.image_resolution": [448, 448],
        "policy.chunk_size": 50,
        "policy.n_action_steps": 50
      }
    }
  },
  {
    label: "FastWAM",
    value: "FastWAM",
    description: {
      en: "World-action model preset for SO101 with action_dim=6, proprio_dim=6, and 2/3-camera image fusion.",
      zh: "面向 SO101 的 world-action model 预设，固定 action_dim=6、proprio_dim=6，并支持 2/3 相机图像融合。"
    },
    requiresTask: true,
    defaults: {
      learningRate: 0.0001,
      steps: 10000,
      batchSize: 1,
      params: {
        "policy.action_dim": 6,
        "policy.proprio_dim": 6,
        "policy.image_size": [224, 448],
        "policy.action_horizon": 32,
        "policy.n_action_steps": 32,
        "policy.num_video_frames": 33,
        "policy.action_video_freq_ratio": 4
      }
    }
  }
];

export const SO101_TRAINING_DATASET_PRESET = {
  cameras: SO101_2_OR_3_CAMERA,
  joints: SO101_6DOF_JOINTS
};

export function getTrainingModelOption(value: string): TrainingModelOption | undefined {
  return LEROBOT_TRAINING_MODELS.find((model) => model.value === value);
}

export function getTrainingModelDefaults(value: string): TrainingModelDefaults {
  return getTrainingModelOption(value)?.defaults ?? LEROBOT_TRAINING_MODELS[0].defaults;
}
