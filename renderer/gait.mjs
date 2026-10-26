export const STRIDE_PIXELS = 26;
const tau = Math.PI * 2;

// A longer planted phase and a raised return step avoid the old pendulum-like
// legs. IK keeps the sole level and gives the knee a real joint to bend around.
export function legPose(phase) {
  const progress = ((phase / tau) % 1 + 1) % 1;
  const planted = progress < .62;
  const swing = planted ? 0 : (progress - .62) / .38;
  const ease = swing * swing * (3 - 2 * swing);
  const z = planted ? .155 - .31 * progress / .62 : -.155 + .31 * ease;
  const lift = planted ? 0 : Math.sin(Math.PI * swing) * .055;
  const y = -.64 + lift;
  const upper = .34, lower = .32;
  const reach = Math.min(upper + lower - .0001, Math.hypot(y, z));
  const knee = Math.acos(Math.max(-1, Math.min(1, (reach * reach - upper * upper - lower * lower) / (2 * upper * lower))));
  const hip = Math.atan2(-z, -y) - Math.atan2(lower * Math.sin(knee), upper + lower * Math.cos(knee));
  return { hip, knee, ankle: -hip - knee, lift, z, planted };
}
