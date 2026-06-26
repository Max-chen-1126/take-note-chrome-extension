import pytest

from app.core.limiter import limiter


@pytest.fixture(autouse=True)
def _reset_rate_limiter():
    # The slowapi limiter uses module-global in-memory storage, so without this
    # rate-limit counts would leak across tests and cause order-dependent 429s.
    limiter.reset()
    yield
    limiter.reset()
