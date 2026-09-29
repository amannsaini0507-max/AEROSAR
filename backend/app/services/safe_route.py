"""
A* Safe Route Planner for AEROSAR Member 4.
Calculates lowest-risk paths from rescue team position to survivor coordinates around hazard costmaps.
"""

import math
import heapq
from typing import List, Tuple, Dict, Set


class HazardCostZone:
    def __init__(self, lat: float, lon: float, radius_m: float = 8.0, severity: float = 1.0):
        self.lat = lat
        self.lon = lon
        self.radius_m = radius_m
        self.severity = max(0.1, min(1.0, severity))


class AStarRoutePlanner:
    def __init__(self, ref_lat: float = 26.9124, ref_lon: float = 75.7873, resolution_m: float = 1.0, max_penalty: float = 100.0):
        self.ref_lat = ref_lat
        self.ref_lon = ref_lon
        self.resolution = resolution_m
        self.max_penalty = max_penalty
        self.lat_scale = 111320.0
        self.lon_scale = 111320.0 * math.cos(math.radians(ref_lat))
        self.hazards: List[HazardCostZone] = []

    def add_hazard(self, hazard: HazardCostZone):
        self.hazards.append(hazard)

    def _geo_to_local(self, lat: float, lon: float) -> Tuple[float, float]:
        x = (lon - self.ref_lon) * self.lon_scale
        y = (lat - self.ref_lat) * self.lat_scale
        return x, y

    def _local_to_geo(self, x: float, y: float) -> Tuple[float, float]:
        lat = self.ref_lat + (y / self.lat_scale)
        lon = self.ref_lon + (x / self.lon_scale)
        return lat, lon

    def _local_to_grid(self, x: float, y: float) -> Tuple[int, int]:
        return int(round(x / self.resolution)), int(round(y / self.resolution))

    def _grid_to_local(self, gx: int, gy: int) -> Tuple[float, float]:
        return gx * self.resolution, gy * self.resolution

    def _heuristic(self, a: Tuple[int, int], b: Tuple[int, int]) -> float:
        return math.hypot(a[0] - b[0], a[1] - b[1]) * self.resolution

    def _node_cost(self, node: Tuple[int, int]) -> float:
        wx, wy = self._grid_to_local(node[0], node[1])
        base_cost = 1.0
        penalty = 0.0

        for h in self.hazards:
            hx, hy = self._geo_to_local(h.lat, h.lon)
            dist = math.hypot(wx - hx, wy - hy)
            if dist <= h.radius_m:
                penalty += self.max_penalty * h.severity
            elif dist <= (h.radius_m * 2.5):
                falloff = (h.radius_m * 2.5 - dist) / (h.radius_m * 1.5)
                penalty += (self.max_penalty * 0.25) * h.severity * falloff

        return base_cost + penalty

    def _neighbors(self, node: Tuple[int, int]) -> List[Tuple[Tuple[int, int], float]]:
        res = []
        for dx, dy in [(-1, 0), (1, 0), (0, -1), (0, 1), (-1, -1), (-1, 1), (1, -1), (1, 1)]:
            dist = math.hypot(dx, dy) * self.resolution
            res.append(((node[0] + dx, node[1] + dy), dist))
        return res

    def plan_safe_path(self, start_lat: float, start_lon: float, goal_lat: float, goal_lon: float) -> List[Tuple[float, float]]:
        """
        Plans lowest-risk path from (start_lat, start_lon) to (goal_lat, goal_lon).
        Returns list of (lat, lon) waypoints.
        """
        sx, sy = self._geo_to_local(start_lat, start_lon)
        gx, gy = self._geo_to_local(goal_lat, goal_lon)

        start_grid = self._local_to_grid(sx, sy)
        goal_grid = self._local_to_grid(gx, gy)

        if start_grid == goal_grid:
            return [(start_lat, start_lon), (goal_lat, goal_lon)]

        open_set = []
        counter = 0
        heapq.heappush(open_set, (0.0, counter, start_grid))
        came_from: Dict[Tuple[int, int], Tuple[int, int]] = {}

        g_score: Dict[Tuple[int, int], float] = {start_grid: 0.0}
        f_score: Dict[Tuple[int, int], float] = {start_grid: self._heuristic(start_grid, goal_grid)}
        closed_set: Set[Tuple[int, int]] = set()

        max_iterations = 3000
        iterations = 0

        while open_set and iterations < max_iterations:
            iterations += 1
            _, _, current = heapq.heappop(open_set)

            if current == goal_grid:
                # Reconstruct path
                path_local = []
                curr = current
                while curr in came_from:
                    path_local.append(self._grid_to_local(curr[0], curr[1]))
                    curr = came_from[curr]
                path_local.append((sx, sy))
                path_local.reverse()
                path_local.append((gx, gy))

                # Downsample/smooth waypoints and convert to lat/lon
                geo_path = []
                step = max(1, len(path_local) // 15)
                sampled = [path_local[i] for i in range(0, len(path_local), step)]
                if path_local[-1] not in sampled:
                    sampled.append(path_local[-1])

                for lx, ly in sampled:
                    plat, plon = self._local_to_geo(lx, ly)
                    geo_path.append([round(plat, 7), round(plon, 7)])
                return geo_path

            closed_set.add(current)

            for neighbor, step_dist in self._neighbors(current):
                if neighbor in closed_set:
                    continue

                cell_cost = self._node_cost(neighbor)
                tentative_g = g_score[current] + (step_dist * cell_cost)

                if neighbor not in g_score or tentative_g < g_score[neighbor]:
                    came_from[neighbor] = current
                    g_score[neighbor] = tentative_g
                    f = tentative_g + self._heuristic(neighbor, goal_grid)
                    f_score[neighbor] = f
                    counter += 1
                    heapq.heappush(open_set, (f, counter, neighbor))

        # Fallback to direct path if no obstacle-free path found within budget
        return [[round(start_lat, 7), round(start_lon, 7)], [round(goal_lat, 7), round(goal_lon, 7)]]
