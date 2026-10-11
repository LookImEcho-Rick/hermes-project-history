"""Native authenticated dashboard routes for project history."""
import importlib.util
from pathlib import Path
import sys

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response
from hermes_constants import get_hermes_home

_spec = importlib.util.spec_from_file_location("local_ai_project_history", Path(__file__).with_name("history.py"))
_store = importlib.util.module_from_spec(_spec)
sys.modules[_spec.name] = _store
_spec.loader.exec_module(_store)
router = APIRouter()


def invoke(method, *args, **kwargs):
    try:
        return getattr(_store.History(get_hermes_home()), method)(*args, **kwargs)
    except FileNotFoundError as exc:
        raise HTTPException(404, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    except (OSError, RuntimeError, _store.sqlite3.Error) as exc:
        raise HTTPException(503, "Project history needs attention: " + str(exc)) from exc


@router.get("/status")
def status():
    return invoke("status")


@router.get("/search")
def search(q: str = Query("", max_length=300), kind: str = "all"):
    return invoke("search", q, kind)


@router.post("/refresh")
def refresh():
    return invoke("refresh")


@router.get("/source/{source_id}")
def source(source_id: str):
    return invoke("source", source_id)


@router.get("/link/{source_id}")
def link(source_id: str, href: str = Query(..., max_length=2048)):
    return invoke("resolve_link", source_id, href)


@router.get("/image/{source_id}")
def image(source_id: str, href: str = Query(..., max_length=2048)):
    path = invoke("linked_file", source_id, href, image=True)
    return Response(path.read_bytes(), media_type=_store.IMAGE_TYPES[path.suffix.lower()], headers={"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"})


@router.get("/gallery")
def gallery(session: str = Query(..., min_length=1, max_length=200)):
    return invoke("gallery", session)


@router.get("/gallery/image/{image_id}")
def gallery_image(image_id: str, session: str = Query(..., min_length=1, max_length=200)):
    path = invoke("gallery_image", session, image_id)
    return Response(path.read_bytes(), media_type=_store.IMAGE_TYPES[path.suffix.lower()], headers={"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"})
