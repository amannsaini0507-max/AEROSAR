#!/usr/bin/env python3
"""
AEROSAR Master ROS 2 System Topic & Rate Diagnostic Verification Tool
Member 1 — Drone Simulation & ROS 2 Lead
SIH 2026 — Search & Rescue Project

Monitors, samples, and measures ROS 2 graph health across all 5 official test scenarios:
- /camera/image_raw (target >= 15 Hz)
- /thermal/image_raw (target >= 5 Hz)
- /imu/data (target >= 30 Hz)
- /gps/fix (target >= 5 Hz)
- /perception/detection (active publisher verification)
- /navigation/cmd_vel (active publisher verification)

Renders a terminal dashboard with latency and rate metrics.
Exits with 0 on PASS, 1 on FAIL.
"""

import argparse
import sys
import time
from typing import Dict, List, Optional

import rclpy
from rclpy.node import Node
from rclpy.qos import QoSProfile, ReliabilityPolicy, HistoryPolicy
from sensor_msgs.msg import Image, Imu, NavSatFix
from geometry_msgs.msg import Twist
from aerosar_msgs.msg import Detection

# Terminal ANSI Color Codes
COLOR_GREEN = "\033[92m"
COLOR_RED = "\033[91m"
COLOR_YELLOW = "\033[93m"
COLOR_CYAN = "\033[96m"
COLOR_BOLD = "\033[1m"
COLOR_DIM = "\033[2m"
COLOR_RESET = "\033[0m"


