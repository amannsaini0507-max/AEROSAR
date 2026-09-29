import math
import heapq
from typing import List, Tuple, Set, Dict

class HazardZone:
    def __init__(self, x: float, y: float, radius: float, severity: float = 1.0):
        self.x = x
        self.y = y
        self.radius = radius
        self.severity = severity  # 0.0 to 1.0


class AStarPlanner:
    def __init__(self, resolution: float = 1.0, max_cost: float = 100.0):
        """
        Initializes the A* grid planner.
        :param resolution: Grid cell size in meters (e.g., 1.0 for 1m x 1m cells).
        :param max_cost: The maximum cost penalty for navigating directly through a hazard.
        """
        self.resolution = resolution
        self.max_cost = max_cost
        self.hazards: List[HazardZone] = []

    def add_hazard(self, hazard: HazardZone):
        """Registers a new hazard zone on the map."""
        self.hazards.append(hazard)

    def _world_to_grid(self, wx: float, wy: float) -> Tuple[int, int]:
        return int(round(wx / self.resolution)), int(round(wy / self.resolution))

    def _grid_to_world(self, gx: int, gy: int) -> Tuple[float, float]:
        return gx * self.resolution, gy * self.resolution

    def _heuristic(self, nodeA: Tuple[int, int], nodeB: Tuple[int, int]) -> float:
        # Euclidean distance
        return math.hypot(nodeA[0] - nodeB[0], nodeA[1] - nodeB[1]) * self.resolution

    def _get_cost(self, node: Tuple[int, int]) -> float:
        """
        Calculates the traversal cost of a given grid node.
        Base cost is 1.0 (open terrain). Hazards add localized high cost.
        """
        wx, wy = self._grid_to_world(node[0], node[1])
        base_cost = 1.0
        penalty = 0.0

        for h in self.hazards:
            dist = math.hypot(wx - h.x, wy - h.y)
            if dist <= h.radius:
                # Inside hazard core -> extremely high cost based on severity
                penalty += self.max_cost * h.severity
            elif dist <= h.radius * 2.5:
                # Proximity falloff -> gradual cost increase nearby
                falloff = (h.radius * 2.5 - dist) / (h.radius * 1.5)
                penalty += (self.max_cost * 0.2) * h.severity * falloff
                
        return base_cost + penalty

    def _get_neighbors(self, node: Tuple[int, int]) -> List[Tuple[Tuple[int, int], float]]:
        """Returns 8-way connected neighbors and their transition distance costs."""
        neighbors = []
        for dx, dy in [(-1, 0), (1, 0), (0, -1), (0, 1), (-1, -1), (-1, 1), (1, -1), (1, 1)]:
            nx, ny = node[0] + dx, node[1] + dy
            # Diagonal cost is sqrt(2), cardinal is 1.0
            dist_cost = math.hypot(dx, dy) * self.resolution
            neighbors.append(((nx, ny), dist_cost))
        return neighbors

    def plan_route(self, start_world: Tuple[float, float], goal_world: Tuple[float, float]) -> List[Tuple[float, float]]:
        """
        Computes the lowest-cost path from start to goal avoiding hazards.
        Returns an ordered list of (x, y) waypoints.
        """
        start_grid = self._world_to_grid(start_world[0], start_world[1])
        goal_grid = self._world_to_grid(goal_world[0], goal_world[1])

        # Priority queue for open set: (f_score, counter, node)
        open_set = []
        counter = 0  # Tie-breaker
        heapq.heappush(open_set, (0.0, counter, start_grid))

        came_from: Dict[Tuple[int, int], Tuple[int, int]] = {}
        
        g_score: Dict[Tuple[int, int], float] = {start_grid: 0.0}
        f_score: Dict[Tuple[int, int], float] = {start_grid: self._heuristic(start_grid, goal_grid)}

        closed_set: Set[Tuple[int, int]] = set()

        while open_set:
            _, _, current = heapq.heappop(open_set)

            if current == goal_grid:
                # Reconstruct path
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

                # Transition cost = distance multiplier * average cost of traversing into the cell
                transition_cost = dist_mult * self._get_cost(neighbor)
                tentative_g = g_score[current] + transition_cost

                if neighbor not in g_score or tentative_g < g_score[neighbor]:
                    came_from[neighbor] = current
                    g_score[neighbor] = tentative_g
                    f_score[neighbor] = tentative_g + self._heuristic(neighbor, goal_grid)
                    
                    # Add to open set if not already present
                    counter += 1
                    heapq.heappush(open_set, (f_score[neighbor], counter, neighbor))

        # No path found
        return []
