"""Thin ROS 2 adapter placeholder.

Run this only in a ROS 2 environment. Its callbacks should translate messages to
the REST event schema; business rules remain in FastAPI services.
"""

ROS_TOPICS = {
    "/perception/detection": "detection",
    "/perception/hazard": "hazard",
    "/mission/status": "status",
}


def to_event_payload(message: object) -> dict:
    """Adapter seam for ROS messages; replace with generated-message mapping."""
    return {name: getattr(message, name) for name in dir(message) if not name.startswith("_") and not callable(getattr(message, name))}
