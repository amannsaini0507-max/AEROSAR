#!/usr/bin/env python3
"""
AEROSAR Master Autonomous Navigation Node
Member 3 — Autonomous Navigation / SLAM Lead
SIH 2026 — PS 26177

Features:
- Subscribes to /gps/fix (NavSatFix) and /imu/data (Imu) strictly per Section 7 interface spec
- Subscribes to /camera/image_raw (Image) for visual obstacle detection
- Publishes /navigation/cmd_vel (Twist) at exactly 20 Hz (0.05s timer)
- Executes deterministic serpentine search coverage pattern
- Closed-loop proportional waypoint navigation
- Reactive obstacle avoidance (Master Document Section 10.2 rule)
- Handles GPS-denied transition gracefully with dead-reckoning continuation
"""

import sys
import time
import math
from typing import List, Tuple, Optional

try:
    import rclpy
    from rclpy.node import Node
    from rclpy.qos import QoSProfile, ReliabilityPolicy, HistoryPolicy
    from sensor_msgs.msg import NavSatFix, Imu, Image
    from geometry_msgs.msg import Twist
    from std_msgs.msg import Bool
    ROS2_AVAILABLE = True
except ImportError:
    ROS2_AVAILABLE = False
    rclpy = None

    class Node:
        def __init__(self, node_name: str):
            self.node_name = node_name
            self._params = {}
            self._publishers = []
            self._subscribers = []
            self._timers = []

        def declare_parameter(self, name: str, default_value):
            self._params[name] = type('Param', (), {'value': default_value})()

        def get_parameter(self, name: str):
            return self._params.get(name, type('Param', (), {'value': None})())

        def create_publisher(self, msg_type, topic: str, qos):
            pub = type('Pub', (), {'publish': lambda self, msg: None})()
            self._publishers.append((topic, pub))
            return pub

        def create_subscription(self, msg_type, topic: str, callback, qos):
            sub = type('Sub', (), {'topic': topic, 'callback': callback})()
            self._subscribers.append(sub)
            return sub

        def create_timer(self, period: float, callback):
            timer = type('Timer', (), {'period': period, 'callback': callback})()
            self._timers.append(timer)
            return timer

        def get_logger(self):
            node_name = self.node_name
            class _Logger:
                def info(self, msg):
                    print(f"[{node_name}] INFO: {msg}")
                def warn(self, msg):
                    print(f"[{node_name}] WARN: {msg}")
                def error(self, msg):
                    print(f"[{node_name}] ERROR: {msg}")
            return _Logger()


        def destroy_node(self):
            pass

    class QoSProfile:
        def __init__(self, **kwargs):
            pass

    class ReliabilityPolicy:
        BEST_EFFORT = 1

    class HistoryPolicy:
        KEEP_LAST = 1

    class NavSatFix:
        def __init__(self):
            self.latitude = 0.0
            self.longitude = 0.0
            self.altitude = 0.0

    class Imu:
        def __init__(self):
            self.orientation = type('Quaternion', (), {'x': 0.0, 'y': 0.0, 'z': 0.0, 'w': 1.0})()
            self.linear_acceleration = type('Vector3', (), {'x': 0.0, 'y': 0.0, 'z': 0.0})()

    class Image:
        def __init__(self):
            self.data = b''
            self.width = 0
            self.height = 0
            self.step = 0

    class Bool:
        def __init__(self):
            self.data = False

    from .waypoint_follower import Twist


from .waypoint_follower import (
    WaypointFollower,
    Waypoint,
    CoordinateTransformer,
    quaternion_to_yaw,
    normalize_angle
)
from .search_pattern import SerpentinePatternGenerator
from .obstacle_avoidance import ReactiveObstacleAvoider, AvoidanceState


