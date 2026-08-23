export interface BobChimeNodes {
  sine: OscillatorNode;
  triangle: OscillatorNode;
  sineWeight: GainNode;
  triangleWeight: GainNode;
  master: GainNode;
  stoppedAt: number;
}

export function configureBobChime(
  context: AudioContext,
  startedAt: number,
): BobChimeNodes {
  const stoppedAt = startedAt + 0.18;
  const sine = context.createOscillator();
  const triangle = context.createOscillator();
  const sineWeight = context.createGain();
  const triangleWeight = context.createGain();
  const master = context.createGain();

  sine.type = 'sine';
  triangle.type = 'triangle';
  for (const oscillator of [sine, triangle]) {
    oscillator.frequency.setValueAtTime(720, startedAt);
    oscillator.frequency.exponentialRampToValueAtTime(960, startedAt + 0.065);
    oscillator.frequency.exponentialRampToValueAtTime(820, stoppedAt);
  }
  sineWeight.gain.setValueAtTime(1 / 1.18, startedAt);
  triangleWeight.gain.setValueAtTime(0.18 / 1.18, startedAt);
  master.gain.setValueAtTime(0, startedAt);
  master.gain.linearRampToValueAtTime(0.1, startedAt + 0.005);
  master.gain.exponentialRampToValueAtTime(0.0001, stoppedAt);

  sine.connect(sineWeight).connect(master);
  triangle.connect(triangleWeight).connect(master);
  master.connect(context.destination);
  return { sine, triangle, sineWeight, triangleWeight, master, stoppedAt };
}
export function startBobChime(
  nodes: BobChimeNodes,
  startedAt: number,
): void {
  nodes.sine.start(startedAt);
  nodes.triangle.start(startedAt);
  nodes.sine.stop(nodes.stoppedAt);
  nodes.triangle.stop(nodes.stoppedAt);
}
