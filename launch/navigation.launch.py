"""
AEROSAR Autonomous Navigation Launch File
Member 3 — Autonomous Navigation / SLAM Lead
SIH 2026 — PS 26177

Launches the autonomous serpentine search pattern & reactive obstacle avoidance node.
Subscribes: /gps/fix, /imu/data, /camera/image_raw
Publishes: /navigation/cmd_vel (20 Hz)
"""

from launch import LaunchDescription
from launch_ros.actions import Node


def generate_launch_description():
    return LaunchDescription([
        Node(
            package='navigation',
            executable='navigation_node.py',
            name='aerosar_navigation_node',
            output='screen',
            parameters=[{
                'search_x_min': -3.0,
                'search_x_max': 3.0,
                'search_y_min': -3.0,
                'search_y_max': 3.0,
                'search_altitude': 1.5,
                'lane_spacing': 1.5,
                'max_speed': 0.8,
                'loop_search': False,
                'enable_avoidance': True,
                'obstacle_threshold': 2.0
            }]
        )
    ])
