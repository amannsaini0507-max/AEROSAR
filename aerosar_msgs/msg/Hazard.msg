# aerosar_msgs/msg/Hazard.msg
# Detected disaster site hazard

string id                  # Unique hazard ID
string hazard_type          # "fire" | "smoke" | "flood" | "debris" | "damaged_structure" | "landslide"
float32 confidence         # 0.0 to 1.0 confidence score
float64 latitude            # Geotag latitude
float64 longitude           # Geotag longitude
builtin_interfaces/Time stamp # Timestamp of detection
