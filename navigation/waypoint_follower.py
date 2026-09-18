"""
AEROSAR Waypoint Follower & Coordinate Geometry Controller
Member 3 — Autonomous Navigation / SLAM Lead
SIH 2026 — PS 26177

Implements:
- GPS (WGS-84) to local metric Cartesian coordinates (ENU)
- IMU Quaternion to Euler Heading (Yaw) extraction
- Closed-loop proportional-integral guidance controller for waypoint following
- Acceptance radius detection and automatic sequential waypoint advancement
"""

import math
from typing import List, Tuple, Optional
try:
    from geometry_msgs.msg import Twist
except ImportError:
    class Vector3:
        def __init__(self, x: float = 0.0, y: float = 0.0, z: float = 0.0):
            self.x = float(x)
            self.y = float(y)
            self.z = float(z)

        def __repr__(self) -> str:
            return f"Vector3(x={self.x:.2f}, y={self.y:.2f}, z={self.z:.2f})"

    class Twist:
        def __init__(self):
            self.linear = Vector3()
            self.angular = Vector3()

        def __repr__(self) -> str:
            return f"Twist(linear={self.linear}, angular={self.angular})"



def clamp(val: float, min_val: float, max_val: float) -> float:
    """Clamps val within [min_val, max_val]."""
    return max(min_val, min(val, max_val))


def normalize_angle(angle: float) -> float:
    """Normalizes an angle in radians to [-pi, pi]."""
    return (angle + math.pi) % (2.0 * math.pi) - math.pi


def quaternion_to_yaw(x: float, y: float, z: float, w: float) -> float:
    """
    Extracts yaw (heading) angle in radians from orientation quaternion (x, y, z, w).
    Returns value in [-pi, pi].
    """
    siny_cosp = 2.0 * (w * z + x * y)
    cosy_cosp = 1.0 - 2.0 * (y * y + z * z)
    return math.atan2(siny_cosp, cosy_cosp)


class CoordinateTransformer:
    """
    Translates between GNSS (WGS-84 lat, lon, alt) and local Cartesian metric frame (x, y, z).
    Default reference datum matches Member 1 Webots world origin:
    lat_0 = 26.9124, lon_0 = 75.7873
    """

    METERS_PER_DEGREE_LAT = 111111.0

    def __init__(self, lat_0: float = 26.9124, lon_0: float = 75.7873, alt_0: float = 0.0):
        self.lat_0 = lat_0
        self.lon_0 = lon_0
        self.alt_0 = alt_0
        self._cos_lat0 = math.cos(math.radians(self.lat_0))
        self.is_anchored = True

    def set_datum(self, lat_0: float, lon_0: float, alt_0: float = 0.0):
        """Sets or recalibrates the local metric origin datum."""
        self.lat_0 = lat_0
        self.lon_0 = lon_0
        self.alt_0 = alt_0
        self._cos_lat0 = math.cos(math.radians(self.lat_0))
        self.is_anchored = True

    def gps_to_local(self, lat: float, lon: float, alt: float) -> Tuple[float, float, float]:
        """
        Converts GNSS (lat, lon, alt) to local (x, y, z) in meters.
        East is +X, North is +Y, Up is +Z.
        """
        dx = (lon - self.lon_0) * (self.METERS_PER_DEGREE_LAT * self._cos_lat0)
        dy = (lat - self.lat_0) * self.METERS_PER_DEGREE_LAT
        dz = alt - self.alt_0
        return dx, dy, dz

    def local_to_gps(self, x: float, y: float, z: float) -> Tuple[float, float, float]:
        """
        Converts local (x, y, z) in meters to GNSS (lat, lon, alt).
        """
        lon = self.lon_0 + (x / (self.METERS_PER_DEGREE_LAT * self._cos_lat0))
        lat = self.lat_0 + (y / self.METERS_PER_DEGREE_LAT)
        alt = self.alt_0 + z
        return lat, lon, alt


class Waypoint:
    """Represents a 3D target waypoint with acceptance tolerance."""

    def __init__(self, x: float, y: float, z: float = 1.5, radius: float = 0.5):
        self.x = float(x)
        self.y = float(y)
        self.z = float(z)
        self.radius = float(radius)

    def __repr__(self) -> str:
        return f"Waypoint(x={self.x:.2f}, y={self.y:.2f}, z={self.z:.2f}, r={self.radius:.2f})"


