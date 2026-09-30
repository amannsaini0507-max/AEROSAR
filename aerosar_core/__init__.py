"""
AEROSAR Pure-Python Core Engine.
SIH 2026 — PS 26177.
Encapsulates all domain logic without ROS 2 (rclpy) dependencies.
"""

from .geo import (
    BASE_LAT,
    BASE_LON,
    BASE_ALT,
    enu_to_geodetic,
    geodetic_to_enu,
    geo_distance_m,
    geotag_detection,
)
from .risk import (
    score_detection,
    calculate_risk,
    RiskResult,
    MAX_RELEVANT_DISTANCE,
    MAX_RELEVANT_COUNT,
    CLUSTER_RADIUS,
)
from .route import (
    AStarPlanner,
    HazardZone,
)
from .vehicle import (
    VehicleStateMachine,
    VehicleState,
    SafetyReport,
)
from .fusion import (
    SensorFusionEngine,
    FusedDetection,
)
from .trajectory import (
    UniformCubicBSpline,
    ObstaclePotentialField,
    generate_lawnmower_waypoints,
)
from .perception import (
    SyntheticPerceptionEngine,
    GroundTruthVictim,
)
from .geo import add_gps_noise

__all__ = [
    "BASE_LAT",
    "BASE_LON",
    "BASE_ALT",
    "enu_to_geodetic",
    "geodetic_to_enu",
    "geo_distance_m",
    "geotag_detection",
    "add_gps_noise",
    "score_detection",
    "calculate_risk",
    "RiskResult",
    "MAX_RELEVANT_DISTANCE",
    "MAX_RELEVANT_COUNT",
    "CLUSTER_RADIUS",
    "AStarPlanner",
    "HazardZone",
    "VehicleStateMachine",
    "VehicleState",
    "SafetyReport",
    "SensorFusionEngine",
    "FusedDetection",
    "UniformCubicBSpline",
    "ObstaclePotentialField",
    "generate_lawnmower_waypoints",
    "SyntheticPerceptionEngine",
    "GroundTruthVictim",
]
