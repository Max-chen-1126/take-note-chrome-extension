from functools import lru_cache
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


@lru_cache
def get_settings() -> Settings:
    return Settings()
