"""
AEROSAR Member 3 — Safe Route Planner Node Adapter.
Delegates to pure-Python aerosar_core.route to satisfy Hard Rule 1 (Two runtimes, one brain).
"""

import math
import heapq
import sys
from pathlib import Path
from typing import List, Tuple, Set, Dict

# Resolve aerosar_core from workspace root
try:
    ws_root = Path(__file__).resolve().parents[4]
    if str(ws_root) not in sys.path:
        sys.path.insert(0, str(ws_root))
except Exception:
    pass

try:
    from aerosar_core.route import AStarPlanner as CoreAStarPlanner, HazardZone as CoreHazardZone
    from aerosar_core.geo import enu_to_geodetic, geodetic_to_enu, BASE_LAT, BASE_LON, BASE_ALT
    HAS_CORE = True
except ImportError:
    HAS_CORE = False


class HazardZone:
    def __init__(self, x: float, y: float, radius: float, severity: float = 1.0):
        self.x = x
        self.y = y
        self.radius = radius
        self.severity = severity  # 0.0 to 1.0


class AStarPlanner:
    def __init__(self, resolution: float = 1.0, max_cost: float = 100.0):
        self.resolution = resolution
        self.max_cost = max_cost
        self.hazards: List[HazardZone] = []

        if HAS_CORE:
            self._core_planner = CoreAStarPlanner(
                ref_lat=BASE_LAT,
                ref_lon=BASE_LON,
                arena_size_m=30.0,
                cell_size_m=resolution,
            )
        else:
            self._core_planner = None

    def add_hazard(self, hazard: HazardZone):
        """Registers a new hazard zone on the map."""
        self.hazards.append(hazard)
        if self._core_planner and HAS_CORE:
            hlat, hlon, _ = enu_to_geodetic(hazard.x, hazard.y, BASE_ALT)
            self._core_planner.add_hazard(CoreHazardZone(
                lat=hlat,
                lon=hlon,
                radius_m=hazard.radius,
                safety_margin_m=1.0,
                severity=hazard.severity,
            ))

    def _world_to_grid(self, wx: float, wy: float) -> Tuple[int, int]:
        return int(round(wx / self.resolution)), int(round(wy / self.resolution))

    def _grid_to_world(self, gx: int, gy: int) -> Tuple[float, float]:
        return gx * self.resolution, gy * self.resolution

    def _heuristic(self, nodeA: Tuple[int, int], nodeB: Tuple[int, int]) -> float:
        return math.hypot(nodeA[0] - nodeB[0], nodeA[1] - nodeB[1]) * self.resolution

    def _get_cost(self, node: Tuple[int, int]) -> float:
        wx, wy = self._grid_to_world(node[0], node[1])
        base_cost = 1.0
        penalty = 0.0
        for h in self.hazards:
            dist = math.hypot(wx - h.x, wy - h.y)
            if dist <= h.radius:
                penalty += self.max_cost * h.severity
            elif dist <= h.radius * 2.5:
                falloff = (h.radius * 2.5 - dist) / (h.radius * 1.5)
                penalty += (self.max_cost * 0.2) * h.severity * falloff
        return base_cost + penalty

    def _get_neighbors(self, node: Tuple[int, int]) -> List[Tuple[Tuple[int, int], float]]:
        neighbors = []
        for dx, dy in [(-1, 0), (1, 0), (0, -1), (0, 1), (-1, -1), (-1, 1), (1, -1), (1, 1)]:
            nx, ny = node[0] + dx, node[1] + dy
            dist_cost = math.hypot(dx, dy) * self.resolution
            neighbors.append(((nx, ny), dist_cost))
        return neighbors

    def plan_route(self, start_world: Tuple[float, float], goal_world: Tuple[float, float]) -> List[Tuple[float, float]]:
        """
        Computes the lowest-cost path from start to goal avoiding hazards.
        Delegates to aerosar_core if available; falls back to local grid search.
        """
        if self._core_planner and HAS_CORE:
            slat, slon, _ = enu_to_geodetic(start_world[0], start_world[1], BASE_ALT)
            glat, glon, _ = enu_to_geodetic(goal_world[0], goal_world[1], BASE_ALT)
            geo_path = self._core_planner.plan_path(slat, slon, glat, glon)
            local_pts: List[Tuple[float, float]] = []
            for plat, plon in geo_path:
                lx, ly, _ = geodetic_to_enu(plat, plon, BASE_ALT)
                local_pts.append((round(lx, 2), round(ly, 2)))
            if local_pts:
                return local_pts

        # Local fallback implementation
        start_grid = self._world_to_grid(start_world[0], start_world[1])
        goal_grid = self._world_to_grid(goal_world[0], goal_world[1])
        open_set = []
        counter = 0
        heapq.heappush(open_set, (0.0, counter, start_grid))
        came_from: Dict[Tuple[int, int], Tuple[int, int]] = {}
        g_score: Dict[Tuple[int, int], float] = {start_grid: 0.0}
        f_score: Dict[Tuple[int, int], float] = {start_grid: self._heuristic(start_grid, goal_grid)}
        closed_set: Set[Tuple[int, int]] = set()

        while open_set:
            _, _, current = heapq.heappop(open_set)
            if current == goal_grid:
                path = []
                while current in came_from:
                    path.append(self._grid_to_world(current[0], current[1]))
                    current = came_from[current]
                path.append(self._grid_to_world(start_grid[0], start_grid[1]))
                path.reverse()
                return path

            closed_set.add(current)
            for neighbor, dist_mult in self._get_neighbors(current):
                if neighbor in closed_set:
                    continue
                transition_cost = dist_mult * self._get_cost(neighbor)
                tentative_g = g_score[current] + transition_cost
                if neighbor not in g_score or tentative_g < g_score[neighbor]:
                    came_from[neighbor] = current
                    g_score[neighbor] = tentative_g
                    f_score[neighbor] = tentative_g + self._heuristic(neighbor, goal_grid)
                    counter += 1
                    heapq.heappush(open_set, (f_score[neighbor], counter, neighbor))
        return []
