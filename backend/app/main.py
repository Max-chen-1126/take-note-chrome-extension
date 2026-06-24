from fastapi import FastAPI
from app.api import health, methodologies, notes

app = FastAPI(title="take-note-backend")
app.include_router(health.router)
app.include_router(methodologies.router)
app.include_router(notes.router)
