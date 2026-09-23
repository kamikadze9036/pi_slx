from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    database_url: str = "sqlite:///./dashboard.db"
    admin_api_key: str = "local-dev-only"
    mes_provider: str = "mock"
    site_timezone: str = "Europe/Prague"
    poll_seconds: int = 10
    ciclades_dsn: str = ""
    ciclades_mapping_file: str = ""
    euromap63_api_url: str = ""
    euromap63_frontend_url: str = ""
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

settings = Settings()
