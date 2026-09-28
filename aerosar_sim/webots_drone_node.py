"""
AEROSAR Webots Drone Driver Node
Member 1 — Drone Simulation & ROS 2 Lead

ROS 2 driver node and webots_ros2_driver plugin for the AEROSAR Search & Rescue drone.
Interfaces with Webots DJI Mavic 2 Pro simulation:
- Publishes /camera/image_raw (sensor_msgs/Image) @ ~30Hz
- Publishes /thermal/image_raw (sensor_msgs/Image) @ ~10Hz
- Publishes /imu/data (sensor_msgs/Imu) @ ~50Hz
- Publishes /gps/fix (sensor_msgs/NavSatFix) @ ~10Hz
- Subscribes to /navigation/cmd_vel (geometry_msgs/Twist) @ ~20Hz
- Graceful shutdown handling and comprehensive hardware device checks
"""

import math
import sys
import time
from typing import Optional

import rclpy
from rclpy.node import Node
from rclpy.executors import ExternalShutdownException
from geometry_msgs.msg import Twist
from sensor_msgs.msg import Image, Imu, NavSatFix, NavSatStatus
from std_msgs.msg import Bool


def clamp(value: float, value_min: float, value_max: float) -> float:
    return min(max(value, value_min), value_max)


class WebotsDroneNode:
    """
    ROS 2 driver interface and Webots controller plugin for the AEROSAR quadrotor drone.
    Operates as a webots_ros2_driver plugin or standalone ROS 2 driver node.
    """

    # DJI Mavic 2 Pro physical equilibrium and PID constants
    K_VERTICAL_THRUST = 68.5   # Equilibrium motor speed (rad/s) for hover
    K_VERTICAL_OFFSET = 0.6    # Altitude stabilization offset
    K_VERTICAL_P = 3.0         # Proportional gain for vertical PID
    K_ROLL_P = 50.0            # Proportional gain for roll PID
    K_PITCH_P = 30.0           # Proportional gain for pitch PID

    def __init__(self):
        self.__robot = None
        self.__node: Optional[Node] = None
        self.__owns_node = False
        self.__timestep = 8

        # Devices
        self.__camera = None
        self.__thermal_camera = None
        self.__imu = None
        self.__gyro = None
        self.__accel = None
        self.__gps = None
        self.__camera_pitch = None

        # Motors
        self.__front_left_motor = None
        self.__front_right_motor = None
        self.__rear_left_motor = None
        self.__rear_right_motor = None
        self.__motors_available = False

        # Flight State
        self.__target_altitude = 1.2
        self.__target_twist = Twist()
        self.__last_cmd_vel_time = 0.0

        # Rate Limiting Timers
        self.__last_camera_pub = 0.0
        self.__last_thermal_pub = 0.0
        self.__last_imu_pub = 0.0
        self.__last_gps_pub = 0.0

        # Target Update Intervals
        self.__camera_interval = 1.0 / 30.0    # ~30 Hz
        self.__thermal_interval = 1.0 / 10.0   # ~10 Hz
        self.__imu_interval = 1.0 / 50.0       # ~50 Hz
        self.__gps_interval = 1.0 / 10.0       # ~10 Hz

        # ROS 2 Entities
        self.__camera_pub = None
        self.__thermal_pub = None
        self.__imu_pub = None
        self.__gps_pub = None
        self.__cmd_vel_sub = None

    @property
    def node(self) -> Optional[Node]:
        return self.__node

    def init(self, webots_node, properties):
        """
        webots_ros2_driver plugin entry point.
        Called by Webots ROS 2 supervisor/driver upon loading the robot controller.
        """
        self.__robot = webots_node.robot
        self.__timestep = int(self.__robot.getBasicTimeStep())

        # Initialize ROS 2 node context
        if hasattr(webots_node, 'node') and webots_node.node is not None:
            self.__node = webots_node.node
            self.__owns_node = False
        else:
            if not rclpy.ok():
                rclpy.init(args=None)
            self.__node = rclpy.create_node('webots_drone_node')
            self.__owns_node = True

        self.__setup_ros_interfaces()
        self.__setup_webots_devices()
        self.__node.get_logger().info('WebotsDroneNode initialized successfully.')

    def create_standalone_node(self):
        """Initializes ROS 2 interfaces when running standalone without webots_ros2_driver supervisor."""
        if not rclpy.ok():
            rclpy.init(args=None)
        if self.__node is None:
            self.__node = rclpy.create_node('webots_drone_node')
            self.__owns_node = True
        self.__setup_ros_interfaces()

    def __setup_ros_interfaces(self):
        """Initializes all publishers and subscribers matching project specification."""
        # Publishers
        self.__camera_pub = self.__node.create_publisher(Image, '/camera/image_raw', 10)
        self.__thermal_pub = self.__node.create_publisher(Image, '/thermal/image_raw', 10)
        self.__imu_pub = self.__node.create_publisher(Imu, '/imu/data', 10)
        self.__gps_pub = self.__node.create_publisher(NavSatFix, '/gps/fix', 10)

        # Subscribers
        self.__cmd_vel_sub = self.__node.create_subscription(
            Twist,
            '/navigation/cmd_vel',
            self.__cmd_vel_callback,
            10
        )
        # Also subscribe to /cmd_vel for fallback/manual control
        self.__node.create_subscription(
            Twist,
            '/cmd_vel',
            self.__cmd_vel_callback,
            10
        )

        self.__node.get_logger().info(
            'ROS 2 topics bound: /camera/image_raw (~30Hz), /thermal/image_raw (~10Hz), '
            '/imu/data (~50Hz), /gps/fix (~10Hz), /navigation/cmd_vel (~20Hz)'
        )

    def __setup_webots_devices(self):
        """Discovers, validates, and enables simulated robot hardware devices."""
        logger = self.__node.get_logger()

        # 1. RGB Camera
        self.__camera = self.__robot.getDevice('camera')
        if self.__camera:
            self.__camera.enable(self.__timestep)
            logger.info(f"RGB Camera enabled: {self.__camera.getWidth()}x{self.__camera.getHeight()} @ timestep={self.__timestep}ms")
        else:
            logger.warn("Webots device 'camera' not found on robot.")

        # 2. Thermal Camera Proxy
        self.__thermal_camera = self.__robot.getDevice('thermal_camera')
        if self.__thermal_camera:
            self.__thermal_camera.enable(self.__timestep)
            logger.info(f"Thermal Camera enabled: {self.__thermal_camera.getWidth()}x{self.__thermal_camera.getHeight()} @ timestep={self.__timestep}ms")
        else:
            logger.warn("Webots device 'thermal_camera' not found on robot.")

        # 3. Inertial Unit
        self.__imu = self.__robot.getDevice('inertial unit')
        if self.__imu:
            self.__imu.enable(self.__timestep)
            logger.info("Inertial Unit enabled.")
        else:
            logger.warn("Webots device 'inertial unit' not found on robot.")

        # 4. Gyroscope
        self.__gyro = self.__robot.getDevice('gyro')
        if self.__gyro:
            self.__gyro.enable(self.__timestep)
            logger.info("Gyroscope enabled.")
        else:
            logger.warn("Webots device 'gyro' not found on robot.")

        # 5. Accelerometer
        self.__accel = self.__robot.getDevice('accelerometer')
        if self.__accel:
            self.__accel.enable(self.__timestep)
            logger.info("Accelerometer enabled.")
        else:
            logger.info("Webots device 'accelerometer' not found (using gravity fallback).")

        # 6. GPS
        self.__gps = self.__robot.getDevice('gps')
        if self.__gps:
            self.__gps.enable(self.__timestep)
            logger.info("GPS enabled.")
        else:
            logger.warn("Webots device 'gps' not found on robot.")

        # 7. Propeller Motors
        self.__front_left_motor = self.__robot.getDevice('front left propeller')
        self.__front_right_motor = self.__robot.getDevice('front right propeller')
        self.__rear_left_motor = self.__robot.getDevice('rear left propeller')
        self.__rear_right_motor = self.__robot.getDevice('rear right propeller')

        motors = [
            self.__front_left_motor, self.__front_right_motor,
            self.__rear_left_motor, self.__rear_right_motor
        ]
        if all(m is not None for m in motors):
            self.__motors_available = True
            for m in motors:
                m.setPosition(float('inf'))
                m.setVelocity(0.0)
            logger.info("All 4 quadrotor motors initialized and armed.")
        else:
            missing = [name for name, m in zip(
                ['front left', 'front right', 'rear left', 'rear right'], motors
            ) if m is None]
            logger.warn(f"Missing propeller motors: {missing}. Motor drive disabled.")

        # 8. Gimbal pitch
        self.__camera_pitch = self.__robot.getDevice('camera pitch')
        if self.__camera_pitch:
            self.__camera_pitch.setPosition(0.2)

    def __cmd_vel_callback(self, twist: Twist):
        """Handles incoming velocity commands from navigation subsystem."""
        self.__target_twist = twist
        self.__last_cmd_vel_time = time.time()

    def step(self):
        """
        Simulation step callback called every simulation tick by Webots driver.
        Executes sensor acquisition, rate-limited publishing, and motor control.
        """
        if self.__node is None:
            return

        try:
            # Process incoming ROS 2 callbacks
            rclpy.spin_once(self.__node, timeout_sec=0)

            now = time.time()
            now_stamp = self.__node.get_clock().now().to_msg()

            # -------------------------------------------------------------
            # 1. Publish /camera/image_raw @ ~30Hz
            # -------------------------------------------------------------
            if (now - self.__last_camera_pub) >= self.__camera_interval:
                self.__last_camera_pub = now
                if self.__camera:
                    img_data = self.__camera.getImage()
                    if img_data is not None:
                        img_msg = Image()
                        img_msg.header.stamp = now_stamp
                        img_msg.header.frame_id = 'camera_link'
                        img_msg.height = self.__camera.getHeight()
                        img_msg.width = self.__camera.getWidth()
                        img_msg.encoding = 'bgra8'
                        img_msg.is_bigendian = 0
                        img_msg.step = self.__camera.getWidth() * 4
                        img_msg.data = bytes(img_data)
                        self.__camera_pub.publish(img_msg)

            # -------------------------------------------------------------
            # 2. Publish /thermal/image_raw @ ~10Hz
            # -------------------------------------------------------------
            if (now - self.__last_thermal_pub) >= self.__thermal_interval:
                self.__last_thermal_pub = now
                if self.__thermal_camera:
                    thermal_data = self.__thermal_camera.getImage()
                    if thermal_data is not None:
                        t_msg = Image()
                        t_msg.header.stamp = now_stamp
                        t_msg.header.frame_id = 'thermal_camera_link'
                        t_msg.height = self.__thermal_camera.getHeight()
                        t_msg.width = self.__thermal_camera.getWidth()
                        t_msg.encoding = 'bgra8'
                        t_msg.is_bigendian = 0
                        t_msg.step = self.__thermal_camera.getWidth() * 4
                        t_msg.data = bytes(thermal_data)
                        self.__thermal_pub.publish(t_msg)

            # -------------------------------------------------------------
            # 3. Read Pose & Sensors
            # -------------------------------------------------------------
            roll, pitch, yaw = 0.0, 0.0, 0.0
            if self.__imu:
                rpy = self.__imu.getRollPitchYaw()
                if rpy and len(rpy) >= 3 and not math.isnan(rpy[0]):
                    roll, pitch, yaw = rpy[0], rpy[1], rpy[2]

            gyro_vals = [0.0, 0.0, 0.0]
            if self.__gyro:
                g = self.__gyro.getValues()
                if g and len(g) >= 3 and not math.isnan(g[0]):
                    gyro_vals = g

            accel_vals = [0.0, 0.0, 9.81]
            if self.__accel:
                a = self.__accel.getValues()
                if a and len(a) >= 3 and not math.isnan(a[0]):
                    accel_vals = a

            altitude = self.__target_altitude
            x_pos, y_pos = 0.0, 0.0
            gps_valid = False
            if self.__gps:
                gps_vals = self.__gps.getValues()
                if gps_vals and len(gps_vals) >= 3 and not math.isnan(gps_vals[0]):
                    x_pos, y_pos, altitude = gps_vals[0], gps_vals[1], gps_vals[2]
                    gps_valid = True

            # -------------------------------------------------------------
            # 4. Publish /imu/data @ ~50Hz
            # -------------------------------------------------------------
            if (now - self.__last_imu_pub) >= self.__imu_interval:
                self.__last_imu_pub = now
                if self.__imu or self.__gyro or self.__accel:
                    # Euler to Quaternion conversion
                    cy = math.cos(yaw * 0.5)
                    sy = math.sin(yaw * 0.5)
                    cp = math.cos(pitch * 0.5)
                    sp = math.sin(pitch * 0.5)
                    cr = math.cos(roll * 0.5)
                    sr = math.sin(roll * 0.5)

                    qw = cr * cp * cy + sr * sp * sy
                    qx = sr * cp * cy - cr * sp * sy
                    qy = cr * sp * cy + sr * cp * sy
                    qz = cr * cp * sy - sr * cy * sp

                    imu_msg = Imu()
                    imu_msg.header.stamp = now_stamp
                    imu_msg.header.frame_id = 'imu_link'
                    imu_msg.orientation.w = float(qw)
                    imu_msg.orientation.x = float(qx)
                    imu_msg.orientation.y = float(qy)
                    imu_msg.orientation.z = float(qz)
                    imu_msg.angular_velocity.x = float(gyro_vals[0])
                    imu_msg.angular_velocity.y = float(gyro_vals[1])
                    imu_msg.angular_velocity.z = float(gyro_vals[2])
                    imu_msg.linear_acceleration.x = float(accel_vals[0])
                    imu_msg.linear_acceleration.y = float(accel_vals[1])
                    imu_msg.linear_acceleration.z = float(accel_vals[2])
                    self.__imu_pub.publish(imu_msg)

            # -------------------------------------------------------------
            # 5. Publish /gps/fix @ ~10Hz
            # -------------------------------------------------------------
            if (now - self.__last_gps_pub) >= self.__gps_interval:
                self.__last_gps_pub = now
                if gps_valid:
                    fix_msg = NavSatFix()
                    fix_msg.header.stamp = now_stamp
                    fix_msg.header.frame_id = 'gps_link'
                    fix_msg.latitude = 26.9124 + (y_pos / 111111.0)
                    fix_msg.longitude = 75.7873 + (x_pos / (111111.0 * math.cos(math.radians(26.9124))))
                    fix_msg.altitude = float(altitude)
                    fix_msg.status.status = NavSatStatus.STATUS_FIX
                    fix_msg.status.service = NavSatStatus.SERVICE_GPS
                    self.__gps_pub.publish(fix_msg)

            # -------------------------------------------------------------
            # 6. Motor Control from /navigation/cmd_vel
            # -------------------------------------------------------------
            if self.__motors_available:
                dt = self.__timestep / 1000.0

                # Respond to /navigation/cmd_vel or maintain stable hover
                active_cmd = (now - self.__last_cmd_vel_time) < 1.0
                if active_cmd:
                    self.__target_altitude = clamp(
                        self.__target_altitude + self.__target_twist.linear.z * dt,
                        0.2, 10.0
                    )
                    pitch_dist = clamp(-self.__target_twist.linear.x * 1.5, -1.2, 1.2)
                    roll_dist = clamp(self.__target_twist.linear.y * 1.5, -1.2, 1.2)
                    yaw_dist = clamp(-self.__target_twist.angular.z * 0.4, -0.4, 0.4)
                else:
                    # Hover stabilization
                    pitch_dist = 0.0
                    roll_dist = 0.0
                    yaw_dist = 0.0

                roll_accel = gyro_vals[0]
                pitch_accel = gyro_vals[1]

                # Low-level PID attitude and vertical control
                roll_input = self.K_ROLL_P * clamp(roll, -1.0, 1.0) + roll_accel + roll_dist
                pitch_input = self.K_PITCH_P * clamp(pitch, -1.0, 1.0) + pitch_accel + pitch_dist
                yaw_input = yaw_dist

                clamped_diff_alt = clamp(self.__target_altitude - altitude + self.K_VERTICAL_OFFSET, -1.0, 1.0)
                vertical_input = self.K_VERTICAL_P * pow(clamped_diff_alt, 3.0)

                m1 = self.K_VERTICAL_THRUST + vertical_input - yaw_input + pitch_input - roll_input
                m2 = self.K_VERTICAL_THRUST + vertical_input + yaw_input + pitch_input + roll_input
                m3 = self.K_VERTICAL_THRUST + vertical_input + yaw_input - pitch_input - roll_input
                m4 = self.K_VERTICAL_THRUST + vertical_input - yaw_input - pitch_input + roll_input

                self.__front_left_motor.setVelocity(m1)
                self.__front_right_motor.setVelocity(-m2)
                self.__rear_left_motor.setVelocity(-m3)
                self.__rear_right_motor.setVelocity(m4)

        except Exception as e:
            if self.__node:
                self.__node.get_logger().error(f'Error in WebotsDroneNode.step: {e}')

    def destroy(self):
        """Stops motors and releases ROS 2 node resources gracefully."""
        if self.__motors_available:
            for m in [self.__front_left_motor, self.__front_right_motor,
                      self.__rear_left_motor, self.__rear_right_motor]:
                if m:
                    try:
                        m.setVelocity(0.0)
                    except Exception:
                        pass
        if self.__node and self.__owns_node:
            self.__node.get_logger().info('Destroying WebotsDroneNode ROS 2 node.')
            self.__node.destroy_node()


# Export alias for backward compatibility with plugin declarations
DroneDriver = WebotsDroneNode


def main(args=None):
    """Standalone entry point for launching the drone driver node."""
    if not rclpy.ok():
        rclpy.init(args=args)

    driver = WebotsDroneNode()

    # Attempt to attach to Webots controller if running inside Webots extern environment
    try:
        import sys
        if '/usr/local/webots/lib/controller/python' not in sys.path:
            sys.path.append('/usr/local/webots/lib/controller/python')
        from controller import Robot
        robot = Robot()

        class WebotsWrapper:
            def __init__(self, r):
                self.robot = r

        driver.init(WebotsWrapper(robot), {})
        timestep = int(robot.getBasicTimeStep())
        while rclpy.ok() and robot.step(timestep) != -1:
            driver.step()
    except Exception as e:
        # Fallback to standalone ROS 2 node execution
        driver.create_standalone_node()
        driver.node.get_logger().info(f'WebotsDroneNode running in standalone ROS 2 mode ({e})')
        try:
            rclpy.spin(driver.node)
        except (KeyboardInterrupt, ExternalShutdownException):
            pass
    finally:
        driver.destroy()
        if rclpy.ok():
            rclpy.shutdown()


if __name__ == '__main__':
    main()
