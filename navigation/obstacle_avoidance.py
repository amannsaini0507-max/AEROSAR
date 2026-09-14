"""
AEROSAR Reactive Obstacle Avoidance Subsystem
Member 3 — Autonomous Navigation / SLAM Lead
SIH 2026 — PS 26177

Strictly implements Master Document Section 10.2 reactive rule:
"IF obstacle detected within threshold distance in current heading:
    stop forward motion, yaw by fixed increment, resume forward motion"

Features:
- Deterministic 4-phase state machine (CLEAR -> STOP_BRAKE -> YAW_INCREMENT -> CLEARANCE_MANEUVER)
- Redundant obstacle detection: forward ROI camera vision + geometric distance/heading check
- Non-blocking, rate-independent execution for real-time 20 Hz control loop
"""

import math
import time
from enum import Enum
from typing import List, Tuple, Optional
from .waypoint_follower import Twist, clamp, normalize_angle


class AvoidanceState(Enum):
    CLEAR = "CLEAR"
    STOP_BRAKE = "STOP_BRAKE"
    YAW_INCREMENT = "YAW_INCREMENT"
    CLEARANCE_MANEUVER = "CLEARANCE_MANEUVER"


class ReactiveObstacleAvoider:
    """
    Reactive rule-based obstacle avoidance controller.
    Ensures safe navigation around static hazards without requiring full SLAM/costmap stack.
    """

    def __init__(
        self,
        threshold_distance: float = 2.0,     # Meters ahead to trigger avoidance
        yaw_increment_rad: float = 0.785,     # Fixed yaw increment: +45 degrees (pi/4)
        brake_duration_sec: float = 0.5,      # Stop duration
        clearance_duration_sec: float = 1.5,  # Forward clearance duration
        forward_clearance_speed: float = 0.35,# Clearance step velocity (m/s)
        kp_yaw: float = 1.2,
        max_angular_z: float = 0.6,
        yaw_sign: float = -1.0
    ):
        self.threshold_distance = threshold_distance
        self.yaw_increment = yaw_increment_rad
        self.brake_duration = brake_duration_sec
        self.clearance_duration = clearance_duration_sec
        self.clearance_speed = forward_clearance_speed
        self.kp_yaw = kp_yaw
        self.max_angular_z = max_angular_z
        self.yaw_sign = yaw_sign

        # State tracking
        self.state = AvoidanceState.CLEAR
        self.state_start_time = 0.0
        self.target_yaw = 0.0
        self.last_obstacle_detected = False
        self.trigger_count = 0

    def reset(self):
        """Resets the state machine to normal clear flight."""
        self.state = AvoidanceState.CLEAR
        self.state_start_time = 0.0
        self.target_yaw = 0.0
        self.last_obstacle_detected = False

    def is_avoiding(self) -> bool:
        """Returns True if the avoidance maneuver is currently overriding normal flight."""
        return self.state != AvoidanceState.CLEAR

    def evaluate_proximity(
        self,
        drone_x: float,
        drone_y: float,
        drone_yaw: float,
        obstacles: List[Tuple[float, float, float]]  # (x, y, radius)
    ) -> bool:
        """
        Geometric distance check: detects if an obstacle is within threshold_distance
        in the forward field of view (+/- 45 degrees of drone_yaw).
        """
        for ox, oy, oradius in obstacles:
            dx = ox - drone_x
            dy = oy - drone_y
            dist = math.hypot(dx, dy) - oradius

            if dist <= self.threshold_distance:
                # Check if obstacle is roughly ahead in current heading
                angle_to_obs = math.atan2(dy, dx)
                heading_diff = abs(normalize_angle(angle_to_obs - drone_yaw))
                if heading_diff < math.radians(45.0):
                    return True
        return False

    def evaluate_camera_frame(
        self,
        image_data: bytes,
        width: int,
        height: int,
        step: int,
        channels: int = 4
    ) -> bool:
        """
        Analyzes forward camera ROI (bottom 50% and center 50% of the image)
        to detect high-density looming obstacle textures/colors in front of the drone.
        """
        if not image_data or width <= 0 or height <= 0:
            return False

        # Define Center-Bottom Region of Interest
        y_start = int(height * 0.45)
        y_end = int(height * 0.85)
        x_start = int(width * 0.25)
        x_end = int(width * 0.75)

        total_sampled = 0
        obstacle_hits = 0

        # Sample pixels in ROI
        sample_step_y = max(1, (y_end - y_start) // 20)
        sample_step_x = max(1, (x_end - x_start) // 20)

        for y in range(y_start, y_end, sample_step_y):
            row_offset = y * step
            for x in range(x_start, x_end, sample_step_x):
                pixel_offset = row_offset + (x * channels)
                if pixel_offset + 3 < len(image_data):
                    # BGRA / RGBA format
                    b = image_data[pixel_offset]
                    g = image_data[pixel_offset + 1]
                    r = image_data[pixel_offset + 2]
                    total_sampled += 1

                    # Fire (red-dominated) or Debris (dark-contrast) obstacle signature
                    is_fire = (r > 160 and g < 100 and b < 50)
                    is_dark_debris = (r < 75 and g < 75 and b < 75)
                    if is_fire or is_dark_debris:
                        obstacle_hits += 1

        if total_sampled > 0:
            hit_ratio = obstacle_hits / float(total_sampled)
            # If > 18% of forward ROI matches obstacle signature, declare detected
            return hit_ratio >= 0.18

        return False

    def update(
        self,
        obstacle_detected: bool,
        current_yaw: float,
        now: Optional[float] = None
    ) -> Tuple[Optional[Twist], AvoidanceState]:
        """
        Executes the avoidance state machine.
        Returns:
            (twist_override, active_state)
            If twist_override is None, caller should execute normal waypoint following.
        """
        if now is None:
            now = time.time()

        self.last_obstacle_detected = obstacle_detected
        time_in_state = now - self.state_start_time

        # State 1: CLEAR (Normal Navigation)
        if self.state == AvoidanceState.CLEAR:
            if obstacle_detected:
                # Trigger reactive avoidance
                self.trigger_count += 1
                self.state = AvoidanceState.STOP_BRAKE
                self.state_start_time = now
                self.target_yaw = normalize_angle(current_yaw + self.yaw_increment)

                # Stop forward motion immediately
                cmd = Twist()
                return cmd, self.state
            return None, self.state

        # State 2: STOP_BRAKE (Instant forward stop)
        if self.state == AvoidanceState.STOP_BRAKE:
            if time_in_state >= self.brake_duration:
                self.state = AvoidanceState.YAW_INCREMENT
                self.state_start_time = now
                time_in_state = 0.0
            else:
                cmd = Twist()
                cmd.linear.x = 0.0
                cmd.linear.y = 0.0
                cmd.angular.z = 0.0
                return cmd, self.state

        # State 3: YAW_INCREMENT (Yaw by fixed increment)
        if self.state == AvoidanceState.YAW_INCREMENT:
            yaw_err = normalize_angle(self.target_yaw - current_yaw)
            if abs(yaw_err) < 0.10 or time_in_state >= 2.5:
                self.state = AvoidanceState.CLEARANCE_MANEUVER
                self.state_start_time = now
                time_in_state = 0.0
            else:
                cmd = Twist()
                raw_yaw = self.yaw_sign * self.kp_yaw * yaw_err
                cmd.angular.z = clamp(raw_yaw, -self.max_angular_z, self.max_angular_z)
                return cmd, self.state

        # State 4: CLEARANCE_MANEUVER (Resume forward motion to bypass obstacle)
        if self.state == AvoidanceState.CLEARANCE_MANEUVER:
            if time_in_state >= self.clearance_duration:
                # Clearance maneuver complete, restore normal path following
                self.state = AvoidanceState.CLEAR
                self.state_start_time = now
                return None, self.state

            cmd = Twist()
            cmd.linear.x = self.clearance_speed

            # Fine-tune heading lock during clearance
            yaw_err = normalize_angle(self.target_yaw - current_yaw)
            raw_yaw = self.yaw_sign * (self.kp_yaw * 0.5) * yaw_err
            cmd.angular.z = clamp(raw_yaw, -0.25, 0.25)
            return cmd, self.state

        return None, self.state
