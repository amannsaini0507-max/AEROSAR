#!/usr/bin/env python3
import os
import sys
import time
import subprocess

WS_DIR = "/home/saksh/aerosar_ws_native"
world_file = f"{WS_DIR}/src/aerosar_sim/worlds/world_scenario_2_fire.wbt"

os.environ["GALLIUM_DRIVER"] = "llvmpipe"
os.environ["LIBGL_ALWAYS_SOFTWARE"] = "1"
os.environ["WEBOTS_HOME"] = "/usr/local/webots"
os.environ["LD_LIBRARY_PATH"] = f"/usr/local/webots/lib/controller:{os.environ.get('LD_LIBRARY_PATH', '')}"
os.environ["WEBOTS_CONTROLLER_URL"] = "tcp://127.0.0.1:1234/Mavic 2 PRO"

env = os.environ.copy()

print("Starting Webots...")
webots_proc = subprocess.Popen([
    "webots", world_file, "--batch", "--mode=realtime", "--port=1234", "--stdout", "--stderr"
], env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)

# Wait for extern controller to be ready
ready = False
start = time.time()
while time.time() - start < 15.0:
    line = webots_proc.stdout.readline()
    print(f"[Webots] {line.strip()}")
    if "Waiting for local or remote connection" in line:
        ready = True
        break
    if webots_proc.poll() is not None:
        break

if not ready:
    print("Webots failed to start!")
    webots_proc.kill()
    sys.exit(1)

print("Webots ready on port 1234! Testing Robot controller connection...")
time.sleep(1.0)

# Connect controller
try:
    if '/usr/local/webots/lib/controller/python' not in sys.path:
        sys.path.insert(0, '/usr/local/webots/lib/controller/python')
    from controller import Robot
    robot = Robot()
    print(f"Connected to robot: {robot.getName()}")
    timestep = int(robot.getBasicTimeStep())
    cam = robot.getDevice('camera')
    if cam:
        cam.enable(timestep)
        print(f"Enabled camera: {cam.getWidth()}x{cam.getHeight()}")
    
    # Step simulation
    for i in range(10):
        robot.step(timestep)
        if cam:
            img = cam.getImage()
            if img:
                print(f"Frame {i+1}: got {len(img)} bytes from camera!")
                break
        time.sleep(0.05)
finally:
    print("Cleaning up...")
    webots_proc.kill()
