"""
Trajectory Generation & Local Reactive Obstacle Avoidance.
Mathematical implementation of:
1. Uniform cubic B-spline waypoint smoothing.
2. Analytic obstacle distance field with repulsive gradient (EGO-Planner / Fast-Planner concept).
3. Serpentine / lawnmower search pattern generator for the 30m x 30m arena.
"""

import math
from typing import List, Tuple


def generate_lawnmower_waypoints(
    x_min: float = -12.0,
    x_max: float = 12.0,
    y_min: float = -12.0,
    y_max: float = 12.0,
    altitude: float = 2.0,
    lane_spacing: float = 4.0,
) -> List[Tuple[float, float, float]]:
    """
    Generates deterministic serpentine (lawnmower) 3D waypoints over the search arena.
    Returns list of (x, y, z) in local ENU meters.
    """
    waypoints: List[Tuple[float, float, float]] = []
    # Start at home origin, ascend
    waypoints.append((0.0, 0.0, altitude))

    current_y = y_min
    sweep_east = True

    while current_y <= y_max + 0.1:
        if sweep_east:
            waypoints.append((x_min, current_y, altitude))
            waypoints.append((x_max, current_y, altitude))
        else:
            waypoints.append((x_max, current_y, altitude))
            waypoints.append((x_min, current_y, altitude))
        sweep_east = not sweep_east
        current_y += lane_spacing

    # Return leg to home
    waypoints.append((0.0, 0.0, altitude))
    return waypoints


class UniformCubicBSpline:
    """
    Evaluates uniform cubic B-splines over a sequence of 3D control points.
    Basis matrix for uniform cubic B-spline:
      M = 1/6 * [ -1  3 -3  1 ]
                [  3 -6  3  0 ]
                [ -3  0  3  0 ]
                [  1  4  1  0 ]
    """

    def __init__(self, control_points: List[Tuple[float, float, float]]):
        if len(control_points) < 4:
            # Pad control points if fewer than 4 provided
            first = control_points[0] if control_points else (0.0, 0.0, 0.0)
            last = control_points[-1] if control_points else (0.0, 0.0, 0.0)
            self.pts = [first] * (4 - len(control_points)) + list(control_points)
        else:
            self.pts = list(control_points)

    def num_segments(self) -> int:
        return max(1, len(self.pts) - 3)

    def evaluate(self, u_global: float) -> Tuple[float, float, float]:
        """
        Evaluates B-spline position at normalized parameter u_global in [0, 1].
        """
        n_seg = self.num_segments()
        t_total = max(0.0, min(1.0, u_global)) * n_seg
        seg = int(math.floor(t_total))
        if seg >= n_seg:
            seg = n_seg - 1
            u = 1.0
        else:
            u = t_total - seg

        p0 = self.pts[seg]
        p1 = self.pts[seg + 1]
        p2 = self.pts[seg + 2]
        p3 = self.pts[seg + 3]

        u2 = u * u
        u3 = u2 * u

        # Cubic B-spline blending functions
        b0 = (-u3 + 3.0 * u2 - 3.0 * u + 1.0) / 6.0
        b1 = (3.0 * u3 - 6.0 * u2 + 4.0) / 6.0
        b2 = (-3.0 * u3 + 3.0 * u2 + 3.0 * u + 1.0) / 6.0
        b3 = u3 / 6.0

        x = b0 * p0[0] + b1 * p1[0] + b2 * p2[0] + b3 * p3[0]
        y = b0 * p0[1] + b1 * p1[1] + b2 * p2[1] + b3 * p3[1]
        z = b0 * p0[2] + b1 * p1[2] + b2 * p2[2] + b3 * p3[2]
        return x, y, z


class ObstaclePotentialField:
    """
    Analytic obstacle distance field with repulsive gradient.
    Computes repulsive velocity adjustments when the vehicle approaches known obstacles.
    Repulsive potential:
      U_rep(d) = 0.5 * k_rep * (1/d - 1/d0)^2  for d <= d0
      Grad(U_rep) = -k_rep * (1/d - 1/d0) * (1/d^2) * (p - p_obs)/d
    """

    def __init__(self, influence_dist_m: float = 3.5, k_rep: float = 2.0):
        self.d0 = influence_dist_m
        self.k_rep = k_rep
        self.obstacles: List[Tuple[float, float, float, float]] = []  # (x, y, z, radius)

    def add_obstacle(self, x: float, y: float, z: float, radius: float = 1.0):
        self.obstacles.append((x, y, z, radius))

    def clear(self):
        self.obstacles.clear()

    def compute_repulsive_force(
        self,
        drone_pos: Tuple[float, float, float],
    ) -> Tuple[float, float, float]:
        """
        Returns (fx, fy, fz) repulsive velocity correction.
        """
        fx = 0.0
        fy = 0.0
        fz = 0.0

        px, py, pz = drone_pos

        for ox, oy, oz, r in self.obstacles:
            dx = px - ox
            dy = py - oy
            dz = pz - oz
            center_dist = math.sqrt(dx * dx + dy * dy + dz * dz)
            surface_dist = center_dist - r

            if 0.05 < surface_dist < self.d0:
                # Repulsive gradient pointing away from obstacle
                factor = self.k_rep * (1.0 / surface_dist - 1.0 / self.d0) * (1.0 / (surface_dist * surface_dist))
                # Unit direction vector
                nx = dx / center_dist
                ny = dy / center_dist
                nz = dz / center_dist

                fx += factor * nx
                fy += factor * ny
                fz += factor * nz * 0.5  # Less vertical pushing

        # Clamp max repulsive correction to prevent erratic jumps
        force_mag = math.hypot(fx, math.hypot(fy, fz))
        max_force = 1.5  # m/s
        if force_mag > max_force:
            scale = max_force / force_mag
            fx *= scale
            fy *= scale
            fz *= scale

        return fx, fy, fz
