#!/usr/bin/env python3
"""
AEROSAR Member 4 — Backend & Data Integration Bridge Node
Subscribes: /perception/detection, /perception/hazard, /rescue/risk_score, /alerts/emergency, /mission/status
"""

import rclpy
from rclpy.node import Node
from aerosar_msgs.msg import Detection, Hazard, RiskScore, Alert, MissionStatus


class BackendBridgeNode(Node):
    def __init__(self):
        super().__init__('bridge_node')

        self.sub_detection = self.create_subscription(
            Detection, '/perception/detection', self.detection_callback, 10
        )
        self.sub_hazard = self.create_subscription(
            Hazard, '/perception/hazard', self.hazard_callback, 10
        )
        self.sub_risk = self.create_subscription(
            RiskScore, '/rescue/risk_score', self.risk_callback, 10
        )
        self.sub_alert = self.create_subscription(
            Alert, '/alerts/emergency', self.alert_callback, 10
        )
        self.sub_status = self.create_subscription(
            MissionStatus, '/mission/status', self.status_callback, 10
        )

        self.get_logger().info('BackendBridgeNode initialized successfully.')

    def detection_callback(self, msg: Detection):
        self.get_logger().info(f'Bridge received detection: {msg.id} ({msg.detection_type})')

    def hazard_callback(self, msg: Hazard):
        self.get_logger().info(f'Bridge received hazard: {msg.id} ({msg.hazard_type})')

    def risk_callback(self, msg: RiskScore):
        self.get_logger().info(f'Bridge received risk score for detection: {msg.detection_id}')

    def alert_callback(self, msg: Alert):
        self.get_logger().info(f'Bridge received alert: {msg.alert_id} ({msg.alert_type})')

    def status_callback(self, msg: MissionStatus):
        pass


def main(args=None):
    rclpy.init(args=args)
    node = BackendBridgeNode()
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
