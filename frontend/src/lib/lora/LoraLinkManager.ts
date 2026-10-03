/**
 * LoRa Link Manager for No-Network Zones.
 * Coordinates link mode transitions, radio propagation, BVH obstruction raycasting,
 * priority packet queuing, Semtech duty-cycle enforcement, and station decoding relay.
 */

import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import {
  type LinkMode,
  type LinkModeCommand,
  type LoRaRadioConfig,
  type LoRaSpreadingFactor,
  type NoNetworkZone,
  type StationDefinition,
  type LinkStats,
  type QueuedPacket,
  type LoRaPacketLog,
  type PacketPriority,
  type LoRaFramePayload,
  DEFAULT_LORA_CONFIG,
  FrameType,
} from './loraTypes';
import {
  calculateTimeOnAirMs,
  calculateLinkBudget,
  evaluatePacketDelivery,
  selectAdaptiveSpreadingFactor,
  DutyCycleTracker,
} from './loraPhysics';
import {
  packHeartbeat,
  packVictim,
  packHazard,
  unpackFrame,
} from './loraFrames';

export interface StationStatusMsg {
  mode: LinkMode;
  rssi: number;
  snr: number;
  sf: number;
  pdr: number;
  last_packet_age_ms: number;
  queue_length: number;
  duty_cycle_use: number;
  packets_delivered: number;
  packets_lost: number;
  is_obstructed: boolean;
  obstruction_loss_db: number;
  scaled_distance_m: number;
  radio_scaled: boolean;
}

export class LoraLinkManager {
  public config: LoRaRadioConfig;
  public station: StationDefinition;
  public noNetworkZones: NoNetworkZone[] = [];
  public mode: LinkMode = 'NETWORK';
  public commandMode: LinkModeCommand = 'auto';

  private bvh: MeshBVH | null = null;
  private materialIndexMap: Uint8Array | null = null;
  private dutyCycleTracker: DutyCycleTracker;
  private queue: QueuedPacket[] = [];
  private outboxBuffer: QueuedPacket[] = []; // SQLite-style persistent buffer for unreachable items

  private currentSf: LoRaSpreadingFactor = 7;
  private consecutiveGoodPackets = 0;
  private packetsDelivered = 0;
  private packetsLost = 0;
  private lastDeliveredSimTime: number | null = null;

  private networkLostTimer = 0.0;
  public isInsideBlackoutZone = false;
  private seqCounter = 1;
  private lastHeartbeatSimTime = -10.0;

  private statsCache: LinkStats;

  // Event callbacks
  public onRelayMessage?: (msg: {
    type: string;
    data: Record<string, unknown>;
  }) => void;
  public onPacketLog?: (log: LoRaPacketLog) => void;
  public onStationStatus?: (status: StationStatusMsg) => void;

  constructor(
    station: StationDefinition = { pos: [-13.0, -13.0], antennaHeight: 6.0 },
    config: Partial<LoRaRadioConfig> = {}
  ) {
    this.station = { ...station };
    this.config = { ...DEFAULT_LORA_CONFIG, ...config };
    this.dutyCycleTracker = new DutyCycleTracker(this.config.dutyCycleMax, 60.0);

    this.statsCache = {
      mode: 'NETWORK',
      rssiDb: -80,
      snrDb: 10,
      currentSf: 7,
      pdr: 1.0,
      lastPacketAgeMs: 0,
      queueLength: 0,
      dutyCycleUse: 0.0,
      packetsDelivered: 0,
      packetsLost: 0,
      isObstructed: false,
      obstructionLossDb: 0.0,
      scaledDistanceM: 0.0,
    };
  }

  public setBVH(bvh: MeshBVH | null, materialIndexMap: Uint8Array | null = null): void {
    this.bvh = bvh;
    this.materialIndexMap = materialIndexMap;
  }

  public setNoNetworkZones(zones: NoNetworkZone[]): void {
    this.noNetworkZones = [...zones];
  }

  public setLinkModeCommand(cmd: LinkModeCommand): void {
    this.commandMode = cmd;
    if (cmd === 'force_lora') {
      this.transitionMode('LORA_ONLY');
    } else if (cmd === 'force_offline') {
      this.transitionMode('OFFLINE');
    }
  }

