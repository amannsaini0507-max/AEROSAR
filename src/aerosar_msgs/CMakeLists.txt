cmake_minimum_required(VERSION 3.8)
project(aerosar_msgs)

find_package(ament_cmake REQUIRED)
find_package(rosidl_default_generators REQUIRED)
find_package(builtin_interfaces REQUIRED)

rosidl_generate_interfaces(${PROJECT_NAME}
  "msg/Detection.msg"
  "msg/Hazard.msg"
  "msg/Alert.msg"
  "msg/MissionStatus.msg"
  "msg/RiskScore.msg"
  DEPENDENCIES builtin_interfaces
)

ament_package()
