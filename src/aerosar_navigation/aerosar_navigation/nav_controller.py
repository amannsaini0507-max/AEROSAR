#!/usr/bin/env python3
"""
AEROSAR Member 3 — Autonomous Navigation Controller Node
Subscribes: /gps/fix, /imu/data, /camera/image_raw
Publishes: /navigation/cmd_vel (20 Hz)
"""

import sys
import rclpy
from rclpy.node import Node
from sensor_msgs.msg import NavSatFix, Imu, Image
from geometry_msgs.msg import Twist


class NavigationController(Node):
    def __init__(self):
        super().__init__('nav_controller')
        self.declare_parameter('search_altitude', 1.5)
        self.declare_parameter('max_speed', 0.8)

        self.latest_gps = None
        self.latest_imu = None

        self.sub_gps = self.create_subscription(
            NavSatFix, '/gps/fix', self.gps_callback, 10
        )
        self.sub_imu = self.create_subscription(
            Imu, '/imu/data', self.imu_callback, 10
        )
        self.sub_camera = self.create_subscription(
            Image, '/camera/image_raw', self.camera_callback, 10
        )

        self.pub_cmd_vel = self.create_publisher(
            Twist, '/navigation/cmd_vel', 10
        )

        # 20 Hz control loop timer (0.05s)
        self.timer = self.create_timer(0.05, self.control_loop)
        self.get_logger().info('NavigationController initialized successfully (Publishing /navigation/cmd_vel @ 20Hz).')

    def gps_callback(self, msg: NavSatFix):
        self.latest_gps = msg

    def imu_callback(self, msg: Imu):
        self.latest_imu = msg

    def camera_callback(self, msg: Image):
        pass

    def control_loop(self):
        # Deterministic search velocity command
        cmd = Twist()
        cmd.linear.x = 0.3
        cmd.linear.y = 0.0
        cmd.linear.z = 0.0
        cmd.angular.z = 0.0
        self.pub_cmd_vel.publish(cmd)


def main(args=None):
    rclpy.init(args=args)
    node = NavigationController()
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        node.destroy_node()
        if rclpy.ok():
            rclpy.shutdown()


if __name__ == '__main__':
    main()