  /**
   * Main simulation tick update.
   */
  public update(
    delta: number,
    simTimeSec: number,
    dronePos: THREE.Vector3,
    droneState = { state: 1, batteryPercent: 98, lat: 26.9124, lon: 75.7873, altM: 5.0 }
  ): void {
    // 1. Zone detection & Link Mode state machine
    this.evaluateZoneTransition(delta, dronePos);

    // 2. Radio line-of-sight & Link Budget calculation
    const linkBudget = this.calculateRadioLink(dronePos);

    // 3. Heartbeat generation every 5.0 seconds
    if (simTimeSec - this.lastHeartbeatSimTime >= 5.0) {
      this.lastHeartbeatSimTime = simTimeSec;
      if (this.mode === 'LORA_ONLY') {
        this.enqueueHeartbeat(droneState, simTimeSec);
      }
    }

    // 4. Process packet transmissions in LORA_ONLY mode
    if (this.mode === 'LORA_ONLY') {
      this.processTransmissionQueue(simTimeSec, linkBudget);
    }

    // 5. Update stats cache and notify listeners
    this.updateStats(simTimeSec, linkBudget);
  }

  private evaluateZoneTransition(delta: number, dronePos: THREE.Vector3): void {
    // Check if drone is inside any defined no-network blackout zone
    let inZone = false;
    for (const z of this.noNetworkZones) {
      const minX = Math.min(z.x0, z.x1);
      const maxX = Math.max(z.x0, z.x1);
      const minZ = Math.min(z.z0, z.z1);
      const maxZ = Math.max(z.z0, z.z1);

      if (dronePos.x >= minX && dronePos.x <= maxX && dronePos.z >= minZ && dronePos.z <= maxZ) {
        inZone = true;
        break;
      }
    }

    this.isInsideBlackoutZone = inZone;

    if (this.commandMode === 'auto') {
      if (inZone) {
        this.networkLostTimer += delta;
        // Switches to LoRa after 2.0 s of lost network
        if (this.networkLostTimer >= 2.0 && this.mode === 'NETWORK') {
          this.transitionMode('LORA_ONLY');
        }
      } else {
        this.networkLostTimer = 0.0;
        if (this.mode !== 'NETWORK') {
          this.transitionMode('NETWORK');
        }
      }
    }
  }

  private transitionMode(newMode: LinkMode): void {
    const oldMode = this.mode;
    this.mode = newMode;

    if (oldMode !== 'NETWORK' && newMode === 'NETWORK') {
      // Flushes buffered queue when returning to NETWORK
      this.flushOutboxOnNetworkRestored();
    }
  }

  private flushOutboxOnNetworkRestored(): void {
    // All items accumulated in outbox are relayed immediately
    for (const pkt of this.outboxBuffer) {
      this.relayDeliveredFrame(pkt.payload, 0, 0, this.currentSf, 0, 0);
    }
    this.outboxBuffer = [];
  }

  /**
   * Casts ray through BVH to detect concrete/debris obstacle attenuation.
   * Specification: 8 dB per concrete obstacle (capped at 30 dB), 4 dB through debris.
   */
  public calculateObstruction(dronePos: THREE.Vector3): { isObstructed: boolean; lossDb: number } {
    if (!this.bvh) return { isObstructed: false, lossDb: 0.0 };

    const stationAntenna = new THREE.Vector3(this.station.pos[0], this.station.antennaHeight, this.station.pos[1]);
    const fullVec = stationAntenna.clone().sub(dronePos);
    const totalDist = fullVec.length();
    if (totalDist < 0.2) return { isObstructed: false, lossDb: 0.0 };

    const dir = fullVec.clone().normalize();
    const ray = new THREE.Ray();
    const currentOrigin = dronePos.clone();
    let remainingDist = totalDist;
    let totalLossDb = 0.0;
    let hitCount = 0;

    // Ray march through collidable geometry between drone and station antenna (max 5 obstacles)
    while (remainingDist > 0.3 && hitCount < 5 && totalLossDb < 30.0) {
      ray.origin.copy(currentOrigin);
      ray.direction.copy(dir);

      const hit = this.bvh.raycastFirst(ray);
      if (!hit || hit.distance >= remainingDist - 0.2) {
        break;
      }

      hitCount++;
      // Determine material: 3=debris (4 dB), other/concrete (8 dB)
      let obstacleLoss = 8.0;
      if (this.materialIndexMap && hit.faceIndex != null) {
        const matIdx = this.materialIndexMap[hit.faceIndex];
        if (matIdx === 3) {
          obstacleLoss = 4.0; // debris
        }
      }
      totalLossDb = Math.min(30.0, totalLossDb + obstacleLoss);

      // Step past the obstacle surface to check for subsequent obstructions
      const stepDist = hit.distance + 0.35;
      if (stepDist >= remainingDist) break;
      currentOrigin.addScaledVector(dir, stepDist);
      remainingDist = stationAntenna.distanceTo(currentOrigin);
    }

    return {
      isObstructed: hitCount > 0,
      lossDb: totalLossDb,
    };
  }

