from enum import Enum
from pydantic import BaseModel


class Category(str, Enum):
    article = "article"
    book = "book"
    podcast = "podcast"
    youtube = "youtube"
    coursera = "coursera"


class Mode(str, Enum):
    concise = "concise"
    detailed = "detailed"


class Provider(str, Enum):
    gemini = "gemini"
    openai = "openai"
    claude = "claude"


class Content(BaseModel):
    title: str = ""
    url: str = ""
    text: str
    metadata: dict | None = None


class NoteRequest(BaseModel):
    category: Category
    methodology_id: str
    mode: Mode
    direction: str = ""
    extra_requirements: str | None = None
    provider: Provider = Provider.gemini
    model: str | None = None
    web_search: bool = False
    content: Content
