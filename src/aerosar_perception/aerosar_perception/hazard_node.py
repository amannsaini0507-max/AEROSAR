#!/usr/bin/env python3
"""
hazard_detector_node.py
Deterministic hazard detection via color-thresholding on /camera/image_raw.
No trained model — per Section 8.2, hazards are detected via tagged
simulation objects, not ML. If Member 1 exposes object metadata/name tags
instead of relying on color, swap the per-hazard color check for a metadata
lookup and keep everything else (publishing) unchanged.

Tune the HSV ranges below once you see real Webots footage — these are
reasonable starting points, not guaranteed exact matches to your sim's
textures.
"""

import rclpy
from rclpy.node import Node
from sensor_msgs.msg import Image
from aerosar_msgs.msg import Hazard   # adjust import path if your package differs
import numpy as np
import cv2
import uuid
from cv_bridge import CvBridge

# HSV color ranges — TUNE THESE against real Webots screenshots.
# Format: list of (lower_HSV, upper_HSV) tuples per hazard type.
HAZARD_COLOR_RANGES = {
    'fire':               [((0, 150, 150), (15, 255, 255)), ((165, 150, 150), (180, 255, 255))],  # red/orange
    'smoke':              [((0, 0, 100), (180, 40, 200))],       # low-saturation gray
    'flood':              [((90, 80, 80), (130, 255, 255))],     # blue
    'debris':             [((15, 40, 40), (30, 150, 150))],      # dull brown/tan
    'damaged_structure':  [((0, 0, 40), (180, 30, 100))],        # dark gray
}

MIN_HAZARD_PIXEL_COUNT = 500   # minimum matching pixels to count as a real detection, not noise


class HazardDetectorNode(Node):
    def __init__(self):
        super().__init__('hazard_detector_node')

        self.bridge = CvBridge()
        self.last_publish_times = {}  # Tracks the last time a hazard type was published
        self.cooldown_seconds = 2.0   # 2-second cooldown to prevent network spam

        self.subscription = self.create_subscription(
            Image,
            '/camera/image_raw',
            self.image_callback,
            10
        )

        self.publisher_ = self.create_publisher(Hazard, '/perception/hazard', 10)
        self.get_logger().info('Hazard detector node started, subscribed to /camera/image_raw.')

    def image_callback(self, msg: Image):
        # 1. Safely convert ROS Image to OpenCV BGR format
        try:
            img = self.bridge.imgmsg_to_cv2(msg, desired_encoding='bgr8')
        except Exception as e:
            self.get_logger().error(f'CvBridge error: {e}')
            return

        hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
        current_time = self.get_clock().now().nanoseconds / 1e9

        for hazard_type, ranges in HAZARD_COLOR_RANGES.items():
            mask = np.zeros(hsv.shape[:2], dtype=np.uint8)
            for lower, upper in ranges:
                mask |= cv2.inRange(hsv, np.array(lower), np.array(upper))

            pixel_count = int(np.count_nonzero(mask))
            if pixel_count < MIN_HAZARD_PIXEL_COUNT:
                continue

            # 2. Check the cooldown timer before publishing
            last_time = self.last_publish_times.get(hazard_type, 0.0)
            if (current_time - last_time) >= self.cooldown_seconds:
                # Dynamic confidence scaling based on screen percentage
                confidence = min(1.0, pixel_count / (hsv.shape[0] * hsv.shape[1] * 0.15))
                self.publish_hazard(hazard_type, confidence, msg)
                
                # Reset the clock for this specific hazard type
                self.last_publish_times[hazard_type] = current_time

    def publish_hazard(self, hazard_type, confidence, source_msg: Image):
        haz = Hazard()
        haz.id = str(uuid.uuid4())
        haz.hazard_type = hazard_type
        haz.confidence = confidence
        haz.latitude = 0.0   # filled properly once geotagging is wired in, matching your Detection pipeline
        haz.longitude = 0.0
        haz.stamp = source_msg.header.stamp
        self.publisher_.publish(haz)
        self.get_logger().info(f'Published hazard: {hazard_type} (confidence={confidence:.2f})')


def main(args=None):
    rclpy.init(args=args)
    node = HazardDetectorNode()
    rclpy.spin(node)
    node.destroy_node()
    rclpy.shutdown()


if __name__ == '__main__':
    main()
