"""
AEROSAR Scenario Runner Launch File
Member 1 — Drone Simulation & ROS 2 Lead

Dynamically selects and orchestrates Webots disaster scenarios (1 to 5)
and brings up the full AEROSAR system stack:
- Scenario 1: world_scenario_1_flood.wbt (Flood disaster + victims)
- Scenario 2: world_scenario_2_fire.wbt (Fire/smoke hazard + survivor)
- Scenario 3: world_scenario_3_multi_hazard.wbt (Multi-hazard cluster)
- Scenario 4: world_scenario_4_gps_denied.wbt (GPS signal drop trigger zone)
- Scenario 5: world_scenario_5_offline.wbt (Network disconnection test)
"""

import os
from ament_index_python.packages import get_package_share_directory
from launch import LaunchDescription
from launch.actions import (
    DeclareLaunchArgument,
    IncludeLaunchDescription,
    OpaqueFunction,
    LogInfo,
)
from launch.launch_description_sources import PythonLaunchDescriptionSource
from launch.substitutions import LaunchConfiguration

SCENARIO_MAP = {
    '1': 'world_scenario_1_flood.wbt',
    '2': 'world_scenario_2_fire.wbt',
    '3': 'world_scenario_3_multi_hazard.wbt',
    '4': 'world_scenario_4_gps_denied.wbt',
    '5': 'world_scenario_5_offline.wbt',
}

SCENARIO_DESC = {
    '1': 'Flood Disaster + Victims',
    '2': 'Fire & Smoke Hazard + Survivor',
    '3': 'Multi-Hazard Cluster (Fire, Flood, Structural Collapse)',
    '4': 'GPS-Denied Covered Zone Cutoff Trigger',
    '5': 'Network Disconnection & Offline Sync Sector',
}


def launch_setup(context, *args, **kwargs):
    scenario_id = LaunchConfiguration('scenario_id').perform(context).strip()
    use_sim_time = LaunchConfiguration('use_sim_time')
    enable_gui = LaunchConfiguration('enable_gui')
    log_level = LaunchConfiguration('log_level')

    world_filename = SCENARIO_MAP.get(scenario_id, 'world_scenario_1_flood.wbt')
    description = SCENARIO_DESC.get(scenario_id, 'Unknown Scenario')

    pkg_bringup = get_package_share_directory('aerosar_bringup')
    full_system_launch = os.path.join(pkg_bringup, 'launch', 'aerosar_full_system.launch.py')

    system_stack = IncludeLaunchDescription(
        PythonLaunchDescriptionSource(full_system_launch),
        launch_arguments={
            'world': world_filename,
            'use_sim_time': use_sim_time,
            'enable_gui': enable_gui,
            'log_level': log_level,
        }.items()
    )

    return [
        LogInfo(msg="============================================================"),
        LogInfo(msg=f"  AEROSAR Scenario Runner: Scenario {scenario_id} ({description})"),
        LogInfo(msg=f"  World Target: {world_filename}"),
        LogInfo(msg="============================================================"),
        system_stack
    ]


def generate_launch_description():
    scenario_id_arg = DeclareLaunchArgument(
        'scenario_id',
        default_value='1',
        description='Scenario ID to execute (1: Flood, 2: Fire, 3: Multi-Hazard, 4: GPS-Denied, 5: Offline)'
    )
    use_sim_time_arg = DeclareLaunchArgument(
        'use_sim_time',
        default_value='true',
        description='Use simulation (Webots) clock if true'
    )
    enable_gui_arg = DeclareLaunchArgument(
        'enable_gui',
        default_value='true',
        description='Toggle Webots 3D GUI window (set false for headless testing)'
    )
    log_level_arg = DeclareLaunchArgument(
        'log_level',
        default_value='info',
        description='ROS 2 log level (debug, info, warn, error, fatal)'
    )

    return LaunchDescription([
        scenario_id_arg,
        use_sim_time_arg,
        enable_gui_arg,
        log_level_arg,
        OpaqueFunction(function=launch_setup)
    ])
