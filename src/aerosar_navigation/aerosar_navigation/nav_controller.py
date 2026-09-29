#!/usr/bin/env python3
"""
AEROSAR Member 3 — Autonomous Navigation Controller Node
Executes serpentine/lawnmower coverage search patterns on /navigation/cmd_vel @ 20Hz.
Implements reactive obstacle avoidance and GPS-denied dead-reckoning fallback when /gps/fix
receives invalid or NaN values.
"""

import sys
import time
import math
from typing import List, Tuple, Optional

import rclpy
from rclpy.node import Node
from rclpy.qos import QoSProfile, ReliabilityPolicy, HistoryPolicy
from sensor_msgs.msg import NavSatFix, Imu, Image
from geometry_msgs.msg import Twist
from std_msgs.msg import Bool

from .waypoint_follower import (
    WaypointFollower,
    Waypoint,
    CoordinateTransformer,
    quaternion_to_yaw,
    normalize_angle
)
from .search_pattern import SerpentinePatternGenerator
from .obstacle_avoidance import ReactiveObstacleAvoider, AvoidanceState
from .safe_route import AStarPlanner, HazardZone


class NavigationController(Node):
    """
    Core Autonomous Navigation Node for AEROSAR Drone (Member 3).
    Integrates GPS-enabled serpentine search, reactive obstacle avoidance,
    and GPS-denied dead-reckoning fallback.
    """

    def __init__(self):
        super().__init__('nav_controller')
        self.get_logger().info('Initializing AEROSAR Member 3 Autonomous Navigation Subsystem...')

        # Declare configurable parameters
        self.declare_parameter('search_x_min', -4.0)
        self.declare_parameter('search_x_max', 4.0)
        self.declare_parameter('search_y_min', -4.0)
        self.declare_parameter('search_y_max', 4.0)
        self.declare_parameter('search_altitude', 1.5)
        self.declare_parameter('lane_spacing', 1.5)
        self.declare_parameter('max_speed', 0.8)
        self.declare_parameter('loop_search', True)
        self.declare_parameter('enable_avoidance', True)
        self.declare_parameter('obstacle_threshold', 2.0)

        # Retrieve parameters
        x_min = float(self.get_parameter('search_x_min').value)
        x_max = float(self.get_parameter('search_x_max').value)
        y_min = float(self.get_parameter('search_y_min').value)
        y_max = float(self.get_parameter('search_y_max').value)
        altitude = float(self.get_parameter('search_altitude').value)
        spacing = float(self.get_parameter('lane_spacing').value)
        max_speed = float(self.get_parameter('max_speed').value)
        loop_mode = bool(self.get_parameter('loop_search').value)
        self.enable_avoidance = bool(self.get_parameter('enable_avoidance').value)
        obstacle_thresh = float(self.get_parameter('obstacle_threshold').value)

        # Coordinate Transformer & Waypoint Controllers
        self.transformer = CoordinateTransformer(lat_0=26.9124, lon_0=75.7873, alt_0=0.0)
        self.pattern_gen = SerpentinePatternGenerator(
            x_min=x_min, x_max=x_max,
            y_min=y_min, y_max=y_max,
            altitude=altitude, lane_spacing=spacing
        )
        self.follower = WaypointFollower(
            waypoints=self.pattern_gen.get_waypoints(),
            max_linear_x=max_speed,
            yaw_sign=-1.0
        )
        self.follower.is_looping = loop_mode

        self.avoider = ReactiveObstacleAvoider(
            threshold_distance=obstacle_thresh,
            yaw_increment_rad=math.radians(45.0),
            yaw_sign=-1.0
        )

        # Known static obstacle zones for proximity safety checks
        self.known_obstacles: List[Tuple[float, float, float]] = [
            (2.5, 2.5, 0.5),   # Fire zone
            (-2.5, 2.5, 0.8),  # Debris pile
            (2.8, 2.8, 0.5),   # Smoke zone
            (5.0, 4.0, 1.0)    # Collapsed slab
        ]

        # Drone State
        self.current_x = 0.0
        self.current_y = 0.0
        self.current_z = 0.0
        self.current_yaw = 0.0
        self.vel_x = 0.0
        self.vel_y = 0.0
        self.vel_z = 0.0
        self.last_imu_time = 0.0
        self.last_gps_time = 0.0
        self.has_gps_fix = False
        self.is_gps_denied = False
        self.last_camera_obstacle = False
        self.total_commands_sent = 0

        # Subscriptions
        qos_sensor = QoSProfile(
            reliability=ReliabilityPolicy.BEST_EFFORT,
            history=HistoryPolicy.KEEP_LAST,
            depth=10
        )

        self.sub_gps = self.create_subscription(
            NavSatFix, '/gps/fix', self.gps_callback, 10
        )
        self.sub_imu = self.create_subscription(
            Imu, '/imu/data', self.imu_callback, qos_sensor
        )
        self.sub_camera = self.create_subscription(
            Image, '/camera/image_raw', self.camera_callback, 10
        )
        self.sub_gps_denied = self.create_subscription(
            Bool, '/aerosar/gps_denied', self.gps_denied_callback, 10
        )
        self.sub_force_gps_denied = self.create_subscription(
            Bool, '/aerosar/force_gps_denied', self.gps_denied_callback, 10
        )

        # Publisher (20 Hz cmd_vel)
        self.pub_cmd_vel = self.create_publisher(Twist, '/navigation/cmd_vel', 10)

        # 20 Hz timer (0.050 seconds)
        self.control_timer = self.create_timer(0.05, self.control_loop)

        self.get_logger().info(
            f'NavigationController active: {len(self.follower.waypoints)} serpentine waypoints. '
            'Publishing to /navigation/cmd_vel @ 20Hz.'
        )

    def gps_callback(self, msg: NavSatFix):
        now = time.time()
        # Validate GPS data
        if math.isnan(msg.latitude) or math.isnan(msg.longitude) or math.isnan(msg.altitude):
            if not self.is_gps_denied:
                self.is_gps_denied = True
                self.get_logger().warn('Received NaN GPS values! Falling back to GPS-denied dead-reckoning.')
            return

        # Valid fix received
        self.last_gps_time = now
        self.has_gps_fix = True
        if self.is_gps_denied:
            self.is_gps_denied = False
            self.get_logger().info('GPS signal restored from fix callback.')

        lx, ly, lz = self.transformer.gps_to_local(msg.latitude, msg.longitude, msg.altitude)
        self.current_x = lx
        self.current_y = ly
        self.current_z = lz

    def imu_callback(self, msg: Imu):
        now = time.time()
        q = msg.orientation
        self.current_yaw = quaternion_to_yaw(q.x, q.y, q.z, q.w)

        if self.last_imu_time > 0:
            dt = now - self.last_imu_time
            if 0 < dt < 0.2:
                # Integrate linear acceleration for dead-reckoning
                ax = getattr(msg.linear_acceleration, 'x', 0.0)
                ay = getattr(msg.linear_acceleration, 'y', 0.0)
                az = getattr(msg.linear_acceleration, 'z', 0.0)
                self.vel_x += ax * dt
                self.vel_y += ay * dt
                self.vel_z += az * dt

                # Velocity damping
                self.vel_x *= 0.95
                self.vel_y *= 0.95
                self.vel_z *= 0.95

                # GPS-denied dead-reckoning integration
                gps_stale = (now - self.last_gps_time) > 1.5
                if self.is_gps_denied or (self.has_gps_fix and gps_stale):
                    vx_global = self.vel_x * math.cos(self.current_yaw) - self.vel_y * math.sin(self.current_yaw)
                    vy_global = self.vel_x * math.sin(self.current_yaw) + self.vel_y * math.cos(self.current_yaw)
                    self.current_x += vx_global * dt
                    self.current_y += vy_global * dt
                    self.current_z += self.vel_z * dt

        self.last_imu_time = now

    def camera_callback(self, msg: Image):
        if not self.enable_avoidance:
            return
        try:
            self.last_camera_obstacle = self.avoider.evaluate_camera_frame(
                bytes(msg.data), msg.width, msg.height, msg.step
            )
        except Exception:
            pass

    def gps_denied_callback(self, msg: Bool):
        prev = self.is_gps_denied
        self.is_gps_denied = bool(msg.data)
        if self.is_gps_denied and not prev:
            self.get_logger().warn('GPS Signal Cut triggered! Switched to GPS-Denied Dead-Reckoning.')
        elif not self.is_gps_denied and prev:
            self.get_logger().info('GPS Signal Restored triggered! Switched back to GPS Waypoint Tracking.')

    def control_loop(self):
        now = time.time()

        # If waiting for first telemetry fix
        if not self.has_gps_fix and self.last_imu_time == 0.0:
            hover = Twist()
            self.pub_cmd_vel.publish(hover)
            return

        # 1. Obstacle Detection
        obstacle_detected = False
        if self.enable_avoidance:
            prox_hit = self.avoider.evaluate_proximity(
                self.current_x, self.current_y, self.current_yaw, self.known_obstacles
            )
            obstacle_detected = prox_hit or self.last_camera_obstacle

        # 2. Avoidance State Machine
        avoid_cmd, avoid_state = self.avoider.update(obstacle_detected, self.current_yaw, now=now)
        if avoid_cmd is not None:
            # Maintain altitude during avoidance
            target_alt = self.follower.waypoints[0].z if self.follower.waypoints else 1.5
            dz = target_alt - self.current_z
            avoid_cmd.linear.z = min(0.3, max(-0.3, 1.2 * dz))
            self.pub_cmd_vel.publish(avoid_cmd)
            self.total_commands_sent += 1
            return

        # 3. Serpentine Waypoint Following
        cmd, wp_reached, is_finished = self.follower.compute_control(
            self.current_x, self.current_y, self.current_z, self.current_yaw
        )

        if wp_reached:
            coverage = self.pattern_gen.calculate_coverage_percentage(self.follower.current_idx)
            self.get_logger().info(
                f'Waypoint reached: {self.follower.current_idx}/{len(self.follower.waypoints)} | '
                f'Coverage: {coverage:.1f}% | Pos: ({self.current_x:.2f}, {self.current_y:.2f})'
            )

        if is_finished:
            cmd = Twist()

        self.pub_cmd_vel.publish(cmd)
        self.total_commands_sent += 1


def main(args=None):
    rclpy.init(args=args)
    node = NavigationController()
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        stop_cmd = Twist()
        node.pub_cmd_vel.publish(stop_cmd)
        node.destroy_node()
        if rclpy.ok():
            rclpy.shutdown()


if __name__ == '__main__':
    main()
