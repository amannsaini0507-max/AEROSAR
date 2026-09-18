"""
AEROSAR Mavic 2 Pro ROS 2 Drone Driver & Controller Plugin
Member 1 — Drone Simulation & ROS 2 Lead

Features:
- Dual-mode flight control: Autonomous fixed-path waypoint follower & /navigation/cmd_vel interface
- Complete 5x fixed-path verification tracking
- Real-time IMU & GPS data acquisition with ~10 Hz /gps/fix broadcast
- Dynamic GPS-Denied zone detection and automatic signal interruption
- Exact Webots R2023b DJI Mavic 2 Pro flight physics with aerodynamic damping
"""

import math
import time
import rclpy
from geometry_msgs.msg import Twist
from sensor_msgs.msg import NavSatFix, NavSatStatus
from std_msgs.msg import Bool, Int32


def clamp(value, value_min, value_max):
    return min(max(value, value_min), value_max)


class DroneDriver:
    # Webots DJI Mavic 2 Pro Canonical Constants
    K_VERTICAL_THRUST = 68.5   # Hover equilibrium thrust (rad/s)
    K_VERTICAL_OFFSET = 0.6    # Equilibrium altitude stabilization offset
    K_VERTICAL_P = 3.0         # Vertical proportional PID constant
    K_ROLL_P = 50.0            # Roll attitude PID constant
    K_PITCH_P = 30.0           # Pitch attitude PID constant

    MAX_YAW_DISTURBANCE = 0.4
    MAX_PITCH_DISTURBANCE = -1.0
    TARGET_PRECISION = 0.6     # Acceptance radius for search grid waypoints (meters)

    def __init__(self):
        print(">>> DroneDriver.__init__ called! <<<", flush=True)

    def init(self, webots_node, properties):
        print(">>> DroneDriver.init called! <<<", flush=True)
        self.__robot = webots_node.robot
        self.__timestep = int(self.__robot.getBasicTimeStep())

        # Hardware Sensors
        self.__gps = self.__robot.getDevice('gps')
        self.__gyro = self.__robot.getDevice('gyro')
        self.__imu = self.__robot.getDevice('inertial unit')

        if self.__gps:
            self.__gps.enable(self.__timestep)
        if self.__gyro:
            self.__gyro.enable(self.__timestep)
        if self.__imu:
            self.__imu.enable(self.__timestep)

        # Quadcopter Propellers
        self.__front_left_motor = self.__robot.getDevice('front left propeller')
        self.__front_right_motor = self.__robot.getDevice('front right propeller')
        self.__rear_left_motor = self.__robot.getDevice('rear left propeller')
        self.__rear_right_motor = self.__robot.getDevice('rear right propeller')

        for motor in [self.__front_left_motor, self.__front_right_motor,
                      self.__rear_left_motor, self.__rear_right_motor]:
            if motor:
                motor.setPosition(float('inf'))
                motor.setVelocity(1.0)

        # Optional Camera Gimbal pitch
        camera_pitch = self.__robot.getDevice('camera pitch')
        if camera_pitch:
            camera_pitch.setPosition(0.2)

        # Flight State
        self.__target_altitude = 1.2
        self.__target_twist = Twist()
        self.__last_cmd_vel_time = 0.0
        self.__last_gps_pub_time = 0.0
        self.__last_wp_step_time = 0.0
        self.__force_gps_denied = False
        self.__was_in_gps_denied = False

        # Autonomous Search Grid Waypoints
        self.__waypoints = [
            [1.2, 1.2],
            [-1.2, 1.2],
            [-1.2, -1.2],
            [1.2, -1.2]
        ]
        self.__target_pos = [self.__waypoints[0][0], self.__waypoints[0][1]]
        self.__target_idx = 0
        self.__laps_completed = 0
        self.__target_laps = 5

        # Designated GPS-Denied Zone
        self.__gps_denied_zone = {
            'x_min': -4.5, 'x_max': -1.2,
            'y_min': 0.8, 'y_max': 4.0,
            'z_min': 0.0, 'z_max': 6.0
        }

        # ROS 2 Node Initialization
        if not rclpy.ok():
            rclpy.init(args=None)
        self.__node = rclpy.create_node('drone_controller')

        # Subscriptions
        self.__node.create_subscription(Twist, '/navigation/cmd_vel', self.__cmd_vel_callback, 10)
        self.__node.create_subscription(Twist, '/cmd_vel', self.__cmd_vel_callback, 10)
        self.__node.create_subscription(Bool, '/aerosar/force_gps_denied', self.__force_gps_denied_callback, 10)

        # Publishers
        self.__gps_pub = self.__node.create_publisher(NavSatFix, '/gps/fix', 10)
        self.__gps_denied_pub = self.__node.create_publisher(Bool, '/aerosar/gps_denied', 10)
        self.__lap_pub = self.__node.create_publisher(Int32, '/aerosar/fixed_path_laps', 10)

        self.__node.get_logger().info('AEROSAR Drone Driver initialized successfully (Spec locked: cmd_vel, camera, thermal, imu, gps)')

    def __cmd_vel_callback(self, twist: Twist):
        self.__target_twist = twist
        self.__last_cmd_vel_time = time.time()

    def __force_gps_denied_callback(self, msg: Bool):
        self.__force_gps_denied = msg.data
        self.__node.get_logger().info(f'Force GPS Denied override set to: {self.__force_gps_denied}')

    def step(self):
        try:
            rclpy.spin_once(self.__node, timeout_sec=0)

            # Read sensors safely
            if not self.__gps or not self.__imu or not self.__gyro:
                return

            gps_values = self.__gps.getValues()
            if not gps_values or math.isnan(gps_values[0]):
                return

            x_pos, y_pos, altitude = gps_values[0], gps_values[1], gps_values[2]
            rpy = self.__imu.getRollPitchYaw()
            roll, pitch, yaw = rpy[0], rpy[1], rpy[2]

            gyro_values = self.__gyro.getValues()
            roll_accel, pitch_accel, _ = gyro_values[0], gyro_values[1], gyro_values[2]

            now = time.time()

            # ==========================================================
            # GPS-Denied Zone Verification Logic
            # ==========================================================
            in_zone = (
                self.__gps_denied_zone['x_min'] <= x_pos <= self.__gps_denied_zone['x_max'] and
                self.__gps_denied_zone['y_min'] <= y_pos <= self.__gps_denied_zone['y_max'] and
                self.__gps_denied_zone['z_min'] <= altitude <= self.__gps_denied_zone['z_max']
            )
            is_denied = in_zone or self.__force_gps_denied

            if is_denied != self.__was_in_gps_denied:
                self.__was_in_gps_denied = is_denied
                denied_msg = Bool()
                denied_msg.data = is_denied
                self.__gps_denied_pub.publish(denied_msg)
                if is_denied:
                    self.__node.get_logger().warn(
                        f'⚠️ [GPS DENIED ZONE ENTERED] Pose: ({x_pos:.2f}, {y_pos:.2f}, {altitude:.2f}) -> /gps/fix broadcast CUT!'
                    )
                else:
                    self.__node.get_logger().info(
                        f'📡 [GPS SIGNAL RESTORED] Exited denied zone. /gps/fix broadcast resumed.'
                    )

            # Publish /gps/fix at ~10 Hz (every 100ms) ONLY when NOT in GPS-denied state
            if (now - self.__last_gps_pub_time) >= 0.10:
                self.__last_gps_pub_time = now
                if not is_denied:
                    fix_msg = NavSatFix()
                    fix_msg.header.stamp = self.__node.get_clock().now().to_msg()
                    fix_msg.header.frame_id = 'gps_link'
                    fix_msg.latitude = 26.9124 + (y_pos / 111111.0)
                    fix_msg.longitude = 75.7873 + (x_pos / (111111.0 * math.cos(math.radians(26.9124))))
                    fix_msg.altitude = altitude
                    fix_msg.status.status = NavSatStatus.STATUS_FIX
                    fix_msg.status.service = NavSatStatus.SERVICE_GPS
                    self.__gps_pub.publish(fix_msg)

            # ==========================================================
            # Dual-Mode Flight Control
            # ==========================================================
            roll_disturbance = 0.0
            pitch_disturbance = 0.0
            yaw_disturbance = 0.0

            external_active = (now - self.__last_cmd_vel_time) < 1.0

            if external_active:
                # Mode 1: Responding to ROS 2 /navigation/cmd_vel
                dt = self.__timestep / 1000.0
                self.__target_altitude = clamp(
                    self.__target_altitude + self.__target_twist.linear.z * dt,
                    0.3, 5.0
                )
                pitch_disturbance = clamp(-self.__target_twist.linear.x * 1.5, -1.2, 1.2)
                roll_disturbance = clamp(self.__target_twist.linear.y * 1.5, -1.2, 1.2)
                yaw_disturbance = clamp(-self.__target_twist.angular.z * 0.4, -0.4, 0.4)
            else:
                # Mode 2: Autonomous Fixed-Path Waypoint Follower
                if altitude > (self.__target_altitude - 0.7):
                    # Check waypoint reached
                    if abs(self.__target_pos[0] - x_pos) < self.TARGET_PRECISION and \
                       abs(self.__target_pos[1] - y_pos) < self.TARGET_PRECISION:
                        self.__target_idx += 1
                        if self.__target_idx >= len(self.__waypoints):
                            self.__target_idx = 0
                            self.__laps_completed += 1
                            lap_msg = Int32()
                            lap_msg.data = self.__laps_completed
                            self.__lap_pub.publish(lap_msg)
                            self.__node.get_logger().info(
                                f'🏆 [FIXED PATH] Completed Lap {self.__laps_completed}/{self.__target_laps} at pose ({x_pos:.2f}, {y_pos:.2f}, {altitude:.2f})'
                            )
                        self.__target_pos[0] = self.__waypoints[self.__target_idx][0]
                        self.__target_pos[1] = self.__waypoints[self.__target_idx][1]

                    target_angle = math.atan2(self.__target_pos[1] - y_pos, self.__target_pos[0] - x_pos)
                    angle_left = (target_angle - yaw + math.pi) % (2 * math.pi) - math.pi

                    yaw_disturbance = self.MAX_YAW_DISTURBANCE * angle_left / (2 * math.pi)
                    if abs(angle_left) > 1e-3:
                        pitch_disturbance = clamp(math.log10(abs(angle_left)), self.MAX_PITCH_DISTURBANCE, 0.1)
                    else:
                        pitch_disturbance = self.MAX_PITCH_DISTURBANCE

            # ==========================================================
            # Low-Level Flight PID Dynamics (Webots Official Model)
            # ==========================================================
            roll_input = self.K_ROLL_P * clamp(roll, -1.0, 1.0) + roll_accel + roll_disturbance
            pitch_input = self.K_PITCH_P * clamp(pitch, -1.0, 1.0) + pitch_accel + pitch_disturbance
            yaw_input = yaw_disturbance

            clamped_diff_alt = clamp(self.__target_altitude - altitude + self.K_VERTICAL_OFFSET, -1.0, 1.0)
            vertical_input = self.K_VERTICAL_P * pow(clamped_diff_alt, 3.0)

            front_left_input = self.K_VERTICAL_THRUST + vertical_input - yaw_input + pitch_input - roll_input
            front_right_input = self.K_VERTICAL_THRUST + vertical_input + yaw_input + pitch_input + roll_input
            rear_left_input = self.K_VERTICAL_THRUST + vertical_input + yaw_input - pitch_input - roll_input
            rear_right_input = self.K_VERTICAL_THRUST + vertical_input - yaw_input - pitch_input + roll_input

            # Apply motor velocities
            self.__front_left_motor.setVelocity(front_left_input)
            self.__front_right_motor.setVelocity(-front_right_input)
            self.__rear_left_motor.setVelocity(-rear_left_input)
            self.__rear_right_motor.setVelocity(rear_right_input)

        except Exception as e:
            if hasattr(self, '_DroneDriver__node') and self.__node:
                self.__node.get_logger().error(f'DroneDriver step error: {e}')
