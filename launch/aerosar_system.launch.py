"""
AEROSAR Master ROS 2 Launch File
Member 6 — Integration & Testing Tool

Brings up all subsystem nodes: Webots simulation, perception, navigation,
backend bridge, and mission control.
"""

from launch import LaunchDescription
from launch_ros.actions import Node

def generate_launch_description():
    return LaunchDescription([
        # Member 1: Drone Controller / Webots bridge node placeholder
        Node(
            package='aerosar_drone',
            executable='drone_controller',
            name='drone_controller',
            output='screen'
        ),
        # Member 2: AI Perception & Sensor Fusion node placeholder
        Node(
            package='aerosar_perception',
            executable='perception_fusion_node',
            name='perception_fusion_node',
            output='screen'
        ),
        # Member 3: Autonomous Navigation & Search pattern node placeholder
        Node(
            package='aerosar_navigation',
            executable='navigation_node',
            name='navigation_node',
            output='screen'
        ),
        # Member 4: Backend ROS 2 to FastAPI/WebSocket Bridge placeholder
        Node(
            package='aerosar_backend',
            executable='ros_backend_bridge',
            name='ros_backend_bridge',
            output='screen'
        )
    ])