class AerosarNavigationNode(Node):
    """
    Core Navigation Node for AEROSAR Drone.
    Integrates GPS-enabled serpentine search with reactive obstacle avoidance.
    """

    def __init__(self):
        super().__init__('aerosar_navigation_node')
        self.get_logger().info('Initializing AEROSAR Member 3 Navigation Subsystem...')

        # Declare configurable parameters
        self.declare_parameter('search_x_min', -3.0)
        self.declare_parameter('search_x_max', 3.0)
        self.declare_parameter('search_y_min', -3.0)
        self.declare_parameter('search_y_max', 3.0)
        self.declare_parameter('search_altitude', 1.5)
        self.declare_parameter('lane_spacing', 1.5)
        self.declare_parameter('max_speed', 0.8)
        self.declare_parameter('loop_search', False)
        self.declare_parameter('enable_avoidance', True)
        self.declare_parameter('obstacle_threshold', 2.0)

        # Retrieve parameters
        x_min = self.get_parameter('search_x_min').value
        x_max = self.get_parameter('search_x_max').value
        y_min = self.get_parameter('search_y_min').value
        y_max = self.get_parameter('search_y_max').value
        altitude = self.get_parameter('search_altitude').value
        spacing = self.get_parameter('lane_spacing').value
        max_speed = self.get_parameter('max_speed').value
        loop_mode = self.get_parameter('loop_search').value
        self.enable_avoidance = self.get_parameter('enable_avoidance').value
        obstacle_thresh = self.get_parameter('obstacle_threshold').value

        # Initialize Coordinate Transformer & Controllers
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

        # Static World Obstacle Approximations for Ground-Truth Proximity Safety
        # Extracted from aerosar_world.wbt (Fire, Debris, Smoke)
        self.known_obstacles: List[Tuple[float, float, float]] = [
            (2.5, 2.5, 0.5),   # Fire box
            (-2.5, 2.5, 0.8),  # Debris pile
            (2.8, 2.8, 0.5)    # Smoke zone
        ]

        # Telemetry & State Registers
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

        # Sensor Subscriptions (Member 1 spec: /gps/fix, /imu/data, /camera/image_raw)
        qos_sensor = QoSProfile(
            reliability=ReliabilityPolicy.BEST_EFFORT,
            history=HistoryPolicy.KEEP_LAST,
            depth=10
        )

        self.gps_sub = self.create_subscription(
            NavSatFix, '/gps/fix', self._gps_callback, 10
        )
        self.imu_sub = self.create_subscription(
            Imu, '/imu/data', self._imu_callback, qos_sensor
        )
        self.cam_sub = self.create_subscription(
            Image, '/camera/image_raw', self._camera_callback, 10
        )
        self.gps_denied_sub = self.create_subscription(
            Bool, '/aerosar/gps_denied', self._gps_denied_callback, 10
        )

        # Velocity Command Publisher (Member 1 spec: /navigation/cmd_vel at 20 Hz)
        self.cmd_vel_pub = self.create_publisher(Twist, '/navigation/cmd_vel', 10)

        # 20 Hz High-Precision Control Timer (0.050 seconds = 20 Hz)
        self.control_timer = self.create_timer(0.05, self._control_loop)

        self.get_logger().info(
            f'AEROSAR Navigation Node ready! Serpentine path generated: {len(self.follower.waypoints)} waypoints. '
            f'Publishing to /navigation/cmd_vel at 20 Hz.'
        )

    def _gps_callback(self, msg: NavSatFix):
        """Processes incoming GPS position fixes."""
        self.last_gps_time = time.time()
        self.has_gps_fix = True

        # Convert GNSS coordinates to local Cartesian coordinates (meters)
        lx, ly, lz = self.transformer.gps_to_local(msg.latitude, msg.longitude, msg.altitude)
        self.current_x = lx
        self.current_y = ly
        self.current_z = lz

    def _imu_callback(self, msg: Imu):
        """Extracts yaw heading angle and integrates linear acceleration for dead-reckoning."""
        now = time.time()
        q = msg.orientation
        self.current_yaw = quaternion_to_yaw(q.x, q.y, q.z, q.w)
        
        if self.last_imu_time > 0:
            dt = now - self.last_imu_time
            if 0 < dt < 0.2:
                # Integrate linear acceleration (body frame) to body velocity
                self.vel_x += getattr(msg.linear_acceleration, 'x', 0.0) * dt
                self.vel_y += getattr(msg.linear_acceleration, 'y', 0.0) * dt
                self.vel_z += getattr(msg.linear_acceleration, 'z', 0.0) * dt
                
                # Decay velocity slightly to prevent runaway drift (simplified filtering)
                self.vel_x *= 0.95
                self.vel_y *= 0.95
                self.vel_z *= 0.95
                
                # If GPS is denied, update global position using Dead-Reckoning (Tier 2 SLAM fallback)
                gps_stale = (now - self.last_gps_time) > 1.5
                mode_denied = self.is_gps_denied or (self.has_gps_fix and gps_stale)
                if mode_denied:
                    # Rotate body velocity to global frame using current yaw
                    vx_global = self.vel_x * math.cos(self.current_yaw) - self.vel_y * math.sin(self.current_yaw)
                    vy_global = self.vel_x * math.sin(self.current_yaw) + self.vel_y * math.cos(self.current_yaw)
                    
                    self.current_x += vx_global * dt
                    self.current_y += vy_global * dt
                    self.current_z += self.vel_z * dt
                    
        self.last_imu_time = now

    def _camera_callback(self, msg: Image):
        """Evaluates forward camera feed for reactive visual obstacle detection."""
        if not self.enable_avoidance:
            return
        self.last_camera_obstacle = self.avoider.evaluate_camera_frame(
            bytes(msg.data), msg.width, msg.height, msg.step
        )

    def _gps_denied_callback(self, msg: Bool):
        """Handles explicit GPS-denied simulation notification."""
        prev = self.is_gps_denied
        self.is_gps_denied = msg.data
        if self.is_gps_denied and not prev:
            self.get_logger().warn(
                '[NAVIGATION] GPS Signal Lost! Switching to GPS_DENIED dead-reckoning continuation.'
            )
        elif not self.is_gps_denied and prev:
            self.get_logger().info(
                '[NAVIGATION] GPS Signal Restored! Returning to normal GPS waypoint tracking.'
            )

    def _control_loop(self):
        """
        20 Hz Control Loop:
        1. Verifies sensor readiness / GPS loss detection
        2. Evaluates obstacle proximity and camera triggers
        3. Executes reactive avoidance state machine or normal waypoint guidance
        4. Publishes Twist to /navigation/cmd_vel
        """
        now = time.time()

        # Check if GPS signal has timed out (> 1.5s since last fix)
        gps_stale = (now - self.last_gps_time) > 1.5
        mode_denied = self.is_gps_denied or (self.has_gps_fix and gps_stale)

        # If waiting for initial sensor acquisition
        if not self.has_gps_fix:
            # Emit zero-velocity hover until first telemetry arrives
            hover = Twist()
            self.cmd_vel_pub.publish(hover)
            return

        # ==========================================================
        # 1. Obstacle Detection Check
        # ==========================================================
        obstacle_detected = False
        if self.enable_avoidance:
            # Proximity check
            prox_hit = self.avoider.evaluate_proximity(
                self.current_x, self.current_y, self.current_yaw, self.known_obstacles
            )
            obstacle_detected = prox_hit or self.last_camera_obstacle

        # ==========================================================
        # 2. Avoidance State Machine Update
        # ==========================================================
        avoid_cmd, avoid_state = self.avoider.update(
            obstacle_detected, self.current_yaw, now=now
        )

        if avoid_cmd is not None:
            # Avoidance maneuver overrides normal waypoint tracking
            # Maintain cruise altitude during avoidance
            dz = self.follower.waypoints[0].z - self.current_z if self.follower.waypoints else 0.0
            avoid_cmd.linear.z = min(0.3, max(-0.3, 1.2 * dz))
            self.cmd_vel_pub.publish(avoid_cmd)
            self.total_commands_sent += 1
            return

        # ==========================================================
        # 3. Normal Waypoint Following (GPS Mode A + Dead-Reckoning Mode B)
        # ==========================================================
        cmd, wp_reached, is_finished = self.follower.compute_control(
            self.current_x, self.current_y, self.current_z, self.current_yaw
        )

        if wp_reached:
            coverage = self.pattern_gen.calculate_coverage_percentage(self.follower.current_idx)
            self.get_logger().info(
                f'[WAYPOINT] Reached Waypoint {self.follower.current_idx}/{len(self.follower.waypoints)} | '
                f'Search Coverage: {coverage:.1f}% | Pose: ({self.current_x:.2f}, {self.current_y:.2f})'
            )

        if is_finished:
            self.get_logger().info('[MISSION_COMPLETE] Search mission completed! Hovering in place.')
            cmd = Twist()  # Stop drone

        self.cmd_vel_pub.publish(cmd)
        self.total_commands_sent += 1


def main(args=None):
    rclpy.init(args=args)
    node = AerosarNavigationNode()
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        node.get_logger().info('AEROSAR Navigation Node stopped by user.')
    finally:
        # Publish final zero-velocity command to safely stop drone
        stop_cmd = Twist()
        node.cmd_vel_pub.publish(stop_cmd)
        node.destroy_node()
        if rclpy.ok():
            rclpy.shutdown()


if __name__ == '__main__':
    main()
