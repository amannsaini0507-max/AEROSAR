#!/usr/bin/env python3
"""
AEROSAR Member 2 — AI / Computer Vision Perception Node
Subscribes: /camera/image_raw
Publishes:
  - /perception/person (aerosar_msgs/Detection)
  - /perception/hazard (aerosar_msgs/Hazard)
"""

import time
import uuid
import numpy as np
import cv2
import rclpy
from rclpy.node import Node
from sensor_msgs.msg import Image
from aerosar_msgs.msg import Detection, Hazard
from cv_bridge import CvBridge

# Deterministic hazard detection HSV ranges (Webots disaster world compatible)
HAZARD_COLOR_RANGES = {
    'fire': [((0, 140, 140), (18, 255, 255)), ((165, 140, 140), (180, 255, 255))],
    'smoke': [((0, 0, 90), (180, 45, 190))],
    'flood': [((90, 70, 70), (135, 255, 255))],
    'debris': [((15, 30, 30), (35, 160, 160))],
}
MIN_HAZARD_PIXEL_COUNT = 450


class PerceptionNode(Node):
    def __init__(self):
        super().__init__('perception_node')
        self.bridge = CvBridge()
        self.confidence_threshold = 0.40

        # Try initializing YOLOv8, fallback to OpenCV HOG person detector
        self.use_yolo = False
        self.yolo_model = None
        try:
            from ultralytics import YOLO
            self.yolo_model = YOLO('yolov8n.pt')
            self.use_yolo = True
            self.get_logger().info('PerceptionNode: YOLOv8 model loaded successfully.')
        except Exception as e:
            self.get_logger().warn(f'PerceptionNode: YOLO initialization fallback to OpenCV HOG: {e}')
            self.hog = cv2.HOGDescriptor()
            self.hog.setSVMDetector(cv2.HOGDescriptor_getDefaultPeopleDetector())

        # Hazard detection cooldown tracking
        self.last_hazard_publish_times = {}
        self.hazard_cooldown_seconds = 2.0

        # Subscriptions
        self.sub_camera = self.create_subscription(
            Image, '/camera/image_raw', self.camera_callback, 10
        )

        # Publishers
        self.pub_person = self.create_publisher(Detection, '/perception/person', 10)
        self.pub_hazard = self.create_publisher(Hazard, '/perception/hazard', 10)

        self.get_logger().info('PerceptionNode ready. Subscribed to /camera/image_raw.')

    def camera_callback(self, msg: Image):
        try:
            cv_image = self.bridge.imgmsg_to_cv2(msg, desired_encoding='bgr8')
        except Exception as e:
            self.get_logger().error(f'CvBridge conversion error: {e}')
            return

        # 1. Person Detection
        self._detect_persons(cv_image, msg)

        # 2. Hazard Detection
        self._detect_hazards(cv_image, msg)

    def _detect_persons(self, cv_image: np.ndarray, source_msg: Image):
        h, w = cv_image.shape[:2]

        if self.use_yolo and self.yolo_model is not None:
            try:
                results = self.yolo_model(cv_image, verbose=False)
                for result in results:
                    for box in result.boxes:
                        cls_id = int(box.cls[0])
                        class_name = self.yolo_model.names.get(cls_id, '')
                        if class_name != 'person':
                            continue

                        conf = float(box.conf[0])
                        if conf < self.confidence_threshold:
                            continue

                        x1, y1, x2, y2 = box.xyxy[0].tolist()
                        bw = x2 - x1
                        bh = y2 - y1
                        if bw < 15 or bh < 15:
                            continue

                        self._publish_person_detection(x1, y1, bw, bh, conf, source_msg)
                return
            except Exception as e:
                self.get_logger().warn(f'YOLO inference error, switching to HOG fallback: {e}')
                self.use_yolo = False

        # OpenCV HOG Fallback
        if hasattr(self, 'hog'):
            try:
                boxes, weights = self.hog.detectMultiScale(cv_image, winStride=(8, 8), padding=(4, 4), scale=1.05)
                for (x, y, bw, bh), weight in zip(boxes, weights):
                    conf = float(min(1.0, max(0.4, weight)))
                    if conf >= self.confidence_threshold:
                        self._publish_person_detection(float(x), float(y), float(bw), float(bh), conf, source_msg)
            except Exception as e:
                self.get_logger().error(f'HOG detection error: {e}')

    def _publish_person_detection(self, x, y, w, h, confidence: float, source_msg: Image):
        det = Detection()
        det.id = f"person_{int(time.time()*1000)}_{int(x)}_{int(y)}"
        det.detection_type = 'person'
        det.confidence = float(confidence)
        det.bbox_x = float(x)
        det.bbox_y = float(y)
        det.bbox_w = float(w)
        det.bbox_h = float(h)
        det.thermal_confirmed = False
        det.latitude = 0.0
        det.longitude = 0.0
        det.altitude = 0.0
        det.stamp = source_msg.header.stamp
        self.pub_person.publish(det)
        self.get_logger().info(f'Perception: Person detected (conf={confidence:.2f}, bbox=[{int(x)},{int(y)},{int(w)},{int(h)}])')

    def _detect_hazards(self, cv_image: np.ndarray, source_msg: Image):
        hsv = cv2.cvtColor(cv_image, cv2.COLOR_BGR2HSV)
        current_time = time.time()
        img_pixels = cv_image.shape[0] * cv_image.shape[1]

        for hazard_type, ranges in HAZARD_COLOR_RANGES.items():
            mask = np.zeros(hsv.shape[:2], dtype=np.uint8)
            for lower, upper in ranges:
                mask |= cv2.inRange(hsv, np.array(lower), np.array(upper))

            pixel_count = int(np.count_nonzero(mask))
            if pixel_count < MIN_HAZARD_PIXEL_COUNT:
                continue

            last_time = self.last_hazard_publish_times.get(hazard_type, 0.0)
            if (current_time - last_time) >= self.hazard_cooldown_seconds:
                confidence = float(min(1.0, pixel_count / (img_pixels * 0.12)))
                haz = Hazard()
                haz.id = f"{hazard_type}_{str(uuid.uuid4())[:8]}"
                haz.hazard_type = hazard_type
                haz.confidence = confidence
                haz.latitude = 0.0
                haz.longitude = 0.0
                haz.stamp = source_msg.header.stamp
                self.pub_hazard.publish(haz)
                self.last_hazard_publish_times[hazard_type] = current_time
                self.get_logger().info(f'Perception: Hazard detected: {hazard_type} (conf={confidence:.2f})')


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
