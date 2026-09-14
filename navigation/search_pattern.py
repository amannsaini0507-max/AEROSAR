"""
AEROSAR Serpentine / Lawnmower Search Pattern Generator
Member 3 — Autonomous Navigation / SLAM Lead
SIH 2026 — PS 26177

Implements:
- Deterministic serpentine (lawnmower) path generation over a rectangular search bounding box
- Alternating East-West sweep lanes with Northward lane shifts
- Area coverage percentage estimation for telemetry and mission logging
- Fully mathematical, low-compute approach strictly per Master Document Section 10.2 & 10.5
"""

import math
from typing import List, Tuple
from .waypoint_follower import Waypoint


class SerpentinePatternGenerator:
    """
    Generates a deterministic serpentine (lawnmower) grid path covering a designated search area.
    Ideal for fixed-pattern SAR sweeps without expensive path planners.
    """

    def __init__(
        self,
        x_min: float = -3.0,
        x_max: float = 3.0,
        y_min: float = -3.0,
        y_max: float = 3.0,
        altitude: float = 1.5,
        lane_spacing: float = 1.5,
        acceptance_radius: float = 0.5
    ):
        self.x_min = min(x_min, x_max)
        self.x_max = max(x_min, x_max)
        self.y_min = min(y_min, y_max)
        self.y_max = max(y_min, y_max)
        self.altitude = altitude
        self.lane_spacing = max(0.5, lane_spacing)
        self.acceptance_radius = acceptance_radius

        self.waypoints: List[Waypoint] = []
        self._generate_pattern()

    def _generate_pattern(self):
        """Builds the serpentine waypoint sequence."""
        self.waypoints.clear()

        current_y = self.y_min
        sweep_east = True  # Start sweeping from x_min -> x_max

        while current_y <= self.y_max:
            if sweep_east:
                # West to East
                self.waypoints.append(Waypoint(self.x_min, current_y, self.altitude, self.acceptance_radius))
                self.waypoints.append(Waypoint(self.x_max, current_y, self.altitude, self.acceptance_radius))
            else:
                # East to West
                self.waypoints.append(Waypoint(self.x_max, current_y, self.altitude, self.acceptance_radius))
                self.waypoints.append(Waypoint(self.x_min, current_y, self.altitude, self.acceptance_radius))

            sweep_east = not sweep_east
            current_y += self.lane_spacing

        # If the last lane is slightly below y_max, add one final sweep at y_max
        if (current_y - self.lane_spacing) < (self.y_max - 0.2):
            if sweep_east:
                self.waypoints.append(Waypoint(self.x_min, self.y_max, self.altitude, self.acceptance_radius))
                self.waypoints.append(Waypoint(self.x_max, self.y_max, self.altitude, self.acceptance_radius))
            else:
                self.waypoints.append(Waypoint(self.x_max, self.y_max, self.altitude, self.acceptance_radius))
                self.waypoints.append(Waypoint(self.x_min, self.y_max, self.altitude, self.acceptance_radius))

    def get_waypoints(self) -> List[Waypoint]:
        """Returns the generated waypoint list."""
        return list(self.waypoints)

    def total_search_area(self) -> float:
        """Returns the total area in m^2 of the bounding search zone."""
        return (self.x_max - self.x_min) * (self.y_max - self.y_min)

    def total_path_distance(self) -> float:
        """Computes the total Euclidean distance along the entire serpentine path in meters."""
        if len(self.waypoints) < 2:
            return 0.0
        total = 0.0
        for i in range(1, len(self.waypoints)):
            p1 = self.waypoints[i - 1]
            p2 = self.waypoints[i]
            total += math.hypot(p2.x - p1.x, p2.y - p1.y)
        return total

    def calculate_coverage_percentage(self, current_waypoint_idx: int) -> float:
        """
        Estimates the coverage completion percentage (0.0 to 100.0%)
        based on active progress through the waypoint list.
        """
        if not self.waypoints:
            return 100.0
        pct = (min(current_waypoint_idx, len(self.waypoints)) / float(len(self.waypoints))) * 100.0
        return round(min(100.0, max(0.0, pct)), 1)
