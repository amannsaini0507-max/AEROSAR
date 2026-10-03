/**
 * LoRa Physical Layer & Propagation Models.
 * Implements:
 * 1. Semtech SX1276 / AN1200.13 Time-on-Air (ToA) equation.
 * 2. Log-distance path loss with log-normal shadowing.
 * 3. Obstruction attenuation (concrete & debris).
 * 4. Receiver sensitivity and SNR demodulation limits.
 * 5. Adaptive Spreading Factor (ADR-like) logic with margin hysteresis.
 * 6. ETSI / regulatory duty-cycle tracking and enforcement.
 */

import {
  type LoRaSpreadingFactor,
  type LoRaRadioConfig,
  DEFAULT_LORA_CONFIG,
} from './loraTypes';

export interface SensitivitySpec {
  sensitivityDbm: number;
  minSnrDb: number;
}

export const SX1276_SPECS: Record<LoRaSpreadingFactor, SensitivitySpec> = {
  7: { sensitivityDbm: -123.0, minSnrDb: -7.5 },
  8: { sensitivityDbm: -126.0, minSnrDb: -10.0 },
  9: { sensitivityDbm: -129.0, minSnrDb: -12.5 },
  10: { sensitivityDbm: -132.0, minSnrDb: -15.0 },
  11: { sensitivityDbm: -134.5, minSnrDb: -17.5 },
  12: { sensitivityDbm: -137.0, minSnrDb: -20.0 },
};

/**
 * Calculates exact packet Time-on-Air (ToA) in milliseconds.
 * Follows Semtech SX1276 datasheet and AN1200.13 formulas.
 */
export function calculateTimeOnAirMs(
  payloadBytes: number,
  sf: LoRaSpreadingFactor,
  config: Partial<LoRaRadioConfig> = {}
): number {
  const cfg = { ...DEFAULT_LORA_CONFIG, ...config };
  const bw = cfg.bandwidthHz;
  const nPreamble = cfg.preambleLength;
  const cr = cfg.codingRate; // 1 = 4/5
  const h = 0; // explicit header
  const crc = 1; // CRC on

  // Symbol duration in seconds: Ts = 2^SF / BW
  const ts = Math.pow(2, sf) / bw;

  // Preamble duration in seconds
  const tPreamble = (nPreamble + 4.25) * ts;

  // Low Data Rate Optimization enabled when symbol duration > 16 ms (SF11, SF12 @ 125kHz)
  const de = ts > 0.016 ? 1 : 0;

  // Number of payload symbols (Semtech AN1200.13 formula)
  const nBits = 8 * payloadBytes - 4 * sf + 28 + 16 * crc - 20 * h;
  const nDenom = 4 * (sf - 2 * de);
  const nPayload = 8 + Math.max(Math.ceil(nBits / nDenom) * (cr + 4), 0);

  const tPayload = nPayload * ts;
  return (tPreamble + tPayload) * 1000.0;
}

/**
 * Free-space path loss at 1 meter for carrier frequency.
 * FSPL(1m) = 20*log10(f) + 20*log10(1) - 147.55
 */
export function freeSpacePathLoss1m(freqHz: number): number {
  const c = 299792458.0;
  return 20.0 * Math.log10((4.0 * Math.PI * freqHz) / c);
}

/**
 * Log-distance path loss model:
 * PL(d) = PL(1m) + 10 * n * log10(d) + shadowing
 */
export function calculatePathLossDb(
  distanceM: number,
  config: Partial<LoRaRadioConfig> = {},
  shadowingDb = 0.0
): number {
  const cfg = { ...DEFAULT_LORA_CONFIG, ...config };
  const d = Math.max(1.0, distanceM);
  const pl1m = freeSpacePathLoss1m(cfg.frequencyHz);
  return pl1m + 10.0 * cfg.pathLossExponent * Math.log10(d) + shadowingDb;
}

/**
 * Receiver noise floor in dBm:
 * N = -174 + 10*log10(BW) + NF
 */
export function calculateNoiseFloorDbm(config: Partial<LoRaRadioConfig> = {}): number {
  const cfg = { ...DEFAULT_LORA_CONFIG, ...config };
  return -174.0 + 10.0 * Math.log10(cfg.bandwidthHz) + cfg.noiseFigureDb;
}

/**
 * Computes link budget: RSSI and SNR at the receiver.
 */
