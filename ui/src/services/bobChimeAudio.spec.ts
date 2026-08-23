import { describe, expect, it, vi } from 'vitest';
import { configureBobChime, startBobChime } from './bobChimeAudio';

function audioParam() {
  return {
    setValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
  };
}

describe('configureBobChime', () => {
  it('configures the exact two-oscillator Bob Chime signature', () => {
    const sineFrequency = audioParam();
    const triangleFrequency = audioParam();
    const sine = {
      type: 'custom',
      frequency: sineFrequency,
      connect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
    };
    const triangle = {
      type: 'custom',
      frequency: triangleFrequency,
      connect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
    };
    const sineGain = audioParam();
    const triangleGain = audioParam();
    const masterGain = audioParam();
    const sineWeight = { gain: sineGain, connect: vi.fn() };
    const triangleWeight = { gain: triangleGain, connect: vi.fn() };
    const master = { gain: masterGain, connect: vi.fn() };
    sine.connect.mockReturnValue(sineWeight);
    triangle.connect.mockReturnValue(triangleWeight);
    sineWeight.connect.mockReturnValue(master);
    triangleWeight.connect.mockReturnValue(master);
    const destination = {};
    const context = {
      destination,
      createOscillator: vi
        .fn()
        .mockReturnValueOnce(sine)
        .mockReturnValueOnce(triangle),
      createGain: vi
        .fn()
        .mockReturnValueOnce(sineWeight)
        .mockReturnValueOnce(triangleWeight)
        .mockReturnValueOnce(master),
    } as unknown as AudioContext;

    const configured = configureBobChime(context, 12);
    startBobChime(configured, 12);

    expect(sine.type).toBe('sine');
    expect(triangle.type).toBe('triangle');
    for (const frequency of [sineFrequency, triangleFrequency]) {
      expect(frequency.setValueAtTime).toHaveBeenCalledWith(720, 12);
      expect(frequency.exponentialRampToValueAtTime).toHaveBeenNthCalledWith(
        1,
        960,
        12.065,
      );
      expect(frequency.exponentialRampToValueAtTime).toHaveBeenNthCalledWith(
        2,
        820,
        12.18,
      );
    }
    expect(sineGain.setValueAtTime).toHaveBeenCalledWith(1 / 1.18, 12);
    expect(triangleGain.setValueAtTime).toHaveBeenCalledWith(0.18 / 1.18, 12);
    expect(masterGain.setValueAtTime).toHaveBeenCalledWith(0, 12);
    expect(masterGain.linearRampToValueAtTime).toHaveBeenCalledWith(0.1, 12.005);
    expect(masterGain.exponentialRampToValueAtTime).toHaveBeenCalledWith(
      0.0001,
      12.18,
    );
    expect(configured.stoppedAt).toBe(12.18);
    expect(master.connect).toHaveBeenCalledWith(destination);
    expect(sine.start).toHaveBeenCalledWith(12);
    expect(triangle.start).toHaveBeenCalledWith(12);
    expect(sine.stop).toHaveBeenCalledWith(12.18);
    expect(triangle.stop).toHaveBeenCalledWith(12.18);
  });
});
