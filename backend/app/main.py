from fastapi import FastAPI
from app.api import health, methodologies

app = FastAPI(title="take-note-backend")
app.include_router(health.router)
app.include_router(methodologies.router)
