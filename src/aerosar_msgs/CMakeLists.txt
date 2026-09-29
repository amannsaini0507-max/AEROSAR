cmake_minimum_required(VERSION 3.8)
project(aerosar_msgs)

if(CMAKE_COMPILER_IS_GNUCXX OR CMAKE_CXX_COMPILER_ID MATCHES "Clang")
  add_compile_options(-Wall -Wextra -Wpedantic)
endif()

# Find dependencies
find_package(ament_cmake REQUIRED)
find_package(rosidl_default_generators REQUIRED)
find_package(builtin_interfaces REQUIRED)

# Generate ROS 2 message interfaces
rosidl_generate_interfaces(${PROJECT_NAME}
  "msg/Alert.msg"
  "msg/Detection.msg"
  "msg/Hazard.msg"
  "msg/MissionStatus.msg"
  "msg/RiskScore.msg"
  DEPENDENCIES builtin_interfaces
)

ament_package()