  public calculateRadioLink(dronePos: THREE.Vector3): {
    rssiDbm: number;
    snrDb: number;
    pathLossDb: number;
    noiseFloorDbm: number;
    isObstructed: boolean;
    lossDb: number;
    scaledDistanceM: number;
  } {
    const dx = (dronePos.x - this.station.pos[0]) * this.config.worldScale;
    const dz = (dronePos.z - this.station.pos[1]) * this.config.worldScale;
    const dy = (dronePos.y - this.station.antennaHeight) * this.config.worldScale;
    const scaledDistance = Math.hypot(dx, dz, dy) + this.config.stationDistanceOffsetM;

    const obstruction = this.calculateObstruction(dronePos);
    const budget = calculateLinkBudget(scaledDistance, obstruction.lossDb, 0.0, this.config);

    return {
      ...budget,
      isObstructed: obstruction.isObstructed,
      lossDb: obstruction.lossDb,
      scaledDistanceM: Math.round(scaledDistance * 10) / 10,
    };
  }

  public enqueueVictim(
    victim: {
      id: string;
      lat: number;
      lon: number;
      confidence: number;
      thermalConfirmed: boolean;
      riskLevel: number;
    },
    simTimeSec: number
  ): void {
    // Deduplication check: ignore if victim is already queued
    const alreadyQueued = this.queue.some(
      (p) => p.payload.type === FrameType.VICTIM && (p.payload as { id: string }).id === victim.id
    );
    if (alreadyQueued) return;

    const seq = this.seqCounter++;
    const rawBuffer = packVictim({
      id: victim.id,
      lat: victim.lat,
      lon: victim.lon,
      confidence: victim.confidence,
      thermalConfirmed: victim.thermalConfirmed,
      riskLevel: victim.riskLevel,
      seq,
    });

    const payload: LoRaFramePayload = {
      type: FrameType.VICTIM,
      id: victim.id,
      lat: victim.lat,
      lon: victim.lon,
      confidence: victim.confidence,
      thermalConfirmed: victim.thermalConfirmed,
      riskLevel: victim.riskLevel,
      seq,
    };

    const priority: PacketPriority = victim.riskLevel >= 3 ? 'CRITICAL' : 'HIGH';

    this.insertPriorityQueue({
      id: `vic-${victim.id}-${seq}`,
      seq,
      priority,
      rawBuffer,
      payload,
      attempts: 0,
      maxAttempts: 3,
      enqueuedAtSimTime: simTimeSec,
      nextRetrySimTime: simTimeSec,
    });
  }

  public enqueueHazard(
    hazard: {
      hazardType: number;
      lat: number;
      lon: number;
      radiusM: number;
    },
    simTimeSec: number
  ): void {
    const seq = this.seqCounter++;
    const rawBuffer = packHazard({ ...hazard, seq });
    const payload: LoRaFramePayload = {
      type: FrameType.HAZARD,
      ...hazard,
      seq,
    };

    this.insertPriorityQueue({
      id: `haz-${hazard.hazardType}-${seq}`,
      seq,
      priority: 'HIGH',
      rawBuffer,
      payload,
      attempts: 0,
      maxAttempts: 3,
      enqueuedAtSimTime: simTimeSec,
      nextRetrySimTime: simTimeSec,
    });
  }

  private enqueueHeartbeat(
    droneState: { state: number; batteryPercent: number; lat: number; lon: number; altM: number },
    simTimeSec: number
  ): void {
    const seq = this.seqCounter++;
    const rawBuffer = packHeartbeat({ ...droneState, seq });
    const payload: LoRaFramePayload = {
      type: FrameType.HEARTBEAT,
      ...droneState,
      seq,
    };

    this.insertPriorityQueue({
      id: `hb-${seq}`,
      seq,
      priority: 'NORMAL',
      rawBuffer,
      payload,
      attempts: 0,
      maxAttempts: 1, // Heartbeats drop rather than infinite retries
      enqueuedAtSimTime: simTimeSec,
      nextRetrySimTime: simTimeSec,
    });
  }

