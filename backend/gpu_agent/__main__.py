from __future__ import annotations

import logging
import os
from pathlib import Path

from dotenv import load_dotenv

from .agent import Agent
from .config import AgentConfig


def main() -> None:
    backend_root = Path(__file__).resolve().parents[1]
    repo_root = backend_root.parent
    env_file = os.getenv("ENV_FILE", ".env")
    load_dotenv(repo_root / env_file)
    
    level_name = os.getenv("AGENT_LOG_LEVEL", "INFO").upper()
    level = getattr(logging, level_name, logging.INFO)
    logging.basicConfig(
        level=level,
        format="[%(asctime)s] %(levelname)s %(name)s: %(message)s",
    )
    config = AgentConfig.from_env()
    agent = Agent(config)
    agent.start()


if __name__ == "__main__":
    main()
