import os
from ament_index_python.packages import get_package_share_directory, get_package_prefix
from launch import LaunchDescription
from launch.actions import DeclareLaunchArgument, ExecuteProcess, SetEnvironmentVariable
from launch.conditions import IfCondition
from launch.substitutions import LaunchConfiguration, PathJoinSubstitution
from launch_ros.actions import Node

def generate_launch_description():
    pkg_share = get_package_share_directory('aerosar_sim')
    pkg_prefix = get_package_prefix('aerosar_sim')
    
    # Ensure Webots Python Controller and AEROSAR ROS 2 modules are on PYTHONPATH
    webots_home = '/usr/local/webots'
    webots_lib = os.path.join(webots_home, 'lib', 'controller')
    webots_python = os.path.join(webots_lib, 'python')
    sim_site_packages = os.path.join(pkg_prefix, 'lib', 'python3.10', 'site-packages')
    
    existing_pythonpath = os.environ.get('PYTHONPATH', '')
    extra_paths = [webots_python, sim_site_packages]
    for p in extra_paths:
        if p and p not in existing_pythonpath:
            existing_pythonpath = f"{p}:{existing_pythonpath}" if existing_pythonpath else p
    os.environ['PYTHONPATH'] = existing_pythonpath

    existing_ld_path = os.environ.get('LD_LIBRARY_PATH', '')
    if webots_lib not in existing_ld_path:
        os.environ['LD_LIBRARY_PATH'] = f"{webots_lib}:{existing_ld_path}" if existing_ld_path else webots_lib

    # WSLg Hardware compatibility environment variables
    env_gallium = SetEnvironmentVariable('GALLIUM_DRIVER', 'llvmpipe')
    env_libgl = SetEnvironmentVariable('LIBGL_ALWAYS_SOFTWARE', '1')
    env_webots_home = SetEnvironmentVariable('WEBOTS_HOME', webots_home)
    env_pythonpath = SetEnvironmentVariable('PYTHONPATH', os.environ['PYTHONPATH'])
    env_ld_path = SetEnvironmentVariable('LD_LIBRARY_PATH', os.environ['LD_LIBRARY_PATH'])
    env_controller = SetEnvironmentVariable('WEBOTS_CONTROLLER_URL', 'tcp://127.0.0.1:1234/Mavic 2 PRO')

    # Launch configuration options
    world_arg = DeclareLaunchArgument(
        'world',
        default_value='aerosar_world.wbt',
        description='Choose world file to launch'
    )
    start_webots_arg = DeclareLaunchArgument(
        'start_webots',
        default_value='false',
        description='Whether to start native Webots process from launch file'
    )
    mode_arg = DeclareLaunchArgument(
        'mode',
        default_value='realtime',
        description='Webots simulation mode (realtime, fast, pause)'
    )

    world_path = PathJoinSubstitution([pkg_share, 'worlds', LaunchConfiguration('world')])

    webots_process = ExecuteProcess(
        cmd=['webots', world_path, ['--mode=', LaunchConfiguration('mode')], '--batch'],
        additional_env={
            'GALLIUM_DRIVER': 'llvmpipe',
            'LIBGL_ALWAYS_SOFTWARE': '1',
            'WEBOTS_HOME': webots_home,
            'PYTHONPATH': os.environ['PYTHONPATH'],
            'LD_LIBRARY_PATH': os.environ['LD_LIBRARY_PATH']
        },
        output='screen',
        condition=IfCondition(LaunchConfiguration('start_webots'))
    )

    # Robot Description specifying URDF path
    robot_description_path = os.path.join(pkg_share, 'resource', 'mavic_aerosar.urdf')

    mavic_driver = Node(
        package='webots_ros2_driver',
        executable='driver',
        output='screen',
        additional_env={
            'WEBOTS_HOME': webots_home,
            'PYTHONPATH': os.environ['PYTHONPATH'],
            'LD_LIBRARY_PATH': os.environ['LD_LIBRARY_PATH'],
            'WEBOTS_CONTROLLER_URL': 'tcp://127.0.0.1:1234/Mavic 2 PRO'
        },
        parameters=[
            {'robot_description': robot_description_path}
        ]
    )

    return LaunchDescription([
        env_gallium,
        env_libgl,
        env_webots_home,
        env_pythonpath,
        env_ld_path,
        env_controller,
        world_arg,
        start_webots_arg,
        mode_arg,
        webots_process,
        mavic_driver
    ])