class SystemTopicVerifier(Node):
    def __init__(self, sample_duration: float = 3.0, discovery_timeout: float = 5.0):
        super().__init__('verify_system_topics')
        self.sample_duration = sample_duration
        self.discovery_timeout = discovery_timeout

        # Topic Specifications
        self.specs = {
            '/camera/image_raw': {
                'msg_type': Image,
                'target_hz': 15.0,
                'require_rate': True,
                'description': 'Primary RGB video feed',
            },
            '/thermal/image_raw': {
                'msg_type': Image,
                'target_hz': 5.0,
                'require_rate': True,
                'description': 'Heat-mapped proxy camera feed',
            },
            '/imu/data': {
                'msg_type': Imu,
                'target_hz': 30.0,
                'require_rate': True,
                'description': 'IMU orientation & acceleration',
            },
            '/gps/fix': {
                'msg_type': NavSatFix,
                'target_hz': 5.0,
                'require_rate': True,
                'description': 'GNSS coordinates',
            },
            '/perception/detection': {
                'msg_type': Detection,
                'target_hz': 0.0,
                'require_rate': False,
                'description': 'Fused & geotagged detection',
            },
            '/navigation/cmd_vel': {
                'msg_type': Twist,
                'target_hz': 0.0,
                'require_rate': False,
                'description': 'Drone velocity command',
            },
        }

        # Sampling Data Containers
        self.timestamps: Dict[str, List[float]] = {topic: [] for topic in self.specs}
        self.message_counts: Dict[str, int] = {topic: 0 for topic in self.specs}
        self.subscriptions_list = []

        # Create QoS Profile
        qos = QoSProfile(
            reliability=ReliabilityPolicy.BEST_EFFORT,
            history=HistoryPolicy.KEEP_LAST,
            depth=50
        )

        # Create Subscriptions
        for topic, spec in self.specs.items():
            sub = self.create_subscription(
                spec['msg_type'],
                topic,
                self._make_callback(topic),
                qos
            )
            self.subscriptions_list.append(sub)

    def _make_callback(self, topic: str):
        def callback(msg):
            now = time.time()
            self.timestamps[topic].append(now)
            self.message_counts[topic] += 1
        return callback

    def run_diagnostics(self) -> bool:
        self.get_logger().info(
            f"Waiting up to {self.discovery_timeout:.1f}s for graph discovery and sampling for {self.sample_duration:.1f}s..."
        )

        start_time = time.time()
        end_time = start_time + self.sample_duration

        # Spin node for the sample window
        while rclpy.ok() and time.time() < end_time:
            rclpy.spin_once(self, timeout_sec=0.05)

        # Gather graph introspection
        all_passed = True
        results = []

        for topic, spec in self.specs.items():
            pubs_info = self.get_publishers_info_by_topic(topic)
            num_pubs = len(pubs_info)
            timestamps = self.timestamps[topic]
            count = len(timestamps)

            # Compute measured rate and latency
            if count >= 2:
                duration = timestamps[-1] - timestamps[0]
                measured_hz = (count - 1) / duration if duration > 0 else 0.0
                deltas = [timestamps[i] - timestamps[i - 1] for i in range(1, count)]
                avg_latency_ms = (sum(deltas) / len(deltas)) * 1000.0
            elif count == 1:
                measured_hz = 1.0 / self.sample_duration
                avg_latency_ms = self.sample_duration * 1000.0
            else:
                measured_hz = 0.0
                avg_latency_ms = 0.0

            # Evaluate Pass/Fail status
            target_hz = spec['target_hz']
            if spec['require_rate']:
                # Requires active publisher AND rate meeting target threshold
                passed = (num_pubs > 0) and (measured_hz >= target_hz)
            else:
                # Requires active publisher in graph
                passed = (num_pubs > 0)

            if not passed:
                all_passed = False

            results.append({
                'topic': topic,
                'pubs': num_pubs,
                'count': count,
                'measured_hz': measured_hz,
                'target_hz': target_hz,
                'latency_ms': avg_latency_ms,
                'passed': passed,
                'require_rate': spec['require_rate'],
                'description': spec['description'],
            })

        self._print_dashboard(results, all_passed)
        return all_passed

    def _print_dashboard(self, results: List[dict], all_passed: bool):
        border = f"{COLOR_CYAN}=" * 86 + f"{COLOR_RESET}"
        divider = f"{COLOR_DIM}-" * 86 + f"{COLOR_RESET}"

        print("\n" + border)
        print(f" {COLOR_BOLD}AEROSAR — ROS 2 System Health & Topic Verification Dashboard{COLOR_RESET}")
        print(f" {COLOR_DIM}Sampling Window: {self.sample_duration:.1f}s | Member 1 Drone Sim & ROS 2 Lead{COLOR_RESET}")
        print(border)
        print(
            f" {COLOR_BOLD}{'Topic Name':<26} {'Pubs':<6} {'Rate (Hz)':<13} {'Target':<11} {'Latency (ms)':<14} {'Status':<10}{COLOR_RESET}"
        )
        print(divider)

        pass_count = 0
        total_count = len(results)

        for r in results:
            if r['passed']:
                pass_count += 1
                status_str = f"{COLOR_GREEN}[PASS]{COLOR_RESET}"
                rate_color = COLOR_GREEN
            else:
                status_str = f"{COLOR_RED}[FAIL]{COLOR_RESET}"
                rate_color = COLOR_RED

            rate_display = f"{rate_color}{r['measured_hz']:>6.1f} Hz{COLOR_RESET}"
            target_display = f">= {r['target_hz']:.1f} Hz" if r['require_rate'] else "Active"
            latency_display = f"{r['latency_ms']:>6.1f} ms" if r['count'] > 0 else "   N/A   "
            pubs_display = f"{r['pubs']:>2}"

            print(
                f" {r['topic']:<26} {pubs_display:<6} {rate_display:<22} {target_display:<11} {latency_display:<14} {status_str}"
            )

        print(divider)
        if all_passed:
            overall_banner = f"{COLOR_BOLD}{COLOR_GREEN}✓ ALL SYSTEM TOPICS & PUBLISHER CHECKS PASSED ({pass_count}/{total_count}){COLOR_RESET}"
        else:
            overall_banner = f"{COLOR_BOLD}{COLOR_RED}✗ SYSTEM GRAPH DIAGNOSTIC ISSUES DETECTED ({pass_count}/{total_count} passed){COLOR_RESET}"

        print(f" Status Summary: {overall_banner}")
        print(border + "\n")


def main():
    parser = argparse.ArgumentParser(
        description="AEROSAR System ROS 2 Topics Verification & Health Diagnostic"
    )
    parser.add_argument(
        '--duration', type=float, default=3.0,
        help="Sampling window duration in seconds (default: 3.0)"
    )
    parser.add_argument(
        '--timeout', type=float, default=5.0,
        help="Timeout in seconds for graph discovery (default: 5.0)"
    )
    args, _ = parser.parse_known_args()

    rclpy.init(args=sys.argv)
    verifier = SystemTopicVerifier(
        sample_duration=args.duration,
        discovery_timeout=args.timeout
    )

    try:
        success = verifier.run_diagnostics()
    finally:
        verifier.destroy_node()
        if rclpy.ok():
            rclpy.shutdown()

    sys.exit(0 if success else 1)


if __name__ == '__main__':
    main()
