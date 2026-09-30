"""
A* Safe Route Planner for AEROSAR.
Delegates directly to aerosar_core.route to ensure zero duplicated logic.
"""

from typing import List, Tuple
from aerosar_core.route import AStarPlanner as CoreAStarPlanner, HazardZone
from aerosar_core.geo import BASE_LAT, BASE_LON


class HazardCostZone:
    def __init__(self, lat: float, lon: float, radius_m: float = 8.0, severity: float = 1.0):
        self.lat = lat
        self.lon = lon
        self.radius_m = radius_m
        self.severity = max(0.1, min(1.0, severity))


class AStarRoutePlanner:
    def __init__(self, ref_lat: float = BASE_LAT, ref_lon: float = BASE_LON, resolution_m: float = 0.5, max_penalty: float = 100.0):
        self.planner = CoreAStarPlanner(ref_lat=ref_lat, ref_lon=ref_lon, arena_size_m=30.0, cell_size_m=resolution_m)

    def add_hazard(self, hazard: HazardCostZone):
        self.planner.add_hazard(HazardZone(lat=hazard.lat, lon=hazard.lon, radius_m=hazard.radius_m, severity=hazard.severity))

    def plan_safe_path(self, start_lat: float, start_lon: float, goal_lat: float, goal_lon: float) -> List[List[float]]:
        return self.planner.plan_path(start_lat, start_lon, goal_lat, goal_lon)
