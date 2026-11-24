export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export class FishingGame {
  constructor(onEvent = () => {}, random = Math.random) {
    this.onEvent = onEvent;
    this.random = random;
    this.gear = 1;
    this.reset();
  }
  emit(type, detail = {}) { this.onEvent({ type, ...detail }); }
  reset() {
    Object.assign(this, {
      phase: 'cast', time: 0, phaseTime: 0, holding: false, chargeTime: 0,
      power: 0, accuracy: 0, castPower: 0, castAccuracy: 0, quality: 0,
      distance: 36, castDistance: 36, attack: 0, attackCap: 100, tension: 38,
      stamina: 100, slackTime: 0, overTime: 0, jerkAge: 99, jerkCooldown: 0,
      pauseAge: 0, activeRetrieveTime: 0, comboCount: 0, cycleTime: 0,
      warning: false, rushing: false, swim: '等待入水', lostReason: '',
      fishWeight: 0, fishLength: 0, lastJerkTime: -99, pauseRewarded: true,
    });
  }
  setPhase(phase) { this.phase = phase; this.phaseTime = 0; this.emit('phase', { phase }); }
  press() {
    if (!['cast', 'retrieve', 'fight'].includes(this.phase) || this.holding) return;
    this.holding = true;
    if (this.phase === 'cast') this.chargeTime = 0;
    if (this.phase === 'retrieve') this.pauseAge = 0;
  }
  release() {
    if (!this.holding) return;
    this.holding = false;
    if (this.phase === 'cast') this.cast();
    if (this.phase === 'retrieve') this.pauseAge = 0;
  }
  cancelInput() { this.holding = false; }
  setGear(gear) { this.gear = clamp(gear, 0, 2); }
  cast() {
    this.castPower = this.power;
    this.castAccuracy = this.accuracy;
    this.castDistance = 54 * this.castPower;
    this.distance = this.castDistance;
    const radialError = Math.hypot((this.castDistance - 36), this.castAccuracy * 8);
    this.quality = clamp(1 - radialError / 23, 0, 1);
    // The reference's key rule: accuracy limits the fish's maximum interest.
    this.attackCap = 52 + 48 * this.quality;
    this.attack = 8 + this.quality * 17;
    this.emit('cast', { quality: this.quality, distance: this.castDistance });
    this.setPhase('flying');
  }
  jerk() {
    if (this.phase !== 'retrieve' || this.jerkCooldown > 0) return false;
    const gap = this.phaseTime - this.lastJerkTime;
    const rhythmic = gap >= 1.8 && gap <= 4.2 && this.activeRetrieveTime >= .7;
    this.lastJerkTime = this.phaseTime;
    this.jerkAge = 0;
    this.jerkCooldown = .7;
    this.pauseRewarded = false;
    this.attack = Math.min(this.attackCap, this.attack + (rhythmic ? 14 : 5));
    this.activeRetrieveTime = 0;
    this.emit('jerk', { rhythmic });
    return true;
  }
  fail(reason) { this.holding = false; this.lostReason = reason; this.setPhase('failed'); this.emit('lost', { reason }); }
  update(dt) {
    dt = clamp(dt, 0, .1);
    this.time += dt;
    this.phaseTime += dt;
    if (this.phase === 'cast') {
      if (this.holding) {
        this.chargeTime += dt;
        const ramp = (this.chargeTime * .42) % 2;
        this.power = ramp <= 1 ? ramp : 2 - ramp;
        this.accuracy = Math.sin(this.chargeTime * Math.PI / .8);
      } else { this.power = 0; this.accuracy = Math.sin(this.time * 2.2); }
    } else if (this.phase === 'flying') {
      if (this.phaseTime > 1.65) {
        this.emit('splash');
        this.setPhase('retrieve');
        this.lastJerkTime = 0;
      }
    } else if (this.phase === 'retrieve') {
      this.jerkAge += dt;
      this.jerkCooldown = Math.max(0, this.jerkCooldown - dt);
      if (this.holding) {
        this.activeRetrieveTime += dt;
        this.distance -= [.55, .85, 1.55][this.gear] * dt;
        this.attack += [.65, 1.7, -.7][this.gear] * dt;
        this.swim = this.jerkAge < .45 ? '侧闪 · 窜游' : ['慢摆', '稳定摆尾', '急速游动'][this.gear];
      } else {
        this.pauseAge += dt;
        this.swim = this.jerkAge < 1.8 ? '悬停 · 回摆' : '自然悬浮';
        if (!this.pauseRewarded && this.jerkAge < 2 && this.pauseAge >= .45) {
          this.attack += 13;
          this.pauseRewarded = true;
          this.comboCount++;
          this.emit('combo', { count: this.comboCount });
        }
        if (this.pauseAge > 2.5) this.attack -= 1.3 * dt;
      }
      this.attack = clamp(this.attack, 0, this.attackCap);
      // A full pursuit requires both rhythm and a sufficiently accurate cast.
      if (this.attack >= 82 && this.comboCount >= 2 && this.distance > 3) {
        this.holding = false;
        this.tension = 39;
        this.cycleTime = 0;
        this.setPhase('fight');
        this.emit('bite');
      } else if (this.distance <= 2) this.fail('empty');
      else if (this.phaseTime > 110) this.fail('uninterested');
    } else if (this.phase === 'fight') {
      this.cycleTime += dt;
      const cycle = this.cycleTime % 7.8;
      const wasRushing = this.rushing;
      const wasWarning = this.warning;
      this.warning = cycle >= 4.6 && cycle < 5.6;
      this.rushing = cycle >= 5.6 && cycle < 7.5;
      if (this.warning && !wasWarning) this.emit('warning');
      if (this.rushing && !wasRushing) this.emit('rush');
      if (this.holding) {
        this.tension += (this.rushing ? 39 : [4.8, 8.5, 15.5][this.gear]) * dt;
        if (!this.rushing) {
          const strength = this.stamina > 60 ? .9 : 1.15;
          this.distance -= [1.1, 1.7, 2.5][this.gear] * strength * dt;
          this.stamina = Math.max(0, this.stamina - 2.8 * dt);
        } else this.distance += 1.0 * dt;
      } else {
        this.tension += (this.rushing ? 1.5 : -17) * dt;
        if (this.rushing) { this.distance += 1.45 * dt; this.stamina = Math.max(0, this.stamina - 4 * dt); }
      }
      this.tension = clamp(this.tension, 0, 110);
      this.slackTime = this.tension < 12 ? this.slackTime + dt : Math.max(0, this.slackTime - dt * 2);
      this.overTime = this.tension > 96 ? this.overTime + dt : Math.max(0, this.overTime - dt * 3);
      if (this.overTime > .45) this.fail('line');
      else if (this.slackTime > 2.4) this.fail('hook');
      else if (this.distance <= 1.8) {
        this.holding = false;
        this.fishWeight = +(1.1 + this.quality * .7 + this.random() * .6).toFixed(2);
        this.fishLength = Math.round(44 + this.fishWeight * 9);
        this.setPhase('caught');
        this.emit('caught', { weight: this.fishWeight, length: this.fishLength });
      }
    }
  }
}
