#!/usr/bin/env python3
"""
AEROSAR Navigation Test & Verification Suite
Member 3 — Autonomous Navigation / SLAM Lead
SIH 2026 — PS 26177

Audits and verifies:
1. Coordinate transformation accuracy (GPS WGS-84 <-> Local ENU metric coordinates)
2. IMU Quaternion to Euler Heading (Yaw) extraction
3. Serpentine (lawnmower) path coverage generation and progress percentage estimation
4. Waypoint follower closed-loop guidance, heading alignment, and waypoint advancement
5. Reactive rule-based obstacle avoidance state machine (stop -> yaw -> clearance step -> resume)
6. Autonomous navigation node integration & 20 Hz cmd_vel command generation
"""

import sys
import os
import math
import unittest

# Ensure project root is in sys.path
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(SCRIPT_DIR)
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

from navigation.waypoint_follower import (
    CoordinateTransformer,
    quaternion_to_yaw,
    normalize_angle,
    clamp,
    Waypoint,
    WaypointFollower,
    Twist
)
from navigation.search_pattern import SerpentinePatternGenerator
from navigation.obstacle_avoidance import ReactiveObstacleAvoider, AvoidanceState
from navigation.navigation_node import AerosarNavigationNode, NavSatFix, Imu, Image, Bool


class TestCoordinateTransform(unittest.TestCase):
    """Tests GNSS WGS-84 to local Cartesian ENU translation."""

    def setUp(self):
        self.transformer = CoordinateTransformer(lat_0=26.9124, lon_0=75.7873, alt_0=0.0)

    def test_datum_origin(self):
        """Origin coordinates must convert exactly to (0.0, 0.0, 0.0)."""
        x, y, z = self.transformer.gps_to_local(26.9124, 75.7873, 1.5)
        self.assertAlmostEqual(x, 0.0, places=4)
        self.assertAlmostEqual(y, 0.0, places=4)
        self.assertAlmostEqual(z, 1.5, places=4)

    def test_roundtrip_precision(self):
        """Converting local -> GPS -> local must preserve sub-millimeter precision."""
        orig_x, orig_y, orig_z = 3.5, -2.8, 2.0
        lat, lon, alt = self.transformer.local_to_gps(orig_x, orig_y, orig_z)
        rec_x, rec_y, rec_z = self.transformer.gps_to_local(lat, lon, alt)
        self.assertAlmostEqual(orig_x, rec_x, places=3)
        self.assertAlmostEqual(orig_y, rec_y, places=3)
        self.assertAlmostEqual(orig_z, rec_z, places=3)

    def test_quaternion_yaw_extraction(self):
        """Verifies quaternion to Euler yaw heading conversions."""
        # 0 deg (facing East / +X)
        self.assertAlmostEqual(quaternion_to_yaw(0, 0, 0, 1), 0.0, places=3)
        # +90 deg (facing North / +Y)
        q_90 = math.sin(math.pi / 4)
        self.assertAlmostEqual(quaternion_to_yaw(0, 0, q_90, q_90), math.pi / 2, places=3)
        # 180 deg
        self.assertAlmostEqual(abs(quaternion_to_yaw(0, 0, 1, 0)), math.pi, places=3)
        # -90 deg
        self.assertAlmostEqual(quaternion_to_yaw(0, 0, -q_90, q_90), -math.pi / 2, places=3)


class TestSearchPattern(unittest.TestCase):
    """Tests serpentine / lawnmower coverage pattern generator."""

    def test_serpentine_grid_generation(self):
        generator = SerpentinePatternGenerator(
            x_min=-3.0, x_max=3.0,
            y_min=-3.0, y_max=3.0,
            altitude=1.5, lane_spacing=1.5
        )
        wps = generator.get_waypoints()
        self.assertGreater(len(wps), 6)

        # Check altitude consistency
        for wp in wps:
            self.assertEqual(wp.z, 1.5)
            self.assertTrue(-3.0 <= wp.x <= 3.0)
            self.assertTrue(-3.0 <= wp.y <= 3.0)

        # Check East-West alternating sweeps
        self.assertAlmostEqual(wps[0].x, -3.0)
        self.assertAlmostEqual(wps[1].x, 3.0)
        self.assertAlmostEqual(wps[2].x, 3.0)
        self.assertAlmostEqual(wps[3].x, -3.0)

    def test_coverage_metrics(self):
        generator = SerpentinePatternGenerator(
            x_min=-2.0, x_max=2.0,
            y_min=-2.0, y_max=2.0,
            altitude=1.5, lane_spacing=1.0
        )
        self.assertEqual(generator.total_search_area(), 16.0)
        self.assertGreater(generator.total_path_distance(), 16.0)
        self.assertEqual(generator.calculate_coverage_percentage(0), 0.0)
        total_wps = len(generator.get_waypoints())
        self.assertEqual(generator.calculate_coverage_percentage(total_wps), 100.0)


