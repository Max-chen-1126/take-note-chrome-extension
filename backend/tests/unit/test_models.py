import pytest
from app.agents.models import build_model, DEFAULT_MODELS, ProviderNotImplemented
from app.agents.tools import web_search_tools
from app.schemas.requests import Provider


def test_gemini_returns_plain_string():
    assert build_model(Provider.gemini, None) == DEFAULT_MODELS[Provider.gemini]


def test_non_gemini_not_implemented():
    with pytest.raises(ProviderNotImplemented):
        build_model(Provider.openai, None)


def test_web_search_only_gemini():
    assert web_search_tools(Provider.gemini, True)        # non-empty
    assert web_search_tools(Provider.openai, True) == []  # Phase B 才支援
    assert web_search_tools(Provider.gemini, False) == []
