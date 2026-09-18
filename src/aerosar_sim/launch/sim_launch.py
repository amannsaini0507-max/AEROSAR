import os
from launch import LaunchDescription
from launch_ros.actions import Node

def generate_launch_description():
    # Safely inject the shared folder WITHOUT deleting the ROS 2 library paths

    mavic_driver = Node(
        package='webots_ros2_driver',
        executable='driver',
        output='screen',
        parameters=[
            {'robot_description': """
                <robot name="Mavic 2 PRO">
                    <webots>
                        <device reference="camera" type="Camera">
                            <ros><topicName>/camera/image_raw</topicName></ros>
                        </device>
                        <device reference="gps" type="GPS">
                            <ros><topicName>/gps/fix</topicName></ros>
                        </device>
                        <device reference="inertial unit" type="InertialUnit">
                            <ros><topicName>/imu/data</topicName></ros>
                        </device>
                    </webots>
                </robot>
            """}
        ]
    )
    return LaunchDescription([mavic_driver])
