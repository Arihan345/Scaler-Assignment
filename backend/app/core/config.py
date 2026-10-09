"""Runtime settings, read from environment variables with safe defaults."""
import os
from dataclasses import dataclass, field


def _csv(value: str) -> list[str]:
    return [v.strip() for v in value.split(",") if v.strip()]


@dataclass
class Settings:
    env: str = "dev"
    fixed_otp: str = "123456"  # mocked verification: no SMS, no real cryptography
    database_url: str = "sqlite:///./data/signal.db"
    upload_dir: str = "./uploads"
    cors_origins: list[str] = field(default_factory=lambda: ["*"])
    session_ttl_days: int = 30
    max_body_chars: int = 4000
    max_upload_bytes: int = 5 * 1024 * 1024
    max_avatar_bytes: int = 2 * 1024 * 1024
    seed_on_empty: bool = True
    run_background_tasks: bool = True
    sweeper_interval_s: float = 30.0
    webhook_poll_s: float = 2.0

    @property
    def is_dev(self) -> bool:
        return self.env == "dev"


def load_settings() -> Settings:
    return Settings(
        env=os.getenv("ENV", "dev"),
        fixed_otp=os.getenv("FIXED_OTP", "123456"),
        database_url=os.getenv("DATABASE_URL", "sqlite:///./data/signal.db"),
        upload_dir=os.getenv("UPLOAD_DIR", "./uploads"),
        cors_origins=_csv(os.getenv("CORS_ORIGINS", "*")) or ["*"],
    )


# Mutable on purpose: tests override fields before building the app.
settings = load_settings()
