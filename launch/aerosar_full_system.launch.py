"""
AEROSAR Master System Full Integration Launch File
Member 1 — Drone Simulation & ROS 2 Lead

Orchestrates all subsystem nodes across Members 1, 2, 3, and 4 into a single zero-error launch:
1. Webots Simulation Engine (webots_ros2_driver) with disaster world
2. Drone Sensor Node (aerosar_sim / webots_drone_node)
3. Member 2 Perception Candidate Node (aerosar_perception / perception_node)
4. Member 2 Sensor Fusion Node (aerosar_perception / fusion_node)
5. Member 3 Autonomous Navigation Controller (aerosar_navigation / nav_controller)
6. Member 4 Backend & Telemetry Bridge Node (aerosar_backend_bridge / bridge_node)
"""

import os
from ament_index_python.packages import get_package_share_directory
from launch import LaunchDescription
from launch.actions import (
    DeclareLaunchArgument,
    ExecuteProcess,
    RegisterEventHandler,
    EmitEvent,
    SetEnvironmentVariable,
    OpaqueFunction,
    LogInfo,
)
from launch.event_handlers import OnProcessExit
from launch.events import Shutdown
from launch.substitutions import LaunchConfiguration
from launch_ros.actions import Node


def launch_setup(context, *args, **kwargs):
    # Resolve world path
    world_param = LaunchConfiguration('world').perform(context)
    use_sim_time = LaunchConfiguration('use_sim_time')
    enable_gui_val = LaunchConfiguration('enable_gui').perform(context).lower() in ['true', '1']
    log_level = LaunchConfiguration('log_level')

    pkg_aerosar_sim = get_package_share_directory('aerosar_sim')

    # Check if absolute path or exists directly
    if os.path.isabs(world_param) and os.path.exists(world_param):
        world_file_path = world_param
    elif os.path.exists(os.path.join(pkg_aerosar_sim, 'worlds', world_param)):
        world_file_path = os.path.join(pkg_aerosar_sim, 'worlds', world_param)
    else:
        # Fallback to default disaster world
        world_file_path = os.path.join(pkg_aerosar_sim, 'worlds', 'aerosar_disaster_world.wbt')

    # Webots execution command
    webots_cmd = ['webots', world_file_path, '--batch', '--mode=realtime']
    if not enable_gui_val:
        webots_cmd.append('--no-rendering')

    # Environment definitions for Webots rendering & controller IPC
    webots_home = '/usr/local/webots'
    webots_lib = os.path.join(webots_home, 'lib', 'controller')
    webots_python = os.path.join(webots_lib, 'python')

    current_pythonpath = os.environ.get('PYTHONPATH', '')
    if webots_python not in current_pythonpath:
        current_pythonpath = f"{webots_python}:{current_pythonpath}" if current_pythonpath else webots_python

    current_ld_path = os.environ.get('LD_LIBRARY_PATH', '')
    if webots_lib not in current_ld_path:
        current_ld_path = f"{webots_lib}:{current_ld_path}" if current_ld_path else webots_lib

    controller_env = {
        'GALLIUM_DRIVER': 'llvmpipe',
        'LIBGL_ALWAYS_SOFTWARE': '1',
        'WEBOTS_HOME': webots_home,
        'PYTHONPATH': current_pythonpath,
        'LD_LIBRARY_PATH': current_ld_path,
        'WEBOTS_CONTROLLER_URL': 'tcp://127.0.0.1:1234/Mavic 2 PRO'
    }

    # 1. Webots Simulation Process
    webots_process = ExecuteProcess(
        cmd=webots_cmd,
        additional_env=controller_env,
        output='screen'
    )

    # Clean shutdown event handler: when Webots terminates, shut down entire ROS graph
    shutdown_handler = RegisterEventHandler(
        event_handler=OnProcessExit(
            target_action=webots_process,
            on_exit=[
                LogInfo(msg="Webots process terminated. Shutting down complete AEROSAR ROS 2 system..."),
                EmitEvent(event=Shutdown(reason='Webots simulation closed'))
            ]
        )
    )

    # 2. Member 1 Drone Sensor Node
    drone_sensor_node = Node(
        package='aerosar_sim',
        executable='webots_drone_node',
        name='webots_drone_node',
        output='screen',
        parameters=[{'use_sim_time': use_sim_time}],
        arguments=['--ros-args', '--log-level', log_level],
        additional_env=controller_env
    )

    # 3. Member 2 Perception Node
    perception_node = Node(
        package='aerosar_perception',
        executable='perception_node',
        name='perception_node',
        output='screen',
        parameters=[{'use_sim_time': use_sim_time}],
        arguments=['--ros-args', '--log-level', log_level]
    )

    # 4. Member 2 Sensor Fusion Node
    fusion_node = Node(
        package='aerosar_perception',
        executable='fusion_node',
        name='fusion_node',
        output='screen',
        parameters=[{'use_sim_time': use_sim_time}],
        arguments=['--ros-args', '--log-level', log_level]
    )

    # 5. Member 3 Navigation Controller
    nav_controller = Node(
        package='aerosar_navigation',
        executable='nav_controller',
        name='nav_controller',
        output='screen',
        parameters=[{'use_sim_time': use_sim_time}],
        arguments=['--ros-args', '--log-level', log_level]
    )

    # 6. Member 4 Backend Bridge Node
    bridge_node = Node(
        package='aerosar_backend_bridge',
        executable='bridge_node',
        name='bridge_node',
        output='screen',
        parameters=[{'use_sim_time': use_sim_time}],
        arguments=['--ros-args', '--log-level', log_level]
    )

    return [
        LogInfo(msg=f">>> Launching AEROSAR Full System with world: {world_file_path} <<<"),
        webots_process,
        shutdown_handler,
        drone_sensor_node,
        perception_node,
        fusion_node,
        nav_controller,
        bridge_node
    ]


def generate_launch_description():
    # Environment variable defaults for ROS 2 Humble / Jazzy
    env_gallium = SetEnvironmentVariable('GALLIUM_DRIVER', 'llvmpipe')
    env_libgl = SetEnvironmentVariable('LIBGL_ALWAYS_SOFTWARE', '1')
    env_webots_home = SetEnvironmentVariable('WEBOTS_HOME', '/usr/local/webots')

    # Launch Arguments
    world_arg = DeclareLaunchArgument(
        'world',
        default_value='aerosar_disaster_world.wbt',
        description='Path to .wbt world file (absolute or filename in aerosar_sim/worlds)'
    )
    use_sim_time_arg = DeclareLaunchArgument(
        'use_sim_time',
        default_value='true',
        description='Use simulation (Webots) clock if true'
    )
    enable_gui_arg = DeclareLaunchArgument(
        'enable_gui',
        default_value='true',
        description='Toggle Webots 3D GUI window (set false for headless CI/CD)'
    )
    log_level_arg = DeclareLaunchArgument(
        'log_level',
        default_value='info',
        description='ROS 2 log level (debug, info, warn, error, fatal)'
    )

    return LaunchDescription([
        env_gallium,
        env_libgl,
        env_webots_home,
        world_arg,
        use_sim_time_arg,
        enable_gui_arg,
        log_level_arg,
        OpaqueFunction(function=launch_setup)
    ])
