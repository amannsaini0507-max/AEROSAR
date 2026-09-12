# aerosar_msgs/msg/Detection.msg
# Confirmed survivor or candidate detection

string id                  # Unique detection ID (UUID or string counter)
string detection_type      # "person" or specific hazard candidate
float32 confidence         # 0.0 to 1.0 confidence score
float32 bbox_x             # Normalized bounding box X
float32 bbox_y             # Normalized bounding box Y
float32 bbox_w             # Normalized bounding box width
float32 bbox_h             # Normalized bounding box height
bool thermal_confirmed      # true if confirmed via thermal channel fusion
float64 latitude            # Geotag latitude (from IMU/GPS pose at capture time)
float64 longitude           # Geotag longitude
float64 altitude            # Geotag altitude
builtin_interfaces/Time stamp # Timestamp of capture
