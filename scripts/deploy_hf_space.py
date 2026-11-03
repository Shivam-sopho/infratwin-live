"""Deploy InfraTwin-Live to a Hugging Face Docker Space.

    HF_TOKEN=hf_... uv run --with huggingface_hub python scripts/deploy_hf_space.py <hf-username> [space-name]

Creates (or updates) the public Space <user>/<space-name>, stores MODEL_API_KEY from .env as a private Space
secret, sets runtime variables, and uploads the repository (minus secrets, local data and build output). The
Space builds the root Dockerfile, which downloads the real datasets from their original sources.
"""

import os
import sys
from pathlib import Path

from huggingface_hub import HfApi

ROOT = Path(__file__).resolve().parent.parent
IGNORE = [
    ".env", ".env.*", ".git/*", "**/node_modules/*", "**/.venv/*", "**/__pycache__/*", "**/.pytest_cache/*",
    "backend/data/*", "demo-media/*", "frontend/dist/*", "modal_workers/*", "**/.DS_Store",
]
SPACE_HEADER = """---
title: InfraTwin-Live
emoji: 🌉
colorFrom: blue
colorTo: gray
sdk: docker
app_port: 8000
pinned: false
short_description: Live structural-health digital twin with AI inspection
---

"""


def read_env(name: str) -> str:
    for line in (ROOT / ".env").read_text().splitlines():
        if line.startswith(f"{name}="):
            return line.split("=", 1)[1].strip()
    return ""


def main() -> None:
    user = sys.argv[1]
    space = sys.argv[2] if len(sys.argv) > 2 else "infratwin-live"
    repo_id = f"{user}/{space}"
    api = HfApi(token=os.environ["HF_TOKEN"])

    api.create_repo(repo_id, repo_type="space", space_sdk="docker", private=False, exist_ok=True)
    key = read_env("MODEL_API_KEY")
    if not key:
        sys.exit("MODEL_API_KEY missing in .env")
    api.add_space_secret(repo_id, "MODEL_API_KEY", key)
    for k, v in {"MAX_DAILY_USD": "10", "TRIAGE_AUTO": "true", "COOKIE_SECURE": "true"}.items():
        api.add_space_variable(repo_id, k, v)

    api.upload_folder(repo_id=repo_id, repo_type="space", folder_path=str(ROOT), ignore_patterns=IGNORE,
                      commit_message="Deploy InfraTwin-Live")
    readme = SPACE_HEADER + (ROOT / "README.md").read_text()
    api.upload_file(path_or_fileobj=readme.encode(), path_in_repo="README.md", repo_id=repo_id, repo_type="space",
                    commit_message="Space card")
    print(f"https://huggingface.co/spaces/{repo_id}")
    print(f"https://{user.lower()}-{space.lower()}.hf.space")


if __name__ == "__main__":
    main()
