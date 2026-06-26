from slowapi import Limiter
from slowapi.util import get_remote_address

# Shared limiter (per client IP). Lives in its own module so route modules and
# main.py can import it without a circular dependency. In-memory storage; under
# max-instances=1 this is effectively a global per-IP cap.
limiter = Limiter(key_func=get_remote_address)
