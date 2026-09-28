#!/usr/bin/env python3
"""
AEROSAR Member 2 — AI / Computer Vision Perception Node
Subscribes: /camera/image_raw, /thermal/image_raw
Publishes: /perception/person (aerosar_msgs/Detection), /perception/hazard (aerosar_msgs/Hazard)
"""

import rclpy
from rclpy.node import Node
from sensor_msgs.msg import Image
from aerosar_msgs.msg import Detection, Hazard


class PerceptionNode(Node):
    def __init__(self):
        super().__init__('perception_node')

        self.sub_camera = self.create_subscription(
            Image, '/camera/image_raw', self.camera_callback, 10
        )
        self.sub_thermal = self.create_subscription(
            Image, '/thermal/image_raw', self.thermal_callback, 10
        )

        self.pub_person = self.create_publisher(Detection, '/perception/person', 10)
        self.pub_hazard = self.create_publisher(Hazard, '/perception/hazard', 10)

        self.get_logger().info('PerceptionNode initialized successfully.')

    def camera_callback(self, msg: Image):
        # AI/CV candidate extraction pipeline hook
        pass

    def thermal_callback(self, msg: Image):
        # Thermal hotspot analysis pipeline hook
        pass


def main(args=None):
    rclpy.init(args=args)
    node = PerceptionNode()
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
