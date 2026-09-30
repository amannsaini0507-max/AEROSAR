"""
Geodetic and Local ENU Coordinate Transformations & Geotagging Math.
Single origin of truth for both Python backend and JS client twin.
"""

import math
from typing import Tuple

# Disaster Simulation Arena Origin (Jaipur staging ground)
BASE_LAT: float = 26.9124
BASE_LON: float = 75.7873
BASE_ALT: float = 1.5

# Standard WGS84 spherical approximations for small areas (<10 km)
# 1 degree of latitude is ~111,320 meters
LAT_SCALE: float = 111320.0


def lon_scale_at(lat: float) -> float:
    """Computes meters per degree of longitude at a given latitude."""
    return LAT_SCALE * math.cos(math.radians(lat))


def geodetic_to_enu(
    lat: float,
    lon: float,
    alt: float = BASE_ALT,
    ref_lat: float = BASE_LAT,
    ref_lon: float = BASE_LON,
    ref_alt: float = BASE_ALT,
) -> Tuple[float, float, float]:
    """
    Converts Geodetic coordinates (lat, lon, alt) to Local ENU coordinates in meters.
    x = East (m), y = North (m), z = Up (m).
    """
    scale_lon = lon_scale_at(ref_lat)
    x = (lon - ref_lon) * scale_lon
    y = (lat - ref_lat) * LAT_SCALE
    z = alt - ref_alt
    return x, y, z


def enu_to_geodetic(
    x: float,
    y: float,
    z: float = 0.0,
    ref_lat: float = BASE_LAT,
    ref_lon: float = BASE_LON,
    ref_alt: float = BASE_ALT,
) -> Tuple[float, float, float]:
    """
    Converts Local ENU coordinates (x=East, y=North, z=Up) back to Geodetic coordinates.
    Returns (lat, lon, alt).
    """
    scale_lon = lon_scale_at(ref_lat)
    lat = ref_lat + (y / LAT_SCALE)
    lon = ref_lon + (x / scale_lon)
    alt = ref_alt + z
    return lat, lon, alt


def geo_distance_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """
    Equirectangular surface distance in meters between two geocoordinates.
    High accuracy and ultra-low compute for tactical SAR scale (< 5 km).
    """
    avg_lat = (lat1 + lat2) / 2.0
    scale_lon = lon_scale_at(avg_lat)
    dy = (lat2 - lat1) * LAT_SCALE
    dx = (lon2 - lon1) * scale_lon
    return math.hypot(dx, dy)


def geotag_detection(
    drone_lat: float,
    drone_lon: float,
    drone_alt: float,
    heading_deg: float,
    bbox_x_norm: float = 0.5,
    bbox_y_norm: float = 0.5,
    camera_fov_deg: float = 60.0,
    aspect_ratio: float = 4.0 / 3.0,
) -> Tuple[float, float]:
    """
    Projects a camera bounding box center to ground plane coordinates (z=0)
    using drone altitude, heading, and pinhole camera geometry.
    bbox_x_norm, bbox_y_norm in [0, 1], where (0.5, 0.5) is optical center (nadir).
    """
    # Offset from image center (-0.5 to +0.5)
    cx = bbox_x_norm - 0.5
    cy = bbox_y_norm - 0.5

    # Angles relative to camera bore-sight
    fov_h_rad = math.radians(camera_fov_deg)
    fov_v_rad = fov_h_rad / aspect_ratio

    # Lateral offsets in camera frame (ground distance assuming downward-looking camera)
    dx_cam = math.tan(cx * fov_h_rad) * drone_alt
    dy_cam = -math.tan(cy * fov_v_rad) * drone_alt

    # Rotate into ENU frame using drone yaw heading (0 deg = North, 90 deg = East)
    yaw_rad = math.radians(heading_deg)
    cos_yaw = math.cos(yaw_rad)
    sin_yaw = math.sin(yaw_rad)

    # In drone frame: +X forward (North when yaw=0), +Y right (East when yaw=0)
    # Camera: dx_cam is right, dy_cam is forward
    east_offset = dy_cam * sin_yaw + dx_cam * cos_yaw
    north_offset = dy_cam * cos_yaw - dx_cam * sin_yaw

    scale_lon = lon_scale_at(drone_lat)
    target_lat = drone_lat + (north_offset / LAT_SCALE)
    target_lon = drone_lon + (east_offset / scale_lon)
    return target_lat, target_lon
