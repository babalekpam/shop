/**
 * The kill switch.
 *
 * One flag halts every outbound action across every channel. A system that runs
 * unattended needs an off switch more than it needs any individual feature.
 *
 * **It fails safe.** If the flag store cannot be read — file missing, permissions wrong,
 * disk gone — outbound stops. The alternative is a system that resumes sending precisely
 * when its own infrastructure is in an unknown state, which is the worst possible moment
 * to assume everything is fine. (Spec §3.2.)
 */

import { readFileSync } from 'node:fs';

export interface KillSwitchState {
  engaged: boolean;
  reason: string;
  setBy: string;
  at: string;
}

export interface KillSwitchReader {
  /** Throws if the state cannot be determined. Do not catch inside the reader. */
  read(): KillSwitchState;
}

/** Reads a JSON file. Any failure is a failure to prove it is safe to send. */
export class FileKillSwitch implements KillSwitchReader {
  constructor(private readonly path: string) {}

  read(): KillSwitchState {
    const raw = readFileSync(this.path, 'utf8');
    const parsed = JSON.parse(raw) as Partial<KillSwitchState>;
    return {
      engaged: parsed.engaged === true,
      reason: parsed.reason ?? '',
      setBy: parsed.setBy ?? 'unknown',
      at: parsed.at ?? '',
    };
  }
}

/** For tests and for the in-process default. */
export class InMemoryKillSwitch implements KillSwitchReader {
  private state: KillSwitchState = { engaged: false, reason: '', setBy: '', at: '' };
  private failing = false;

  read(): KillSwitchState {
    if (this.failing) throw new Error('kill switch store unreachable');
    return this.state;
  }

  engage(reason: string, setBy: string): void {
    this.state = { engaged: true, reason, setBy, at: new Date().toISOString() };
  }

  release(): void {
    this.state = { engaged: false, reason: '', setBy: '', at: '' };
  }

  /** Simulate the store being unreachable, so the fail-safe path can be tested. */
  breakStore(): void {
    this.failing = true;
  }
}

export interface KillSwitchVerdict {
  halted: boolean;
  reason: string;
}

/**
 * Resolve the switch.
 *
 * A read failure is reported as halted, with the reason recorded, so the digest tells an
 * operator that outbound stopped *because the switch could not be read* rather than
 * leaving them to wonder why nothing sent.
 */
export function resolveKillSwitch(reader: KillSwitchReader): KillSwitchVerdict {
  try {
    const state = reader.read();
    return state.engaged
      ? { halted: true, reason: state.reason || 'kill switch engaged' }
      : { halted: false, reason: '' };
  } catch (error) {
    return {
      halted: true,
      reason: `kill switch unreadable, failing safe: ${(error as Error).message}`,
    };
  }
}