class WaypointFollower:
    """
    Controller executing smooth waypoint tracking via geometry_msgs/Twist commands.
    Outputs velocity commands compatible with Member 1's Webots drone driver.
    """

    def __init__(
        self,
        waypoints: Optional[List[Waypoint]] = None,
        kp_yaw: float = 1.0,
        kp_dist: float = 0.6,
        kp_z: float = 1.2,
        max_linear_x: float = 0.8,
        min_linear_x: float = 0.1,
        max_angular_z: float = 0.6,
        max_linear_z: float = 0.4,
        heading_tolerance: float = 0.35,  # ~20 degrees
        yaw_sign: float = -1.0             # Invert to match drone_driver.py disturbance sign
    ):
        self.waypoints: List[Waypoint] = waypoints if waypoints is not None else []
        self.current_idx: int = 0
        self.completed_laps: int = 0
        self.is_looping: bool = False

        # Controller gains
        self.kp_yaw = kp_yaw
        self.kp_dist = kp_dist
        self.kp_z = kp_z
        self.max_linear_x = max_linear_x
        self.min_linear_x = min_linear_x
        self.max_angular_z = max_angular_z
        self.max_linear_z = max_linear_z
        self.heading_tolerance = heading_tolerance
        self.yaw_sign = yaw_sign

    def set_waypoints(self, waypoints: List[Waypoint], loop: bool = False):
        """Replaces current waypoint queue with a new sequence."""
        self.waypoints = list(waypoints)
        self.current_idx = 0
        self.is_looping = loop

    def add_waypoint(self, waypoint: Waypoint):
        """Appends a waypoint to the queue."""
        self.waypoints.append(waypoint)

    def current_waypoint(self) -> Optional[Waypoint]:
        """Returns the active target waypoint, or None if queue is empty/finished."""
        if not self.waypoints or self.current_idx >= len(self.waypoints):
            return None
        return self.waypoints[self.current_idx]

    def is_finished(self) -> bool:
        """Returns True if all waypoints have been reached and loop mode is disabled."""
        return len(self.waypoints) > 0 and self.current_idx >= len(self.waypoints)

    def compute_control(
        self,
        current_x: float,
        current_y: float,
        current_z: float,
        current_yaw: float
    ) -> Tuple[Twist, bool, bool]:
        """
        Computes the velocity Twist command given current estimated pose.
        Returns:
            (Twist, waypoint_reached_this_step, is_mission_finished)
        """
        cmd = Twist()
        wp = self.current_waypoint()

        if wp is None:
            return cmd, False, True

        dx = wp.x - current_x
        dy = wp.y - current_y
        dz = wp.z - current_z
        dist_2d = math.hypot(dx, dy)

        # Check acceptance criteria
        reached = (dist_2d < wp.radius) and (abs(dz) < 0.6)
        if reached:
            self.current_idx += 1
            if self.current_idx >= len(self.waypoints):
                if self.is_looping:
                    self.current_idx = 0
                    self.completed_laps += 1
                else:
                    # Hover / zero out commands
                    return cmd, True, True

            # If looping or new target available, re-evaluate for next waypoint
            wp = self.current_waypoint()
            if wp is None:
                return cmd, True, True
            dx = wp.x - current_x
            dy = wp.y - current_y
            dz = wp.z - current_z
            dist_2d = math.hypot(dx, dy)

        # Guidance calculation
        target_heading = math.atan2(dy, dx)
        heading_error = normalize_angle(target_heading - current_yaw)

        # Altitude control (linear.z)
        cmd.linear.z = clamp(self.kp_z * dz, -self.max_linear_z, self.max_linear_z)

        # Heading and forward flight control
        # If heading error is large, prioritize rotation before forward speed to avoid large drift
        if abs(heading_error) > self.heading_tolerance:
            raw_yaw = self.yaw_sign * self.kp_yaw * heading_error
            cmd.angular.z = clamp(raw_yaw, -self.max_angular_z, self.max_angular_z)
            # Small forward velocity to maintain stability
            cmd.linear.x = self.min_linear_x * 0.5
        else:
            # Heading well-aligned, apply proportional forward speed and fine yaw correction
            raw_yaw = self.yaw_sign * self.kp_yaw * heading_error
            cmd.angular.z = clamp(raw_yaw, -self.max_angular_z * 0.5, self.max_angular_z * 0.5)
            cmd.linear.x = clamp(self.kp_dist * dist_2d, self.min_linear_x, self.max_linear_x)

        return cmd, reached, False