class TestWaypointFollower(unittest.TestCase):
    """Tests closed-loop waypoint tracking and command generation."""

    def setUp(self):
        self.waypoints = [
            Waypoint(x=0.0, y=3.0, z=1.5, radius=0.5),
            Waypoint(x=3.0, y=3.0, z=1.5, radius=0.5)
        ]
        self.follower = WaypointFollower(self.waypoints, yaw_sign=-1.0)

    def test_aligned_flight(self):
        """When drone heading is aligned with target, applies forward thrust."""
        # Drone at (0, 0, 1.5) facing North (+pi/2). Target is at (0, 3, 1.5)
        cmd, reached, done = self.follower.compute_control(
            current_x=0.0, current_y=0.0, current_z=1.5, current_yaw=math.pi / 2
        )
        self.assertFalse(reached)
        self.assertFalse(done)
        self.assertGreater(cmd.linear.x, 0.1)
        self.assertAlmostEqual(cmd.angular.z, 0.0, places=2)

    def test_misaligned_heading_turn(self):
        """When drone heading is perpendicular to target, prioritizes yaw rotation."""
        # Drone at (0, 0, 1.5) facing East (0.0). Target is North (+pi/2).
        cmd, reached, done = self.follower.compute_control(
            current_x=0.0, current_y=0.0, current_z=1.5, current_yaw=0.0
        )
        self.assertFalse(reached)
        # Angular Z should command a turn
        self.assertNotEqual(cmd.angular.z, 0.0)
        # Forward speed should be clamped low
        self.assertLessEqual(cmd.linear.x, 0.1)

    def test_waypoint_advancement_and_completion(self):
        """When drone enters waypoint radius, advances to next waypoint and completes."""
        # Step into radius of WP 1 (0, 3)
        cmd, reached, done = self.follower.compute_control(
            current_x=0.0, current_y=2.8, current_z=1.5, current_yaw=math.pi / 2
        )
        self.assertTrue(reached)
        self.assertEqual(self.follower.current_idx, 1)

        # Step into radius of WP 2 (3, 3)
        cmd, reached, done = self.follower.compute_control(
            current_x=2.9, current_y=3.0, current_z=1.5, current_yaw=0.0
        )
        self.assertTrue(reached)
        self.assertTrue(done)
        self.assertTrue(self.follower.is_finished())


class TestReactiveObstacleAvoidance(unittest.TestCase):
    """Tests Section 10.2 reactive rule-based avoidance state transitions."""

    def setUp(self):
        self.avoider = ReactiveObstacleAvoider(
            threshold_distance=2.0,
            yaw_increment_rad=math.radians(45.0),
            brake_duration_sec=0.5,
            clearance_duration_sec=1.0,
            yaw_sign=-1.0
        )

    def test_proximity_detection(self):
        """Detects obstacle ahead within threshold distance."""
        obstacles = [(2.0, 2.0, 0.5)]
        # Drone at (2.0, 0.5) heading North (pi/2) -> Obstacle is directly ahead at dist = 1.0m
        hit = self.avoider.evaluate_proximity(2.0, 0.5, math.pi / 2, obstacles)
        self.assertTrue(hit)

        # Drone at (2.0, 0.5) heading South (-pi/2) -> Obstacle is behind drone
        hit_behind = self.avoider.evaluate_proximity(2.0, 0.5, -math.pi / 2, obstacles)
        self.assertFalse(hit_behind)

    def test_state_machine_transitions(self):
        """Verifies CLEAR -> STOP_BRAKE -> YAW_INCREMENT -> CLEARANCE_MANEUVER -> CLEAR."""
        t0 = 100.0
        # 1. Trigger avoidance
        cmd, state = self.avoider.update(obstacle_detected=True, current_yaw=0.0, now=t0)
        self.assertEqual(state, AvoidanceState.STOP_BRAKE)
        self.assertEqual(cmd.linear.x, 0.0)

        # 2. In brake phase
        cmd, state = self.avoider.update(obstacle_detected=True, current_yaw=0.0, now=t0 + 0.2)
        self.assertEqual(state, AvoidanceState.STOP_BRAKE)

        # 3. Brake expired -> Yaw increment phase
        cmd, state = self.avoider.update(obstacle_detected=False, current_yaw=0.0, now=t0 + 0.6)
        self.assertEqual(state, AvoidanceState.YAW_INCREMENT)
        self.assertNotEqual(cmd.angular.z, 0.0)

        # 4. Target yaw reached -> Clearance maneuver
        target_yaw = self.avoider.target_yaw
        cmd, state = self.avoider.update(obstacle_detected=False, current_yaw=target_yaw, now=t0 + 1.2)
        self.assertEqual(state, AvoidanceState.CLEARANCE_MANEUVER)
        self.assertGreater(cmd.linear.x, 0.0)

        # 5. Clearance expired -> Normal navigation restored
        cmd, state = self.avoider.update(obstacle_detected=False, current_yaw=target_yaw, now=t0 + 2.5)
        self.assertEqual(state, AvoidanceState.CLEAR)
        self.assertIsNone(cmd)


