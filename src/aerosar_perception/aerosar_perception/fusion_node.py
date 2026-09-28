#!/usr/bin/env python3
"""
AEROSAR Member 2 — Sensor Fusion & Geotagging Node
Subscribes: /perception/person, /imu/data, /gps/fix
Publishes: /perception/detection (aerosar_msgs/Detection)
"""

import rclpy
from rclpy.node import Node
from sensor_msgs.msg import Imu, NavSatFix
from aerosar_msgs.msg import Detection


class SensorFusionNode(Node):
    def __init__(self):
        super().__init__('fusion_node')

        self.latest_imu = None
        self.latest_gps = None

        self.sub_imu = self.create_subscription(
            Imu, '/imu/data', self.imu_callback, 10
        )
        self.sub_gps = self.create_subscription(
            NavSatFix, '/gps/fix', self.gps_callback, 10
        )
        self.sub_candidate = self.create_subscription(
            Detection, '/perception/person', self.candidate_callback, 10
        )

        self.pub_fused_detection = self.create_publisher(
            Detection, '/perception/detection', 10
        )

        self.get_logger().info('SensorFusionNode initialized successfully.')

    def imu_callback(self, msg: Imu):
        self.latest_imu = msg

    def gps_callback(self, msg: NavSatFix):
        self.latest_gps = msg

    def candidate_callback(self, msg: Detection):
        # Geotag and fuse telemetry with candidate detection
        fused = msg
        if self.latest_gps is not None:
            fused.latitude = self.latest_gps.latitude
            fused.longitude = self.latest_gps.longitude
            fused.altitude = self.latest_gps.altitude
        self.pub_fused_detection.publish(fused)


def main(args=None):
    rclpy.init(args=args)
    node = SensorFusionNode()
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
