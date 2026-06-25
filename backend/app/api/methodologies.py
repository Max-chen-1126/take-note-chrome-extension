from fastapi import APIRouter, Depends

from app.auth.middleware import verify_request
from app.store.firestore import list_methodologies

router = APIRouter()


@router.get("/methodologies")
def methodologies(_email: str = Depends(verify_request)):
    return list_methodologies()