class TestNavigationNode(unittest.TestCase):
    """Tests end-to-end integration of AerosarNavigationNode."""

    def test_node_execution_cycle(self):
        node = AerosarNavigationNode()
        self.assertEqual(len(node.follower.waypoints), len(node.pattern_gen.waypoints))

        # Feed GPS fix at datum origin
        gps_msg = NavSatFix()
        gps_msg.latitude = 26.9124
        gps_msg.longitude = 75.7873
        gps_msg.altitude = 1.5
        node._gps_callback(gps_msg)
        self.assertTrue(node.has_gps_fix)
        self.assertAlmostEqual(node.current_x, 0.0, places=3)
        self.assertAlmostEqual(node.current_y, 0.0, places=3)

        # Feed IMU orientation
        imu_msg = Imu()
        imu_msg.orientation.w = 1.0
        node._imu_callback(imu_msg)
        self.assertAlmostEqual(node.current_yaw, 0.0, places=3)

        # Execute one 20 Hz control loop iteration
        node._control_loop()
        self.assertGreater(node.total_commands_sent, 0)

        # Simulate GPS Denied transition
        denied_msg = Bool()
        denied_msg.data = True
        node._gps_denied_callback(denied_msg)
        self.assertTrue(node.is_gps_denied)

        # In GPS denied mode, control loop maintains safe dead-reckoning velocity
        node._control_loop()
        self.assertGreater(node.total_commands_sent, 1)


class TestSafeRoutePlanning(unittest.TestCase):
    """Tests Phase 16 Safe Route Planning (A* over hazard grid)."""

    def setUp(self):
        from navigation.safe_route import AStarPlanner, HazardZone
        self.planner = AStarPlanner(resolution=1.0, max_cost=100.0)
        self.planner.add_hazard(HazardZone(x=2.0, y=2.0, radius=1.0, severity=1.0))
        
    def test_open_terrain_route(self):
        """Tests that a clear path is straight and respects heuristics."""
        path = self.planner.plan_route((0.0, 0.0), (0.0, 5.0))
        self.assertGreater(len(path), 0)
        self.assertEqual(path[0], (0.0, 0.0))
        self.assertEqual(path[-1], (0.0, 5.0))

    def test_hazard_avoidance(self):
        """Tests that the path bends around a hazard rather than going through it."""
        path = self.planner.plan_route((0.0, 2.0), (5.0, 2.0))
        self.assertGreater(len(path), 0)
        
        # Verify it didn't just walk straight through the hazard at (2.0, 2.0)
        for (x, y) in path:
            dist_to_hazard = math.hypot(x - 2.0, y - 2.0)
            self.assertGreaterEqual(dist_to_hazard, 0.9)  # Should avoid the core radius


def run_tests():
    print("=" * 70)
    print("  [AEROSAR] Member 3 Autonomous Navigation Unit & Integration Tests")
    print("=" * 70 + "\n")
    suite = unittest.TestLoader().loadTestsFromNames([
        'navigation.test_navigation.TestCoordinateTransform',
        'navigation.test_navigation.TestSearchPattern',
        'navigation.test_navigation.TestWaypointFollower',
        'navigation.test_navigation.TestReactiveObstacleAvoidance',
        'navigation.test_navigation.TestNavigationNode',
        'navigation.test_navigation.TestSafeRoutePlanning'
    ])
    runner = unittest.TextTestRunner(verbosity=2)
    result = runner.run(suite)

    print("\n" + "=" * 70)
    if result.wasSuccessful():
        print("  [PASS] All Member 3 Navigation & Avoidance Tests Succeeded! (100% Pass)")
        print("=" * 70 + "\n")
        return 0
    else:
        print("  [FAIL] Some tests failed. Inspect errors above.")
        print("=" * 70 + "\n")
        return 1



if __name__ == '__main__':
    sys.exit(run_tests())
