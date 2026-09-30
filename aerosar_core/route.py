"""
A* Safe Route Planner around hazard costmaps over the 30m x 30m disaster arena.
Uses 0.5 m grid cells and 8-connected grid search.
Avoids hazard inflation zones with safety margins.
"""

import heapq
import math
from dataclasses import dataclass
from typing import Dict, List, Set, Tuple

from .geo import (
    BASE_LAT,
    BASE_LON,
    BASE_ALT,
    enu_to_geodetic,
    geodetic_to_enu,
    geo_distance_m,
)


@dataclass
class HazardZone:
    lat: float
    lon: float
    radius_m: float = 3.0
    safety_margin_m: float = 1.5
    severity: float = 1.0


class AStarPlanner:
    """
    Grid-based A* path planner discretizing the 30m x 30m arena at 0.5 m resolution.
    Coordinate frame: Local ENU meters [-15.0, 15.0] around base origin.
    """

    def __init__(
        self,
        ref_lat: float = BASE_LAT,
        ref_lon: float = BASE_LON,
        arena_size_m: float = 30.0,
        cell_size_m: float = 0.5,
    ):
        self.ref_lat = ref_lat
        self.ref_lon = ref_lon
        self.arena_size_m = arena_size_m
        self.cell_size_m = cell_size_m
        self.half_size = arena_size_m / 2.0  # -15 to +15 m

        # Grid dimensions (e.g., 30 / 0.5 = 60 cells in X and Y)
        self.grid_dim = int(round(arena_size_m / cell_size_m))
        self.hazards: List[HazardZone] = []

    def clear_hazards(self):
        self.hazards.clear()

    def add_hazard(self, hazard: HazardZone):
        self.hazards.append(hazard)

    def _local_to_grid(self, x: float, y: float) -> Tuple[int, int]:
        gx = int(math.floor((x + self.half_size) / self.cell_size_m))
        gy = int(math.floor((y + self.half_size) / self.cell_size_m))
        gx = max(0, min(self.grid_dim - 1, gx))
        gy = max(0, min(self.grid_dim - 1, gy))
        return gx, gy

    def _grid_to_local(self, gx: int, gy: int) -> Tuple[float, float]:
        x = (gx + 0.5) * self.cell_size_m - self.half_size
        y = (gy + 0.5) * self.cell_size_m - self.half_size
        return x, y

    def is_in_hazard(self, x: float, y: float, include_margin: bool = True) -> bool:
        """Checks if a local point (x, y) is inside any active hazard or safety margin."""
        for h in self.hazards:
            hx, hy, _ = geodetic_to_enu(h.lat, h.lon, BASE_ALT, self.ref_lat, self.ref_lon)
            dist = math.hypot(x - hx, y - hy)
            thresh = (h.radius_m + h.safety_margin_m) if include_margin else h.radius_m
            if dist < thresh:
                return True
        return False

    def _cell_cost(self, gx: int, gy: int) -> float:
        """Returns cell traversal cost. Returns inf if hard obstacle/hazard."""
        x, y = self._grid_to_local(gx, gy)
        base_cost = 1.0

        for h in self.hazards:
            hx, hy, _ = geodetic_to_enu(h.lat, h.lon, BASE_ALT, self.ref_lat, self.ref_lon)
            dist = math.hypot(x - hx, y - hy)
            hard_radius = h.radius_m
            inflated_radius = h.radius_m + h.safety_margin_m

            if dist < hard_radius:
                return float("inf")  # Impassable
            elif dist < inflated_radius:
                # High cost near boundary to penalize proximity
                penalty = 50.0 * (1.0 - (dist - hard_radius) / h.safety_margin_m)
                base_cost += penalty

        return base_cost

    def _neighbors(self, gx: int, gy: int) -> List[Tuple[Tuple[int, int], float]]:
        """8-connected grid neighborhood."""
        results = []
        for dx, dy in [
            (-1, 0), (1, 0), (0, -1), (0, 1),
            (-1, -1), (-1, 1), (1, -1), (1, 1),
        ]:
            nx, ny = gx + dx, gy + dy
            if 0 <= nx < self.grid_dim and 0 <= ny < self.grid_dim:
                dist = math.hypot(dx, dy) * self.cell_size_m
                results.append(((nx, ny), dist))
        return results

    def plan_path(
        self,
        start_lat: float,
        start_lon: float,
        goal_lat: float,
        goal_lon: float,
    ) -> List[Tuple[float, float]]:
        """
        Plans lowest-cost 8-connected safe route from start to goal.
        Returns ordered list of [lat, lon] waypoints.
        """
        sx, sy, _ = geodetic_to_enu(start_lat, start_lon, BASE_ALT, self.ref_lat, self.ref_lon)
        gx, gy, _ = geodetic_to_enu(goal_lat, goal_lon, BASE_ALT, self.ref_lat, self.ref_lon)

        start_cell = self._local_to_grid(sx, sy)
        goal_cell = self._local_to_grid(gx, gy)

        if start_cell == goal_cell:
            return [[start_lat, start_lon], [goal_lat, goal_lon]]

        def heuristic(cell_a: Tuple[int, int], cell_b: Tuple[int, int]) -> float:
            ax, ay = self._grid_to_local(cell_a[0], cell_a[1])
            bx, by = self._grid_to_local(cell_b[0], cell_b[1])
            return math.hypot(ax - bx, ay - by)

        open_set: List[Tuple[float, int, Tuple[int, int]]] = []
        heapq.heappush(open_set, (0.0, 0, start_cell))
        counter = 0

        came_from: Dict[Tuple[int, int], Tuple[int, int]] = {}
        g_score: Dict[Tuple[int, int], float] = {start_cell: 0.0}
        closed_set: Set[Tuple[int, int]] = set()

        max_iterations = 6000
        iterations = 0

        while open_set and iterations < max_iterations:
            iterations += 1
            _, _, current = heapq.heappop(open_set)

            if current == goal_cell:
                # Reconstruct path
                path = [current]
                while current in came_from:
                    current = came_from[current]
                    path.append(current)
                path.reverse()

                # Convert to geo waypoints with smoothing
                geo_waypoints: List[Tuple[float, float]] = []
                geo_waypoints.append([round(start_lat, 7), round(start_lon, 7)])

                step = max(1, len(path) // 20)
                for i in range(step, len(path) - 1, step):
                    cell = path[i]
                    lx, ly = self._grid_to_local(cell[0], cell[1])
                    plat, plon, _ = enu_to_geodetic(lx, ly, BASE_ALT, self.ref_lat, self.ref_lon)
                    geo_waypoints.append([round(plat, 7), round(plon, 7)])

                geo_waypoints.append([round(goal_lat, 7), round(goal_lon, 7)])
                return geo_waypoints

            closed_set.add(current)

            for neighbor, step_dist in self._neighbors(current[0], current[1]):
                if neighbor in closed_set:
                    continue

                cell_cost = self._cell_cost(neighbor[0], neighbor[1])
                if math.isinf(cell_cost):
                    continue

                tentative_g = g_score[current] + step_dist * cell_cost

                if neighbor not in g_score or tentative_g < g_score[neighbor]:
                    came_from[neighbor] = current
                    g_score[neighbor] = tentative_g
                    f = tentative_g + heuristic(neighbor, goal_cell)
                    counter += 1
                    heapq.heappush(open_set, (f, counter, neighbor))

        # Fallback to direct path if completely obstructed
        return [[round(start_lat, 7), round(start_lon, 7)], [round(goal_lat, 7), round(goal_lon, 7)]]
