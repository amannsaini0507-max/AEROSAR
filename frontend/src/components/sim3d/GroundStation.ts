/**
 * Ground Source Station 3D Entity.
 * Represents the ground reception base station at the arena perimeter.
 * Comprises:
 * - Ruggedized container/tower base
 * - High-gain mast & directional/dipole antenna
 * - Pulsing status beacon (LED)
 * - 3D Three.js flat coverage ring mesh (Zero SVG)
 */

import * as THREE from 'three';
import type { StationDefinition } from '../../lib/lora/loraTypes';

export class GroundStation {
  public group: THREE.Group;
  public pos: [number, number]; // [x, z]
  public antennaHeight: number;
  public antennaWorldPos: THREE.Vector3;
  private statusBeacon: THREE.PointLight;
  private beaconMesh: THREE.Mesh;
  private rangeRingMesh: THREE.Mesh;

  constructor(def: StationDefinition = { pos: [-13.0, -13.0], antennaHeight: 6.0 }) {
    this.pos = [...def.pos];
    this.antennaHeight = def.antennaHeight;
    this.group = new THREE.Group();
    this.group.name = 'ground_source_station';
    this.group.position.set(this.pos[0], 0, this.pos[1]);

    this.antennaWorldPos = new THREE.Vector3(this.pos[0], this.antennaHeight, this.pos[1]);

    // 1. Tactical Container Base (Weatherproof IP67 Field Unit)
    const baseGeo = new THREE.BoxGeometry(1.6, 1.2, 1.4);
    const baseMat = new THREE.MeshStandardMaterial({
      color: 0x242e38, // Tactical dark grey
      roughness: 0.6,
      metalness: 0.8,
    });
    const baseMesh = new THREE.Mesh(baseGeo, baseMat);
    baseMesh.position.y = 0.6;
    baseMesh.castShadow = true;
    baseMesh.receiveShadow = true;
    this.group.add(baseMesh);

    // Hazard yellow high-contrast bands
    const stripeGeo = new THREE.BoxGeometry(1.62, 0.15, 1.42);
    const stripeMat = new THREE.MeshStandardMaterial({
      color: 0xeab308,
      roughness: 0.5,
    });
    const stripeMesh = new THREE.Mesh(stripeGeo, stripeMat);
    stripeMesh.position.y = 0.6;
    this.group.add(stripeMesh);

    // 2. Structural Telescopic Mast
    const mastGeo = new THREE.CylinderGeometry(0.06, 0.1, this.antennaHeight - 1.2, 8);
    const mastMat = new THREE.MeshStandardMaterial({
      color: 0x94a3b8,
      roughness: 0.3,
      metalness: 0.9,
    });
    const mastMesh = new THREE.Mesh(mastGeo, mastMat);
    mastMesh.position.y = 1.2 + (this.antennaHeight - 1.2) / 2;
    mastMesh.castShadow = true;
    this.group.add(mastMesh);

    // 3. Fiberglass LoRa Base Antenna (Omni / Dipole 3 dBi)
    const antGeo = new THREE.CylinderGeometry(0.02, 0.02, 0.8, 8);
    const antMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.2,
      metalness: 0.1,
    });
    const antMesh = new THREE.Mesh(antGeo, antMat);
    antMesh.position.y = this.antennaHeight + 0.4;
    this.group.add(antMesh);

    // 4. Pulsing Status Beacon (Green: LoRa Link Ready / Blue: RX Packet)
    const beaconGeo = new THREE.SphereGeometry(0.08, 12, 12);
    const beaconMat = new THREE.MeshBasicMaterial({ color: 0x22c55e });
    this.beaconMesh = new THREE.Mesh(beaconGeo, beaconMat);
    this.beaconMesh.position.y = this.antennaHeight + 0.85;
    this.group.add(this.beaconMesh);

    this.statusBeacon = new THREE.PointLight(0x22c55e, 1.5, 4.0);
    this.statusBeacon.position.copy(this.beaconMesh.position);
    this.group.add(this.statusBeacon);

    // 5. Flat 3D Three.js Range Ring Mesh on ground plane (Zero SVG)
    // Represents the nominal 15m radius LoRa coverage zone
    const ringGeo = new THREE.RingGeometry(14.8, 15.0, 64);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.35,
    });
    this.rangeRingMesh = new THREE.Mesh(ringGeo, ringMat);
    this.rangeRingMesh.rotation.x = -Math.PI / 2;
    this.rangeRingMesh.position.y = 0.04;
    this.group.add(this.rangeRingMesh);
  }

  public update(simTimeSec: number, hasActivePacket = false): void {
    // Pulse beacon light smoothly
    const pulse = 0.5 + 0.5 * Math.sin(simTimeSec * 4.0);
    const color = hasActivePacket ? 0x38bdf8 : 0x22c55e;

    (this.beaconMesh.material as THREE.MeshBasicMaterial).color.setHex(color);
    this.statusBeacon.color.setHex(color);
    this.statusBeacon.intensity = 0.8 + 1.2 * pulse;
  }

  public setPosition(x: number, z: number, antennaHeight = 6.0): void {
    this.pos = [x, z];
    this.antennaHeight = antennaHeight;
    this.group.position.set(x, 0, z);
    this.antennaWorldPos.set(x, antennaHeight, z);
  }

  public dispose(): void {
    // Dispose geometries and materials
    this.group.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) {
        const m = obj as THREE.Mesh;
        m.geometry?.dispose();
        if (Array.isArray(m.material)) {
          m.material.forEach((mat) => mat.dispose());
        } else {
          m.material?.dispose();
        }
      }
    });
  }
}
