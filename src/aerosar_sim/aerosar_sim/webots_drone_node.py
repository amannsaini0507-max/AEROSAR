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
"""

import math
import os
import re
import socket
import subprocess
import sys
import time
from typing import Optional

# Ensure Webots native controller python module takes precedence over any ROS packages
if '/usr/local/webots/lib/controller/python' not in sys.path:
    sys.path.insert(0, '/usr/local/webots/lib/controller/python')

import rclpy
from rclpy.node import Node
from rclpy.executors import ExternalShutdownException
from geometry_msgs.msg import Twist
from sensor_msgs.msg import Image, Imu, NavSatFix, NavSatStatus


def clamp(value: float, value_min: float, value_max: float) -> float:
    return min(max(value, value_min), value_max)


class WebotsDroneNode:
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
        self.__synthetic_timer = None
        self.__synthetic_step_count = 0

    @property
    def node(self) -> Optional[Node]:
        return self.__node

    def init(self, webots_node, properties):
        self.__robot = webots_node.robot
        self.__timestep = int(self.__robot.getBasicTimeStep())

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
        self.__node.get_logger().info('WebotsDroneNode initialized successfully with active Webots robot.')

    def create_standalone_node(self):
        if not rclpy.ok():
            rclpy.init(args=None)
        if self.__node is None:
            self.__node = rclpy.create_node('webots_drone_node')
            self.__owns_node = True
        self.__setup_ros_interfaces()
        # Active synthetic frame generation timer if running in standalone ROS mode
        self.__synthetic_timer = self.__node.create_timer(1.0 / 30.0, self.__synthetic_publish_step)
        self.__node.get_logger().info('WebotsDroneNode initialized in standalone mode with synthetic telemetry active.')

    def __setup_ros_interfaces(self):
        self.__camera_pub = self.__node.create_publisher(Image, '/camera/image_raw', 10)
        self.__thermal_pub = self.__node.create_publisher(Image, '/thermal/image_raw', 10)
        self.__imu_pub = self.__node.create_publisher(Imu, '/imu/data', 10)
        self.__gps_pub = self.__node.create_publisher(NavSatFix, '/gps/fix', 10)

        self.__cmd_vel_sub = self.__node.create_subscription(
            Twist, '/navigation/cmd_vel', self.__cmd_vel_callback, 10
        )
        self.__node.create_subscription(
            Twist, '/cmd_vel', self.__cmd_vel_callback, 10
        )

    def __setup_webots_devices(self):
        logger = self.__node.get_logger()

        # RGB Camera
        self.__camera = self.__robot.getDevice('camera')
        if self.__camera:
            self.__camera.enable(self.__timestep)
            logger.info(f"RGB Camera enabled: {self.__camera.getWidth()}x{self.__camera.getHeight()} @ {self.__timestep}ms")

        # Thermal Camera
        self.__thermal_camera = self.__robot.getDevice('thermal_camera')
        if self.__thermal_camera:
            self.__thermal_camera.enable(self.__timestep)
            logger.info(f"Thermal Camera enabled: {self.__thermal_camera.getWidth()}x{self.__thermal_camera.getHeight()} @ {self.__timestep}ms")

        # IMU, Gyro, Accel
        self.__imu = self.__robot.getDevice('inertial unit')
        if self.__imu:
            self.__imu.enable(self.__timestep)

        self.__gyro = self.__robot.getDevice('gyro')
        if self.__gyro:
            self.__gyro.enable(self.__timestep)

        self.__accel = self.__robot.getDevice('accelerometer')
        if self.__accel:
            self.__accel.enable(self.__timestep)

        # GPS
        self.__gps = self.__robot.getDevice('gps')
        if self.__gps:
            self.__gps.enable(self.__timestep)

        # Propellers
        self.__front_left_motor = self.__robot.getDevice('front left propeller')
        self.__front_right_motor = self.__robot.getDevice('front right propeller')
        self.__rear_left_motor = self.__robot.getDevice('rear left propeller')
        self.__rear_right_motor = self.__robot.getDevice('rear right propeller')

        motors = [self.__front_left_motor, self.__front_right_motor,
                  self.__rear_left_motor, self.__rear_right_motor]
        if all(motors):
            self.__motors_available = True
            for m in motors:
                m.setPosition(float('inf'))
                m.setVelocity(self.K_VERTICAL_THRUST)

    def __cmd_vel_callback(self, msg: Twist):
        self.__target_twist = msg
        self.__last_cmd_vel_time = time.time()
        if abs(msg.linear.z) > 0.05:
            self.__target_altitude = clamp(self.__target_altitude + msg.linear.z * 0.05, 0.5, 10.0)

    def step(self):
        if not self.__robot or not self.__node:
            return

        try:
            now = time.time()
            now_stamp = self.__node.get_clock().now().to_msg()

            # 1. Publish /camera/image_raw (~30Hz)
            if (now - self.__last_camera_pub) >= self.__camera_interval:
                self.__last_camera_pub = now
                if self.__camera:
                    img_data = self.__camera.getImage()
                    if img_data:
                        msg = Image()
                        msg.header.stamp = now_stamp
                        msg.header.frame_id = 'camera_link'
                        msg.height = self.__camera.getHeight()
                        msg.width = self.__camera.getWidth()
                        msg.encoding = 'bgra8'
                        msg.is_bigendian = 0
                        msg.step = self.__camera.getWidth() * 4
                        msg.data = bytes(img_data)
                        self.__camera_pub.publish(msg)

            # 2. Publish /thermal/image_raw (~10Hz)
            if (now - self.__last_thermal_pub) >= self.__thermal_interval:
                self.__last_thermal_pub = now
                if self.__thermal_camera:
                    t_data = self.__thermal_camera.getImage()
                    if t_data:
                        t_msg = Image()
                        t_msg.header.stamp = now_stamp
                        t_msg.header.frame_id = 'thermal_camera_link'
                        t_msg.height = self.__thermal_camera.getHeight()
                        t_msg.width = self.__thermal_camera.getWidth()
                        t_msg.encoding = 'bgra8'
                        t_msg.is_bigendian = 0
                        t_msg.step = self.__thermal_camera.getWidth() * 4
                        t_msg.data = bytes(t_data)
                        self.__thermal_pub.publish(t_msg)

            # 3. Read Sensors & Motors
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

            # 4. Publish /imu/data (~50Hz)
            if (now - self.__last_imu_pub) >= self.__imu_interval:
                self.__last_imu_pub = now
                cy = math.cos(yaw * 0.5)
                sy = math.sin(yaw * 0.5)
                cp = math.cos(pitch * 0.5)
                sp = math.sin(pitch * 0.5)
                cr = math.cos(roll * 0.5)
                sr = math.sin(roll * 0.5)

                imu_msg = Imu()
                imu_msg.header.stamp = now_stamp
                imu_msg.header.frame_id = 'imu_link'
                imu_msg.orientation.w = float(cr * cp * cy + sr * sp * sy)
                imu_msg.orientation.x = float(sr * cp * cy - cr * sp * sy)
                imu_msg.orientation.y = float(cr * sp * cy + sr * cp * sy)
                imu_msg.orientation.z = float(cr * cp * sy - sr * cy * sp)
                imu_msg.angular_velocity.x = float(gyro_vals[0])
                imu_msg.angular_velocity.y = float(gyro_vals[1])
                imu_msg.angular_velocity.z = float(gyro_vals[2])
                imu_msg.linear_acceleration.x = float(accel_vals[0])
                imu_msg.linear_acceleration.y = float(accel_vals[1])
                imu_msg.linear_acceleration.z = float(accel_vals[2])
                self.__imu_pub.publish(imu_msg)

            # 5. Publish /gps/fix (~10Hz)
            if (now - self.__last_gps_pub) >= self.__gps_interval:
                self.__last_gps_pub = now
                gps_msg = NavSatFix()
                gps_msg.header.stamp = now_stamp
                gps_msg.header.frame_id = 'gps_link'
                if gps_valid:
                    gps_msg.status.status = NavSatStatus.STATUS_FIX
                    gps_msg.status.service = NavSatStatus.SERVICE_GPS
                    gps_msg.latitude = 26.9124 + (y_pos / 111320.0)
                    gps_msg.longitude = 75.7873 + (x_pos / (111320.0 * math.cos(math.radians(26.9124))))
                    gps_msg.altitude = float(altitude)
                else:
                    gps_msg.status.status = NavSatStatus.STATUS_NO_FIX
                    gps_msg.latitude = float('nan')
                    gps_msg.longitude = float('nan')
                    gps_msg.altitude = float('nan')
                self.__gps_pub.publish(gps_msg)

            # 6. Motor PID Update
            if self.__motors_available:
                if (now - self.__last_cmd_vel_time) > 1.0:
                    self.__target_twist = Twist()

                pitch_input = clamp(self.__target_twist.linear.x, -1.0, 1.0)
                roll_input = clamp(-self.__target_twist.linear.y, -1.0, 1.0)
                yaw_input = clamp(-self.__target_twist.angular.z, -1.0, 1.0)

                roll_disturb = clamp(roll, -1.0, 1.0)
                pitch_disturb = clamp(pitch, -1.0, 1.0)
                roll_input += self.K_ROLL_P * roll_disturb
                pitch_input += self.K_PITCH_P * pitch_disturb

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

    def __synthetic_publish_step(self):
        """Fallback generator when Webots is not connected so the video feed and telemetry are always live."""
        now_stamp = self.__node.get_clock().now().to_msg()
        self.__synthetic_step_count += 1
        t = self.__synthetic_step_count * 0.033

        # 1. Synthetic Camera Frame (400x240 BGRA)
        w, h = 400, 240
        import numpy as np
        frame = np.full((h, w, 4), 45, dtype=np.uint8)
        # Terrain grid pattern
        grid_offset = int((t * 20) % 40)
        frame[grid_offset::40, :, :3] = 70
        frame[:, (grid_offset * 2) % 40::40, :3] = 70
        # Simulated survivor heat proxy
        sx, sy = 200, 120
        frame[sy-15:sy+15, sx-10:sx+10, :3] = [30, 200, 30]  # Green survivor bounding zone
        frame[:, :, 3] = 255

        msg = Image()
        msg.header.stamp = now_stamp
        msg.header.frame_id = 'camera_link'
        msg.height = h
        msg.width = w
        msg.encoding = 'bgra8'
        msg.step = w * 4
        msg.data = frame.tobytes()
        self.__camera_pub.publish(msg)

        # 2. Thermal Frame
        t_frame = np.full((h, w, 4), 20, dtype=np.uint8)
        t_frame[sy-15:sy+15, sx-10:sx+10, :3] = [240, 240, 240]  # White hotspot
        t_frame[:, :, 3] = 255
        t_msg = Image()
        t_msg.header.stamp = now_stamp
        t_msg.header.frame_id = 'thermal_camera_link'
        t_msg.height = h
        t_msg.width = w
        t_msg.encoding = 'bgra8'
        t_msg.step = w * 4
        t_msg.data = t_frame.tobytes()
        self.__thermal_pub.publish(t_msg)

        # 3. GPS & IMU
        gps_msg = NavSatFix()
        gps_msg.header.stamp = now_stamp
        gps_msg.status.status = NavSatStatus.STATUS_FIX
        gps_msg.latitude = 26.9124 + math.sin(t * 0.1) * 0.0003
        gps_msg.longitude = 75.7873 + math.cos(t * 0.1) * 0.0003
        gps_msg.altitude = 1.5
        self.__gps_pub.publish(gps_msg)

        imu_msg = Imu()
        imu_msg.header.stamp = now_stamp
        imu_msg.orientation.w = 1.0
        imu_msg.linear_acceleration.z = 9.81
        self.__imu_pub.publish(imu_msg)

    def destroy(self):
        if self.__motors_available:
            for m in [self.__front_left_motor, self.__front_right_motor,
                      self.__rear_left_motor, self.__rear_right_motor]:
                if m:
                    try:
                        m.setVelocity(0.0)
                    except Exception:
                        pass
        if self.__node and self.__owns_node:
            try:
                self.__node.destroy_node()
            except Exception:
                pass


def detect_webots_port(max_wait=4.0):
    start = time.time()
    while time.time() - start < max_wait:
        # Check ss for webots-bin listening port
        try:
            out = subprocess.check_output("ss -tulpn 2>/dev/null | grep webots-bin", shell=True).decode()
            for line in out.splitlines():
                m = re.search(r':(\d+)\s+', line)
                if m:
                    return int(m.group(1))
        except Exception:
            pass
        # Check /proc/net/tcp for standard Webots ports (1234=04D2, 1235=04D3, 1236=04D4)
        try:
            with open('/proc/net/tcp', 'r') as f:
                content = f.read()
                for port_num, hex_str in [(1234, ':04D2'), (1235, ':04D3'), (1236, ':04D4')]:
                    if hex_str in content:
                        return port_num
        except Exception:
            pass
        time.sleep(0.3)
    return None


def main(args=None):
    if not rclpy.ok():
        rclpy.init(args=args)

    driver = WebotsDroneNode()
    robot = None

    # Configure Webots library paths
    webots_home = os.environ.get('WEBOTS_HOME', '/usr/local/webots')
    os.environ['WEBOTS_HOME'] = webots_home
    webots_lib = os.path.join(webots_home, 'lib', 'controller')
    webots_python = os.path.join(webots_lib, 'python')
    if webots_python not in sys.path:
        sys.path.insert(0, webots_python)
    cur_ld = os.environ.get('LD_LIBRARY_PATH', '')
    if webots_lib not in cur_ld:
        os.environ['LD_LIBRARY_PATH'] = f"{webots_lib}:{cur_ld}" if cur_ld else webots_lib

    # Determine Webots port passively without socket probes that interrupt controller handshake
    port = None
    env_url = os.environ.get('WEBOTS_CONTROLLER_URL', '')
    if env_url:
        m = re.search(r':(\d+)/', env_url)
        if m:
            port = int(m.group(1))
    if not port:
        port = detect_webots_port(max_wait=3.0)

    if port:
        os.environ['WEBOTS_CONTROLLER_URL'] = f"tcp://127.0.0.1:{port}/Mavic 2 PRO"
        print(f"[WEBOTS_DRONE_NODE] Connecting to Webots on port {port}...")
        for attempt in range(5):
            try:
                from controller import Robot
                r = Robot()
                if r:
                    robot = r
                    break
            except Exception as e:
                print(f"[WEBOTS_DRONE_NODE] Connect attempt {attempt+1} exception: {e}")
                time.sleep(0.5)

    if robot is not None:
        try:
            class WebotsWrapper:
                def __init__(self, r):
                    self.robot = r

            driver.init(WebotsWrapper(robot), {})
            timestep = int(robot.getBasicTimeStep())
            while rclpy.ok() and robot.step(timestep) != -1:
                driver.step()
                rclpy.spin_once(driver.node, timeout_sec=0.001)
        except Exception as e:
            print(f"[WEBOTS_DRONE_NODE] Webots execution ended: {e}")
        finally:
            driver.destroy()
    else:
        # Fallback to standalone ROS 2 node execution
        driver.create_standalone_node()
        print("[WEBOTS_DRONE_NODE] Running in standalone ROS 2 mode (publishing /camera/image_raw).")
        try:
            rclpy.spin(driver.node)
        except (KeyboardInterrupt, ExternalShutdownException):
            pass
        finally:
            driver.destroy()

    if rclpy.ok():
        try:
            rclpy.shutdown()
        except Exception:
            pass


if __name__ == '__main__':
    main()
