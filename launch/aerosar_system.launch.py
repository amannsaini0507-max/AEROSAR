"""
AEROSAR Master System ROS 2 Launch File
Integrated Sequence — Member 1 (Sim & ROS 2 Lead) & Member 6 (Integration)

Brings up the complete AEROSAR simulation stack:
- Webots disaster environment with hazards and victim models
- DJI Mavic 2 Pro quadcopter with RGB and Thermal-Proxy cameras
- ROS 2 driver with sensor streams: /camera/image_raw, /thermal/image_raw, /imu/data, /gps/fix
- Active /navigation/cmd_vel velocity listener and autonomous fixed-path controller
"""

import os
from ament_index_python.packages import get_package_share_directory
from launch import LaunchDescription
from launch.actions import DeclareLaunchArgument, IncludeLaunchDescription, LogInfo
from launch.launch_description_sources import PythonLaunchDescriptionSource
from launch.substitutions import LaunchConfiguration


def generate_launch_description():
    pkg_aerosar_sim = get_package_share_directory('aerosar_sim')
    sim_launch_path = os.path.join(pkg_aerosar_sim, 'launch', 'sim_launch.py')

    world_arg = DeclareLaunchArgument(
        'world',
        default_value='aerosar_world.wbt',
        description='Choose world file to launch (aerosar_world.wbt, scenario_1_flood.wbt, scenario_2_fire.wbt, scenario_3_collapsed.wbt, scenario_4_gps_denied.wbt)'
    )
    start_webots_arg = DeclareLaunchArgument(
        'start_webots',
        default_value='true',
        description='Whether to start native Webots simulation process'
    )
    mode_arg = DeclareLaunchArgument(
        'mode',
        default_value='realtime',
        description='Webots simulation mode (realtime, fast, pause)'
    )

    sim_stack = IncludeLaunchDescription(
        PythonLaunchDescriptionSource(sim_launch_path),
        launch_arguments={
            'world': LaunchConfiguration('world'),
            'start_webots': LaunchConfiguration('start_webots'),
            'mode': LaunchConfiguration('mode'),
        }.items()
    )

    return LaunchDescription([
        world_arg,
        start_webots_arg,
        mode_arg,
        LogInfo(msg=">>> AEROSAR Master Launch: Starting Webots Drone Simulation & ROS 2 Driver Stack <<<"),
        sim_stack
    ])
