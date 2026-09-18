"""
AEROSAR Mock System Launch File
Member 6 — Integration & Testing Tool

Brings up simulated drone telemetry and mock detector nodes for pre-integration
frontend & backend testing.
"""

from launch import LaunchDescription
from launch_ros.actions import Node

def generate_launch_description():
    return LaunchDescription([
        # Member 6 Mock Telemetry Publisher
        Node(
            package='aerosar_integration',
            executable='mock_telemetry_publisher.py',
            name='mock_telemetry_publisher',
            output='screen'
        )
    ])
