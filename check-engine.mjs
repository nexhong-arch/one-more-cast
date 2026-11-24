import assert from 'node:assert/strict';
import { FishingGame } from './docs/engine.mjs';

function advance(game,seconds,control){
  for(let t=0;t<seconds;t+=1/60){control?.(game,t);game.update(1/60);}
}
function cast(game,seconds=1.6){game.press();advance(game,seconds);game.release();advance(game,1.8);}
function entice(game){
  let lastJerk=-2.5,until=0;
  advance(game,35,(g,t)=>{
    if(g.phase!=='retrieve')return;
    if(t-lastJerk>=2.6){g.jerk();lastJerk=t;until=t+.6;g.release();}
    else if(t>until)g.press();
    else g.release();
  });
}
function bite(){const g=new FishingGame(()=>{},()=>.5);cast(g);assert(g.quality>.9);assert.equal(g.phase,'retrieve');entice(g);return g;}

// The player's core loop must work from actual input, with no forced phase changes.
const success=new FishingGame(()=>{},()=>.5);
cast(success);
let jerkAt=-2.6,pauseUntil=0;
advance(success,90,(g,t)=>{
  if(g.phase==='retrieve'){
    if(t-jerkAt>=2.6){g.jerk();jerkAt=t;pauseUntil=t+.6;g.release();}
    else if(t>pauseUntil)g.press();else g.release();
  }else if(g.phase==='fight'){
    if(g.warning||g.rushing||g.tension>65)g.release();else if(g.tension<45)g.press();
  }
});
assert.equal(success.phase,'caught');assert(success.comboCount>=2);assert(success.fishWeight>0);

// Bad casts cap interest below the bite threshold, even with repeated valid rhythm.
const bad=new FishingGame();cast(bad,.25);entice(bad);
assert(bad.attackCap<82);assert.notEqual(bad.phase,'fight');assert.notEqual(bad.phase,'caught');

// Drive a good cast through retrieve to bite, stopping immediately on transition.
function fishOn(){const g=new FishingGame();cast(g);let last=-2.6,stop=0;
  for(let t=0;t<35&&g.phase==='retrieve';t+=1/60){
    if(t-last>=2.6){g.jerk();g.release();last=t;stop=t+.6;}else if(t>stop)g.press();else g.release();g.update(1/60);
  }assert.equal(g.phase,'fight');return g;
}
const broken=fishOn();broken.press();advance(broken,12);assert.equal(broken.lostReason,'line');
const escaped=fishOn();escaped.release();advance(escaped,12);assert.equal(escaped.lostReason,'hook');
const warnings=[];const surge=fishOn();surge.onEvent=e=>warnings.push(e.type);
advance(surge,8,g=>{if(g.warning||g.rushing||g.tension>65)g.release();else if(g.tension<45)g.press();});
assert(warnings.indexOf('warning')>=0);assert(warnings.indexOf('rush')>warnings.indexOf('warning'));
surge.reset();assert.equal(surge.phase,'cast');assert.equal(surge.holding,false);
console.log(JSON.stringify({coreLoop:'caught',weight:success.fishWeight,comboCount:success.comboCount,poorCastCap:bad.attackCap,overTension:broken.lostReason,slackLine:escaped.lostReason,rushWarning:'passed',reset:'passed'},null,2));
