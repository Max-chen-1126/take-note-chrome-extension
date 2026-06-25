import os
from functools import lru_cache

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore", case_sensitive=False)

    google_cloud_project: str = "max-personal-447802"
    google_cloud_location: str = "global"
    google_genai_use_vertexai: bool = True
    allowed_emails: str = ""
    cloud_run_service_url: str = ""
    methodology_cache_ttl: int = 300
    max_content_chars: int = 600000
    min_content_chars: int = 200

    @property
    def allowed_email_set(self) -> set[str]:
        return {e.strip() for e in self.allowed_emails.split(",") if e.strip()}

    @model_validator(mode="after")
    def _require_audience_url_on_cloud_run(self) -> "Settings":
        # K_SERVICE 由 Cloud Run runtime 自動設定；本機/開發環境不存在，
        # 因此這個檢查只在實際部署到 Cloud Run 時生效，不影響本機與既有測試。
        if os.environ.get("K_SERVICE") and not self.cloud_run_service_url:
            raise ValueError(
                "CLOUD_RUN_SERVICE_URL must be set when running under Cloud Run "
                "(K_SERVICE is set) — required for ID token audience verification."
            )
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