export function calculateLinkBudget(
  distanceM: number,
  obstructionLossDb = 0.0,
  shadowingDb = 0.0,
  config: Partial<LoRaRadioConfig> = {}
): { rssiDbm: number; snrDb: number; pathLossDb: number; noiseFloorDbm: number } {
  const cfg = { ...DEFAULT_LORA_CONFIG, ...config };
  const pl = calculatePathLossDb(distanceM, cfg, shadowingDb);
  const rssi = cfg.txPowerDbm + cfg.droneAntennaGainDbi + cfg.stationAntennaGainDbi - pl - obstructionLossDb;
  const noise = calculateNoiseFloorDbm(cfg);
  const snr = rssi - noise;

  return {
    rssiDbm: Math.round(rssi * 10) / 10,
    snrDb: Math.round(snr * 10) / 10,
    pathLossDb: Math.round(pl * 10) / 10,
    noiseFloorDbm: Math.round(noise * 10) / 10,
  };
}

/**
 * Determines whether a packet is received successfully given RSSI, SNR, SF, and margin.
 * Seeded pseudo-randomness for repeatable edge-of-coverage loss.
 */
export function evaluatePacketDelivery(
  rssiDbm: number,
  snrDb: number,
  sf: LoRaSpreadingFactor,
  seed = 0.5
): { delivered: boolean; rssiMarginDb: number; snrMarginDb: number } {
  const spec = SX1276_SPECS[sf];
  const rssiMargin = rssiDbm - spec.sensitivityDbm;
  const snrMargin = snrDb - spec.minSnrDb;

  if (rssiMargin < 0 || snrMargin < 0) {
    return { delivered: false, rssiMarginDb: rssiMargin, snrMarginDb: snrMargin };
  }

  // Near margin (0-3 dB), small probability of bit error
  const minMargin = Math.min(rssiMargin, snrMargin);
  if (minMargin < 3.0) {
    const errorProb = (3.0 - minMargin) / 10.0;
    if (seed < errorProb) {
      return { delivered: false, rssiMarginDb: rssiMargin, snrMarginDb: snrMargin };
    }
  }

  return { delivered: true, rssiMarginDb: rssiMargin, snrMarginDb: snrMargin };
}

/**
 * Selects the optimal Spreading Factor giving at least minMarginDb (default 6 dB) margin.
 */
export function selectAdaptiveSpreadingFactor(
  rssiDbm: number,
  snrDb: number,
  minMarginDb = 6.0
): LoRaSpreadingFactor {
  const sfs: LoRaSpreadingFactor[] = [7, 8, 9, 10, 11, 12];
  for (const sf of sfs) {
    const spec = SX1276_SPECS[sf];
    const rssiMargin = rssiDbm - spec.sensitivityDbm;
    const snrMargin = snrDb - spec.minSnrDb;
    if (rssiMargin >= minMarginDb && snrMargin >= minMarginDb) {
      return sf;
    }
  }
  return 12; // Fallback to highest sensitivity SF12
}

/**
 * Manages ETSI 1% duty cycle tracking over a sliding window.
 */
export class DutyCycleTracker {
  private windowSec: number;
  private maxDutyCycle: number;
  private transmissions: Array<{ simTimeSec: number; airtimeSec: number }> = [];

  constructor(maxDutyCycle = 0.01, windowSec = 60.0) {
    this.maxDutyCycle = maxDutyCycle;
    this.windowSec = windowSec;
  }

  public canTransmit(airtimeMs: number, simTimeSec: number): boolean {
    this.prune(simTimeSec);
    const airtimeSec = airtimeMs / 1000.0;
    const currentAirtime = this.transmissions.reduce((acc, t) => acc + t.airtimeSec, 0);
    const projectedAirtime = currentAirtime + airtimeSec;
    return projectedAirtime / this.windowSec <= this.maxDutyCycle;
  }

  public recordTransmission(airtimeMs: number, simTimeSec: number): void {
    this.transmissions.push({
      simTimeSec,
      airtimeSec: airtimeMs / 1000.0,
    });
    this.prune(simTimeSec);
  }

  public getUtilization(simTimeSec: number): number {
    this.prune(simTimeSec);
    const totalAirtime = this.transmissions.reduce((acc, t) => acc + t.airtimeSec, 0);
    const maxAllowed = this.windowSec * this.maxDutyCycle;
    return maxAllowed > 0 ? Math.min(1.0, totalAirtime / maxAllowed) : 0;
  }

  private prune(simTimeSec: number): void {
    const cutoff = simTimeSec - this.windowSec;
    this.transmissions = this.transmissions.filter((t) => t.simTimeSec >= cutoff);
  }
}