  private insertPriorityQueue(pkt: QueuedPacket): void {
    const priorityWeight: Record<PacketPriority, number> = {
      CRITICAL: 4,
      HIGH: 3,
      NORMAL: 2,
      LOW: 1,
    };

    // Insert sorted by priority (CRITICAL > HIGH > other)
    const idx = this.queue.findIndex(
      (p) => priorityWeight[p.priority] < priorityWeight[pkt.priority]
    );

    if (idx === -1) {
      this.queue.push(pkt);
    } else {
      this.queue.splice(idx, 0, pkt);
    }
  }

  private processTransmissionQueue(
    simTimeSec: number,
    linkBudget: { rssiDbm: number; snrDb: number }
  ): void {
    if (this.queue.length === 0) return;

    // 1. Adaptive SF selection (picks lowest SF giving >= 6 dB margin)
    this.currentSf = selectAdaptiveSpreadingFactor(linkBudget.rssiDbm, linkBudget.snrDb, 6.0);

    const pkt = this.queue[0];
    if (simTimeSec < pkt.nextRetrySimTime) return;

    const airtimeMs = calculateTimeOnAirMs(pkt.rawBuffer.byteLength, this.currentSf, this.config);

    // 2. ETSI 1% Duty-cycle check
    if (!this.dutyCycleTracker.canTransmit(airtimeMs, simTimeSec)) {
      // When duty cycle exhausted, drop lowest-priority packet from end of queue
      const dropped = this.queue.pop();
      if (dropped) {
        this.onPacketLog?.({
          dir: 'tx',
          type: this.getFrameTypeName(dropped.payload.type),
          size: dropped.rawBuffer.byteLength,
          sf: this.currentSf,
          rssi: linkBudget.rssiDbm,
          snr: linkBudget.snrDb,
          airtime_ms: airtimeMs,
          result: 'duty_exhausted',
          sim_time: simTimeSec,
        });
      }
      return;
    }

    // 3. Transmit packet over radio channel
    this.dutyCycleTracker.recordTransmission(airtimeMs, simTimeSec);
    pkt.attempts++;

    const delivery = evaluatePacketDelivery(linkBudget.rssiDbm, linkBudget.snrDb, this.currentSf);

    if (delivery.delivered) {
      // Packet received successfully by station
      this.packetsDelivered++;
      this.consecutiveGoodPackets++;
      this.lastDeliveredSimTime = simTimeSec;

      // Station decodes frame & sends ACK
      this.handleStationReception(pkt, airtimeMs, linkBudget, simTimeSec);

      // Remove from queue
      this.queue.shift();
    } else {
      // Packet lost due to attenuation, obstruction or marginal SNR
      this.packetsLost++;
      this.consecutiveGoodPackets = 0;

      this.onPacketLog?.({
        dir: 'tx',
        type: this.getFrameTypeName(pkt.payload.type),
        size: pkt.rawBuffer.byteLength,
        sf: this.currentSf,
        rssi: linkBudget.rssiDbm,
        snr: linkBudget.snrDb,
        airtime_ms: airtimeMs,
        result: 'lost',
        sim_time: simTimeSec,
      });

      if (pkt.attempts >= pkt.maxAttempts) {
        // Exceeded retries -> keep in offline outbox buffer
        this.queue.shift();
        if (pkt.payload.type !== FrameType.HEARTBEAT) {
          this.outboxBuffer.push(pkt);
        }
      } else {
        // Exponential retry backoff: 1.0s, 2.0s, 4.0s
        pkt.nextRetrySimTime = simTimeSec + Math.pow(2.0, pkt.attempts - 1);
      }
    }
  }

  private handleStationReception(
    pkt: QueuedPacket,
    airtimeMs: number,
    linkBudget: { rssiDbm: number; snrDb: number },
    simTimeSec: number
  ): void {
    // Unpack from binary buffer using DataView
    const decoded = unpackFrame(pkt.rawBuffer);
    const ageMs = Math.round((simTimeSec - pkt.enqueuedAtSimTime) * 1000);

    // Station logs RX & ACK
    this.onPacketLog?.({
      dir: 'rx',
      type: this.getFrameTypeName(decoded.type),
      size: pkt.rawBuffer.byteLength,
      sf: this.currentSf,
      rssi: linkBudget.rssiDbm,
      snr: linkBudget.snrDb,
      airtime_ms: airtimeMs,
      result: 'delivered',
      sim_time: simTimeSec,
    });

    // Relay to backend / live operations with via: "lora"
    this.relayDeliveredFrame(decoded, linkBudget.rssiDbm, linkBudget.snrDb, this.currentSf, airtimeMs, ageMs);
  }

