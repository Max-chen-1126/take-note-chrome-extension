from fastapi import FastAPI
from app.api import health

app = FastAPI(title="take-note-backend")
app.include_router(health.router)
