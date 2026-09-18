cmake_minimum_required(VERSION 3.8)
project(aerosar_sim)

find_package(ament_cmake REQUIRED)

# Install the launch and worlds directories so ROS 2 can find them
install(DIRECTORY
  launch
  worlds
  DESTINATION share/${PROJECT_NAME}
)

ament_package()