  private relayDeliveredFrame(
    payload: LoRaFramePayload,
    rssi: number,
    snr: number,
    sf: number,
    airtimeMs: number,
    ageMs: number
  ): void {
    if (!this.onRelayMessage) return;

    if (payload.type === FrameType.VICTIM) {
      this.onRelayMessage({
        type: 'detection',
        data: {
          id: payload.id,
          detection_type: 'person',
          confidence: payload.confidence,
          thermal_confirmed: payload.thermalConfirmed,
          latitude: payload.lat,
          longitude: payload.lon,
          status: 'CONFIRMED',
          via: 'lora',
          rssi,
          snr,
          sf,
          airtime_ms: airtimeMs,
          age_ms: ageMs,
        },
      });
    } else if (payload.type === FrameType.HAZARD) {
      const hazardNames = ['fire', 'smoke', 'flood', 'debris', 'damaged_structure'];
      this.onRelayMessage({
        type: 'hazard',
        data: {
          id: `haz-${payload.hazardType}`,
          hazard_type: hazardNames[payload.hazardType] || 'fire',
          latitude: payload.lat,
          longitude: payload.lon,
          radius: payload.radiusM,
          confidence: 0.95,
          via: 'lora',
        },
      });
    }
  }

  private updateStats(
    simTimeSec: number,
    linkBudget: { rssiDbm: number; snrDb: number; isObstructed: boolean; lossDb: number; scaledDistanceM: number }
  ): void {
    const totalPackets = this.packetsDelivered + this.packetsLost;
    const pdr = totalPackets > 0 ? this.packetsDelivered / totalPackets : 1.0;
    const lastPacketAgeMs = this.lastDeliveredSimTime != null
      ? Math.round((simTimeSec - this.lastDeliveredSimTime) * 1000)
      : 0;

    const dutyCycleUse = this.dutyCycleTracker.getUtilization(simTimeSec);

    this.statsCache = {
      mode: this.mode,
      rssiDb: linkBudget.rssiDbm,
      snrDb: linkBudget.snrDb,
      currentSf: this.currentSf,
      pdr: Math.round(pdr * 100) / 100,
      lastPacketAgeMs,
      queueLength: this.queue.length + this.outboxBuffer.length,
      dutyCycleUse: Math.round(dutyCycleUse * 100) / 100,
      packetsDelivered: this.packetsDelivered,
      packetsLost: this.packetsLost,
      isObstructed: linkBudget.isObstructed,
      obstructionLossDb: linkBudget.lossDb,
      scaledDistanceM: linkBudget.scaledDistanceM,
    };

    this.onStationStatus?.({
      mode: this.mode,
      rssi: this.statsCache.rssiDb,
      snr: this.statsCache.snrDb,
      sf: this.statsCache.currentSf,
      pdr: this.statsCache.pdr,
      last_packet_age_ms: this.statsCache.lastPacketAgeMs,
      queue_length: this.statsCache.queueLength,
      duty_cycle_use: this.statsCache.dutyCycleUse,
      packets_delivered: this.statsCache.packetsDelivered,
      packets_lost: this.statsCache.packetsLost,
      is_obstructed: this.statsCache.isObstructed,
      obstruction_loss_db: this.statsCache.obstructionLossDb,
      scaled_distance_m: this.statsCache.scaledDistanceM,
      radio_scaled: true,
    });
  }

  public getStats(): LinkStats {
    return { ...this.statsCache };
  }

  public getOutboxCount(): number {
    return this.outboxBuffer.length;
  }

  public getQueueCount(): number {
    return this.queue.length;
  }

  private getFrameTypeName(type: FrameType): 'HEARTBEAT' | 'VICTIM' | 'HAZARD' | 'ACK' {
    switch (type) {
      case FrameType.HEARTBEAT: return 'HEARTBEAT';
      case FrameType.VICTIM: return 'VICTIM';
      case FrameType.HAZARD: return 'HAZARD';
      case FrameType.ACK: return 'ACK';
    }
  }
}
