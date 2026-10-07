from pathlib import Path
from typing import Literal

from pydantic import AliasChoices, Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_prefix="ATLAS_", extra="ignore", populate_by_name=True)
    project: str = "atlas-local"
    namespace: str = "atlas"
    database: str = ""
    storage: Literal["local", "gcs"] = "local"
    bucket: str = ""
    data_dir: Path = Path(".local/objects")
    provider: Literal["vertex", "offline"] = "vertex"
    vertex_project: str = Field(default="", validation_alias=AliasChoices("ATLAS_VERTEX_PROJECT", "GOOGLE_CLOUD_PROJECT"))
    vertex_location: str = Field(default="global", validation_alias=AliasChoices("ATLAS_VERTEX_LOCATION", "GOOGLE_CLOUD_LOCATION"))
    embedding_model: str = "gemini-embedding-2"
    answer_model: str = "gemini-3.5-flash-lite"
    dimensions: int = Field(default=768, ge=128, le=3072)
    jobs: Literal["local", "cloud-run"] = "local"
    job_name: str = ""
    public_url: str = "http://127.0.0.1:5178"
    max_upload_mb: int = Field(default=100, ge=1, le=2000)
    max_assets: int = Field(default=1000, ge=1, le=10000)
    max_chunks: int = Field(default=10000, ge=1, le=100000)
    max_file_chunks: int = Field(default=250, ge=1, le=1000)
    daily_ai_calls: int = Field(default=5000, ge=1)
    requests_per_minute: int = Field(default=90, ge=1)
    upload_sessions_per_day: int = Field(default=1000, ge=1)
    frontend_dir: Path = Path("frontend/dist")
    lease_seconds: int = Field(default=900, ge=120)

    @model_validator(mode="after")
    def validate_cloud(self):
        if self.storage == "gcs" and not self.bucket:
            raise ValueError("ATLAS_BUCKET is required for GCS")
        if self.jobs == "cloud-run" and (not self.job_name or self.storage != "gcs"):
            raise ValueError("Cloud Run Jobs require ATLAS_JOB_NAME and GCS storage")
        if self.provider == "offline" and self.jobs == "cloud-run":
            raise ValueError("Offline development provider cannot run in Cloud Run Jobs")
        return self
