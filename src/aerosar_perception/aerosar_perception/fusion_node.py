#!/usr/bin/env python3
import rclpy
from rclpy.node import Node
from sensor_msgs.msg import Image, NavSatFix
from aerosar_msgs.msg import Detection
from cv_bridge import CvBridge
import cv2
import numpy as np
import math
import time

class FusionNode(Node):
    def __init__(self):
        super().__init__('fusion_node')
        self.bridge = CvBridge()
        
        self.latest_thermal_cv = None
        self.latest_thermal_stamp = None
        self.latest_gps = None
        
        # Day 6: Deduplication cache
        self.published_detections = []
        self.dedup_radius_meters = 5.0
        self.dedup_time_seconds = 15.0
        
        self.thermal_sub = self.create_subscription(Image, '/thermal/image_raw', self.thermal_callback, 10)
        self.person_sub = self.create_subscription(Detection, '/perception/person', self.person_callback, 10)
        self.gps_sub = self.create_subscription(NavSatFix, '/gps/fix', self.gps_callback, 10)
            
        self.publisher = self.create_publisher(Detection, '/perception/detection', 10)
        self.get_logger().info('Fusion Node initialized: Day 6 Deduplication active.')

    def thermal_callback(self, msg: Image):
        try:
            self.latest_thermal_cv = self.bridge.imgmsg_to_cv2(msg, desired_encoding='passthrough')
            self.latest_thermal_stamp = msg.header.stamp
        except Exception:
            pass

    def gps_callback(self, msg: NavSatFix):
        self.latest_gps = msg

    def person_callback(self, det_msg: Detection):
        thermal_confirmed = False
        
        # 1. Thermal Confirmation Logic
        if self.latest_thermal_cv is not None and self.latest_thermal_stamp is not None:
            det_time = det_msg.stamp.sec + (det_msg.stamp.nanosec * 1e-9)
            therm_time = self.latest_thermal_stamp.sec + (self.latest_thermal_stamp.nanosec * 1e-9)
            if abs(det_time - therm_time) <= 0.1:
                x, y, w, h = int(det_msg.bbox_x), int(det_msg.bbox_y), int(det_msg.bbox_w), int(det_msg.bbox_h)
                img_h, img_w = self.latest_thermal_cv.shape[:2]
                x1, y1, x2, y2 = max(0, x), max(0, y), min(img_w, x + w), min(img_h, y + h)
                roi = self.latest_thermal_cv[y1:y2, x1:x2]
                if roi.size > 0 and np.mean(roi) > 120: 
                    thermal_confirmed = True

        final_det = det_msg
        final_det.thermal_confirmed = thermal_confirmed
        
        if self.latest_gps is not None:
            final_det.latitude = self.latest_gps.latitude
            final_det.longitude = self.latest_gps.longitude
            final_det.altitude = self.latest_gps.altitude
        else:
            final_det.latitude = 0.0
            final_det.longitude = 0.0
            final_det.altitude = 0.0

        # 2. Day 6: Deduplication Logic
        current_time = time.time()
        # Clear out memories older than 15 seconds
        self.published_detections = [d for d in self.published_detections if current_time - d['time'] < self.dedup_time_seconds]
        
        is_duplicate = False
        for d in self.published_detections:
            # Calculate distance using rough metric conversion
            dist_m = math.hypot(final_det.latitude - d['lat'], final_det.longitude - d['lon']) * 111000
            if dist_m < self.dedup_radius_meters:
                is_duplicate = True
                break

        if is_duplicate:
            self.get_logger().info('Detection ignored (Day 6 Deduplication: duplicate blocked).')
        else:
            self.publisher.publish(final_det)
            self.published_detections.append({'lat': final_det.latitude, 'lon': final_det.longitude, 'time': current_time})
            self.get_logger().info(f'Published NEW detection: Lat: {final_det.latitude:.4f}, Lon: {final_det.longitude:.4f}')

def main(args=None):
    rclpy.init(args=args)
    node = FusionNode()
    rclpy.spin(node)
    node.destroy_node()
    rclpy.shutdown()

if __name__ == '__main__':
    main()
