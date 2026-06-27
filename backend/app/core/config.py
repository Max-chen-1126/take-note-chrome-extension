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
    oauth_client_id: str = ""           # app 層認證：ID token 的預期 audience
    cloud_run_service_url: str = ""     # 保留相容；0.1.0 app 層認證不再用於 audience
    methodology_cache_ttl: int = 300
    max_content_chars: int = 600000
    min_content_chars: int = 200

    @property
    def allowed_email_set(self) -> set[str]:
        return {e.strip() for e in self.allowed_emails.split(",") if e.strip()}

    @model_validator(mode="after")
    def _require_oauth_client_id_on_cloud_run(self) -> "Settings":
        # K_SERVICE 由 Cloud Run runtime 自動設定；本機/開發環境不存在，
        # 因此這個檢查只在實際部署到 Cloud Run 時生效，不影響本機與既有測試。
        # 0.1.0 app 層認證：audience = OAuth client_id；缺它則 audience 檢查會被
        # 停用（verify_oauth2_token(audience=None)），等於門戶大開，故部署時必填。
        if os.environ.get("K_SERVICE") and not self.oauth_client_id:
            raise ValueError(
                "OAUTH_CLIENT_ID must be set when running under Cloud Run "
                "(K_SERVICE is set) — required for ID token audience verification."
            )
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
