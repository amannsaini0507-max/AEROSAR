import rclpy
from rclpy.node import Node
from sensor_msgs.msg import Image
from aerosar_msgs.msg import Detection
from cv_bridge import CvBridge
from ultralytics import YOLO


class PerceptionNode(Node):
    def __init__(self):
        super().__init__('perception_node')

        self.model = YOLO('yolov8n.pt')
        self.bridge = CvBridge()

        self.confidence_threshold = 0.5

        self.subscription = self.create_subscription(
            Image,
            '/camera/image_raw',
            self.image_callback,
            10
        )

        self.publisher_ = self.create_publisher(Detection, '/perception/person', 10)

        self.get_logger().info('Perception node started, waiting for camera frames...')

    def image_callback(self, msg: Image):
        cv_image = self.bridge.imgmsg_to_cv2(msg, desired_encoding='bgr8')
        results = self.model(cv_image, verbose=False)

        for result in results:
            for box in result.boxes:
                cls_id = int(box.cls[0])
                class_name = self.model.names[cls_id]

                if class_name != 'person':
                    continue

                confidence = float(box.conf[0])
                if confidence < self.confidence_threshold:
                    continue

                x1, y1, x2, y2 = box.xyxy[0].tolist()
                bbox_w = x2 - x1
                bbox_h = y2 - y1

                if bbox_w < 20 or bbox_h < 20:
                    continue

                detection = Detection()
                detection.id = f'person_{cls_id}_{int(x1)}_{int(y1)}'
                detection.detection_type = 'person'
                detection.confidence = confidence
                detection.bbox_x = x1
                detection.bbox_y = y1
                detection.bbox_w = bbox_w
                detection.bbox_h = bbox_h
                detection.thermal_confirmed = False
                detection.latitude = 0.0
                detection.longitude = 0.0
                detection.altitude = 0.0
                detection.stamp = msg.header.stamp

                self.publisher_.publish(detection)
                self.get_logger().info(
                    f'Published person detection, confidence={confidence:.2f}'
                )


def main(args=None):
    rclpy.init(args=args)
    node = PerceptionNode()
    rclpy.spin(node)
    node.destroy_node()
    rclpy.shutdown()


if __name__ == '__main__':
    main()
