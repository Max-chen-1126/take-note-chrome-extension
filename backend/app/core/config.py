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
    max_body_bytes: int = 4_000_000   # 早期拒絕過大請求 body（413）
    expected_max_instances: int = 1   # 見 §rate limiter guard：in-memory limiter 僅在單一實例下正確

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

    @model_validator(mode="after")
    def _require_single_instance_for_in_memory_limiter(self) -> "Settings":
        # backend/app/core/limiter.py 用 slowapi 的 in-memory storage，只有在
        # 剛好一個 Cloud Run 實例時才是正確的 per-IP 上限。若要調高
        # max-instances，必須先把 limiter 換成分散式儲存（如
        # Redis/Memorystore），而不是默默調高這個值。
        if self.expected_max_instances != 1:
            raise ValueError(
                "expected_max_instances must stay 1 until the rate limiter is "
                "migrated off in-memory storage (see backend/app/core/limiter.py)."
            )
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
