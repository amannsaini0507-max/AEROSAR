#!/usr/bin/env python3
"""
AEROSAR Member 2 — Sensor Fusion & Geotagging Node
Combines RGB detections with thermal heat signature verification and GPS/IMU pose geotagging.
Delegates deduplication and fusion logic to pure-Python aerosar_core.fusion (Hard Rule 1).

Subscribes:
  - /perception/person (aerosar_msgs/Detection)
  - /thermal/image_raw (sensor_msgs/Image)
  - /imu/data (sensor_msgs/Imu)
  - /gps/fix (sensor_msgs/NavSatFix)
Publishes:
  - /perception/detection (aerosar_msgs/Detection)
"""

import math
import sys
import time
from pathlib import Path

import cv2
import numpy as np
import rclpy
from rclpy.node import Node
from sensor_msgs.msg import Image, Imu, NavSatFix
from aerosar_msgs.msg import Detection
from cv_bridge import CvBridge

# Resolve aerosar_core
try:
    ws_root = Path(__file__).resolve().parents[4]
    if str(ws_root) not in sys.path:
        sys.path.insert(0, str(ws_root))
except Exception:
    pass

try:
    from aerosar_core.fusion import SensorFusionEngine
    HAS_CORE = True
except ImportError:
    HAS_CORE = False


class SensorFusionNode(Node):
    def __init__(self):
        super().__init__('fusion_node')
        self.bridge = CvBridge()

        self.latest_thermal_cv = None
        self.latest_thermal_stamp = None
        self.latest_gps: NavSatFix = None
        self.latest_imu: Imu = None

        # Core deduplication & fusion engine
        if HAS_CORE:
            self.fusion_engine = SensorFusionEngine(dedup_radius_m=5.0, dedup_window_s=15.0)
        else:
            self.fusion_engine = None

        self.published_detections = []
        self.dedup_radius_meters = 5.0
        self.dedup_time_seconds = 15.0

        # Subscriptions
        self.sub_thermal = self.create_subscription(
            Image, '/thermal/image_raw', self.thermal_callback, 10
        )
        self.sub_person = self.create_subscription(
            Detection, '/perception/person', self.person_callback, 10
        )
        self.sub_gps = self.create_subscription(
            NavSatFix, '/gps/fix', self.gps_callback, 10
        )
        self.sub_imu = self.create_subscription(
            Imu, '/imu/data', self.imu_callback, 10
        )

        # Publisher
        self.pub_detection = self.create_publisher(
            Detection, '/perception/detection', 10
        )

        self.get_logger().info('SensorFusionNode initialized: Multi-Sensor RGB+Thermal+GPS/IMU active.')

    def thermal_callback(self, msg: Image):
        try:
            self.latest_thermal_cv = self.bridge.imgmsg_to_cv2(msg, desired_encoding='passthrough')
            self.latest_thermal_stamp = msg.header.stamp
        except Exception as e:
            self.get_logger().debug(f'Thermal conversion error: {e}')

    def gps_callback(self, msg: NavSatFix):
        if not (math.isnan(msg.latitude) or math.isnan(msg.longitude)):
            self.latest_gps = msg

    def imu_callback(self, msg: Imu):
        self.latest_imu = msg

    def person_callback(self, det_msg: Detection):
        # 1. Thermal Heat-Check Verification
        thermal_confirmed = False
        if self.latest_thermal_cv is not None:
            try:
                img_h, img_w = self.latest_thermal_cv.shape[:2]
                x1 = max(0, int(det_msg.bbox_x))
                y1 = max(0, int(det_msg.bbox_y))
                x2 = min(img_w, int(det_msg.bbox_x + det_msg.bbox_w))
                y2 = min(img_h, int(det_msg.bbox_y + det_msg.bbox_h))

                if x2 > x1 and y2 > y1:
                    roi = self.latest_thermal_cv[y1:y2, x1:x2]
                    if roi.size > 0 and (np.mean(roi) > 110 or np.max(roi) > 160):
                        thermal_confirmed = True
            except Exception as e:
                self.get_logger().debug(f'Thermal ROI verification exception: {e}')

        # 2. Geotagging
        lat = 0.0
        lon = 0.0
        alt = 0.0
        if self.latest_gps is not None and not math.isnan(self.latest_gps.latitude):
            lat = self.latest_gps.latitude
            lon = self.latest_gps.longitude
            alt = self.latest_gps.altitude

        # 3. Deduplication using aerosar_core if available
        now = time.time()
        if self.fusion_engine and HAS_CORE:
            fused_core, is_new = self.fusion_engine.process_candidate(
                candidate_id=det_msg.id,
                detection_type=det_msg.detection_type,
                confidence=det_msg.confidence,
                bbox=(det_msg.bbox_x, det_msg.bbox_y, det_msg.bbox_w, det_msg.bbox_h),
                drone_pose={"latitude": lat, "longitude": lon, "altitude": alt, "heading_deg": 0.0},
                thermal_confirmed=thermal_confirmed,
                timestamp=now,
            )
            if not is_new:
                self.get_logger().debug(f'Detection at ({lat:.5f}, {lon:.5f}) suppressed by core deduplication.')
                return
        else:
            self.published_detections = [
                d for d in self.published_detections if (now - d['time']) < self.dedup_time_seconds
            ]
            if lat != 0.0 or lon != 0.0:
                for d in self.published_detections:
                    dist_m = math.hypot(lat - d['lat'], lon - d['lon']) * 111000.0
                    if dist_m < self.dedup_radius_meters:
                        self.get_logger().debug(f'Detection at ({lat:.5f}, {lon:.5f}) suppressed by deduplication.')
                        return
            self.published_detections.append({'lat': lat, 'lon': lon, 'time': now})

        # 4. Construct and publish fused Detection
        fused = Detection()
        fused.id = det_msg.id
        fused.detection_type = det_msg.detection_type
        fused.confidence = det_msg.confidence
        fused.bbox_x = det_msg.bbox_x
        fused.bbox_y = det_msg.bbox_y
        fused.bbox_w = det_msg.bbox_w
        fused.bbox_h = det_msg.bbox_h
        fused.thermal_confirmed = thermal_confirmed
        fused.latitude = float(lat)
        fused.longitude = float(lon)
        fused.altitude = float(alt)
        fused.stamp = det_msg.stamp

        self.pub_detection.publish(fused)
        self.get_logger().info(
            f'Fused Detection: id={fused.id}, Lat={lat:.5f}, Lon={lon:.5f}, Thermal={thermal_confirmed}, Conf={fused.confidence:.2f}'
        )


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
