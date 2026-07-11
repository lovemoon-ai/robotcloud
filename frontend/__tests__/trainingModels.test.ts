import { getTrainingModelDefaults, LEROBOT_TRAINING_MODELS } from "@/training/models";

describe("LeRobot training model options", () => {
  it("exposes SO101-compatible LeRobot training policies", () => {
    expect(LEROBOT_TRAINING_MODELS.map((model) => model.value)).toEqual([
      "ACT",
      "DiffusionPolicy",
      "Pi0",
      "Pi0.5",
      "SmolVLA",
      "MultiTaskDiT",
      "MolmoAct2",
      "VLA-JEPA",
      "Pi0Fast",
      "GR00T_N1.7",
      "XVLA",
      "EO1",
      "WALL-OSS",
      "EVO1",
      "FastWAM"
    ]);
  });

  it("keeps option values unique for form submission", () => {
    const values = LEROBOT_TRAINING_MODELS.map((model) => model.value);

    expect(new Set(values).size).toBe(values.length);
  });

  it("defines SO101 6DoF defaults for models that need explicit dimensions", () => {
    expect(getTrainingModelDefaults("FastWAM").params).toEqual(
      expect.objectContaining({
        "policy.action_dim": 6,
        "policy.proprio_dim": 6,
        "policy.image_size": [224, 448]
      })
    );
    expect(getTrainingModelDefaults("VLA-JEPA").params).toEqual(
      expect.objectContaining({
        "policy.enable_world_model": false,
        "policy.chunk_size": 7
      })
    );
    expect(getTrainingModelDefaults("EVO1").params).toEqual(
      expect.objectContaining({
        "policy.max_views": 3,
        "policy.max_action_dim": 24
      })
    );
  });
});
