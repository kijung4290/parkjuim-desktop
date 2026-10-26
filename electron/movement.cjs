const clamp = (value, low, high) => Math.min(Math.max(value, low), Math.max(low, high));

function createWalker({ random = Math.random } = {}) {
  let position = null, goal = null, velocity = 0, distance = 0, direction = 1, restUntil = 0;
  return {
    reset(point, now = 0, rest = 3000) {
      position = { x: point.x, y: point.y }; goal = null; velocity = 0; restUntil = now + rest;
    },
    pause(now, rest = 1800) { goal = null; velocity = 0; restUntil = Math.max(restUntil, now + rest); },
    setGoal(point, destination, now = 0) {
      position = { x: point.x, y: point.y }; goal = { x: destination.x, y: destination.y }; velocity = 0; restUntil = now;
    },
    step({ bounds, area, dt, now, speed, scale = 1, paused = false }) {
      const limitX = area.x + area.width - bounds.width, limitY = area.y + area.height - bounds.height;
      if (!position || Math.abs(Math.round(position.x) - bounds.x) > 2 || Math.abs(Math.round(position.y) - bounds.y) > 2) {
        position = { x: bounds.x, y: bounds.y }; goal = null; velocity = 0;
      }
      if (paused) this.pause(now, 1600);
      if (!paused && now >= restUntil && !goal) {
        const length = (110 + random() * 180) * scale;
        let sign = random() < .5 ? -1 : 1;
        if (position.x + length * sign < area.x + 12 || position.x + length * sign > limitX - 12) sign *= -1;
        goal = {
          x: clamp(position.x + sign * length, area.x, limitX),
          y: clamp(position.y + (random() - .5) * 36 * scale, area.y + area.height * .45, limitY)
        };
      }
      let moving = false;
      if (!paused && goal && now >= restUntil) {
        const dx = goal.x - position.x, dy = goal.y - position.y, remaining = Math.hypot(dx, dy);
        if (remaining <= .15) {
          position = { ...goal }; goal = null; velocity = 0; restUntil = now + 4500 + random() * 6500;
        } else {
          direction = dx < 0 ? -1 : 1;
          const acceleration = Math.max(30, speed * 2.2);
          const wanted = Math.min(speed, Math.sqrt(2 * acceleration * remaining));
          velocity += clamp(wanted - velocity, -acceleration * dt, acceleration * dt);
          const travel = Math.min(remaining, Math.max(0, velocity) * Math.min(dt, .05));
          position.x = clamp(position.x + dx / remaining * travel, area.x, limitX);
          position.y = clamp(position.y + dy / remaining * travel, area.y, limitY);
          distance += travel; moving = travel > .00001;
        }
      }
      return { x: position.x, y: position.y, moving, direction, speed: moving ? velocity : 0, distance };
    }
  };
}
module.exports = { createWalker };
