import { FishingGame, clamp } from './engine.mjs';

const $ = id => document.getElementById(id);
const ctx = $('world').getContext('2d');
ctx.imageSmoothingEnabled = false;
const W = 960, H = 540;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const images = {};
let inGame = false, paused = false, catches = 0, activePlayer = '旅人', profile = null;
let soundEnabled = false, audioContext, ambientNodes = [], frameTime = 0, renderTime = 0;
let resultScheduled = false, showingResult = false, assetsReady = false, splashAt = -99, feedbackTimer;
let activeDialogPaused = false;
const storageKey = 'one-more-cast-profile-v1';
try { profile = JSON.parse(localStorage.getItem(storageKey) || 'null'); } catch {}
if (!profile || typeof profile.name !== 'string') profile = null;

const game = new FishingGame(onGameEvent);
const phaseNames = {cast:'cast',flying:'cast',retrieve:'retrieve',fight:'fight',caught:'fight',failed:'fight'};
const setText = (id, value) => { if ($(id).textContent !== value) $(id).textContent = value; };

const assetPromise = Promise.all(['lake','underwater','culter'].map(name => new Promise((resolve, reject) => {
  const img = new Image();
  img.onload = () => { images[name] = img; resolve(); };
  img.onerror = reject;
  img.src = `assets/${name}.png`;
}))).then(() => {
  assetsReady = true;
  $('play').disabled = false;
  $('play').textContent = '直接试玩';
}).catch(() => {
  $('play').disabled = false;
  $('play').textContent = '场景加载失败 · 点击重试';
});

function audio() {
  if (!audioContext) audioContext = new (window.AudioContext || window.webkitAudioContext)();
  if (audioContext.state === 'suspended') audioContext.resume();
  return audioContext;
}
function tone(freq, duration = .12, type = 'triangle', volume = .04, target) {
  if (!soundEnabled) return;
  const a = audio(), o = a.createOscillator(), g = a.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, a.currentTime);
  if (target) o.frequency.exponentialRampToValueAtTime(target, a.currentTime + duration);
  g.gain.setValueAtTime(volume, a.currentTime);
  g.gain.exponentialRampToValueAtTime(.001, a.currentTime + duration);
  o.connect(g).connect(a.destination); o.start(); o.stop(a.currentTime + duration);
}
function startAmbience() {
  stopAmbience();
  if (!soundEnabled || !inGame) return;
  const a = audio();
  [130.81,196,261.63].forEach((frequency, i) => {
    const o = a.createOscillator(), g = a.createGain();
    o.type = 'sine'; o.frequency.value = frequency;
    g.gain.value = .008 / (i + 1); o.connect(g).connect(a.destination); o.start();
    ambientNodes.push(o, g);
  });
}
function stopAmbience() { ambientNodes.forEach(n => { if (n.stop) n.stop(); n.disconnect(); }); ambientNodes = []; }

function storeProfile() {
  if (!profile || activePlayer !== profile.name) return;
  try { localStorage.setItem(storageKey, JSON.stringify(profile)); } catch {}
}
function openProfile(mode) {
  $('profile-error').textContent = '';
  const existing = mode === 'login' && profile;
  $('profile-title').textContent = existing ? `欢迎回来，${profile.name}` : mode === 'login' ? '先认识一下这位钓手' : '成为湖畔的新钓手';
  $('profile-copy').textContent = existing ? `这片湖记得你：已钓获 ${profile.catches || 0} 尾，最大 ${profile.best || 0} kg。` : '取个名字，记住你在这片湖的收获。';
  $('nickname').value = existing ? profile.name : '';
  $('nickname').readOnly = !!existing;
  $('profile-submit').textContent = existing ? '继续我的钓鱼时光' : '建立存档，去湖边';
  $('profile-dialog').showModal();
}
$('login').onclick = () => openProfile('login');
$('register').onclick = () => openProfile('register');
$('profile-form').onsubmit = async e => {
  e.preventDefault();
  const name = $('nickname').value.trim();
  if (!name) { $('profile-error').textContent = '给这位钓手取个名字吧。'; return; }
  if (!profile || profile.name !== name) profile = { name, catches:0, best:0 };
  activePlayer = name; storeProfile();
  $('profile-dialog').close();
  await startGame(name);
};
$('play').onclick = () => { if (!assetsReady) { location.reload(); return; } startGame('旅人'); };

async function startGame(name) {
  await assetPromise;
  if (!assetsReady) return;
  activePlayer = name;
  inGame = true; paused = false; catches = 0;
  $('title-screen').hidden = true;
  $('game-screen').hidden = false;
  setText('player-name', name); setText('catch-count', '0');
  restart(); startAmbience();
}
function goHome() {
  inGame = false; holdSources.clear(); game.cancelInput(); stopAmbience();
  document.querySelectorAll('dialog[open]').forEach(d => d.close());
  $('game-screen').hidden = true; $('title-screen').hidden = false;
  $('play').focus();
}
function restart() {
  holdSources.clear();
  game.reset(); resultScheduled = false; showingResult = false;
  $('result-dialog').close();
  paused = false; $('paused-shade').hidden = true; setText('pause','暂停');
  $('scene').classList.remove('is-underwater');
  splashAt = -99;
  feedback(''); updateInterface();
}
function setPaused(next) {
  if (!inGame || showingResult) return;
  if (next) { holdSources.clear(); game.cancelInput(); }
  paused = next;
  $('paused-shade').hidden = !paused;
  setText('pause', paused ? '继续' : '暂停');
  $('pause').setAttribute('aria-label',paused ? '继续游戏' : '暂停游戏');
  if (paused) stopAmbience(); else startAmbience();
}
function showHelp() {
  activeDialogPaused = paused;
  game.cancelInput(); paused = true;
  $('help-dialog').showModal();
}
$('help-dialog').addEventListener('close', () => { paused = activeDialogPaused; });
document.querySelectorAll('[data-close]').forEach(b => b.onclick = () => $(b.dataset.close).close());
$('home').onclick = goHome;
$('result-home').onclick = goHome;
$('help').onclick = showHelp;
$('pause').onclick = () => setPaused(!paused);
$('resume').onclick = () => setPaused(false);
$('reset').onclick = restart;
$('again').onclick = restart;
$('sound').onclick = () => {
  soundEnabled = !soundEnabled;
  $('sound').setAttribute('aria-pressed', String(soundEnabled));
  $('sound').setAttribute('aria-label',soundEnabled ? '关闭声音' : '开启声音');
  setText('sound',soundEnabled ? '声音 开' : '声音 关');
  if (soundEnabled) { tone(523,.16); startAmbience(); } else stopAmbience();
};

function setGear(gear) {
  game.setGear(gear);
  document.querySelectorAll('[data-gear]').forEach(b => b.setAttribute('aria-pressed',String(+b.dataset.gear===gear)));
}
document.querySelectorAll('[data-gear]').forEach(b => b.onclick = () => setGear(+b.dataset.gear));
const playable = () => inGame && !paused && !document.querySelector('dialog[open]');
const holdSources = new Set();
function hold(source) { if (!playable()) return; holdSources.add(source); game.press(); }
function release(source) { holdSources.delete(source); if (!holdSources.size) game.release(); }
$('main-action').addEventListener('pointerdown', e => {
  if (e.button !== 0) return;
  e.preventDefault(); $('main-action').setPointerCapture(e.pointerId); hold('pointer');
});
$('main-action').addEventListener('pointerup', e => { e.preventDefault(); release('pointer'); });
$('main-action').addEventListener('pointercancel', () => { holdSources.delete('pointer'); game.cancelInput(); });
$('main-action').addEventListener('lostpointercapture', () => { if (holdSources.has('pointer')) release('pointer'); });
$('main-action').addEventListener('contextmenu', e => e.preventDefault());
$('jerk').onclick = () => { if (playable()) game.jerk(); };
document.addEventListener('keydown', e => {
  if (['INPUT','TEXTAREA'].includes(e.target.tagName)) return;
  if (e.code === 'Escape' && inGame && !document.querySelector('dialog[open]')) { e.preventDefault(); setPaused(!paused); return; }
  if (!playable()) return;
  if (['Space','ArrowUp','KeyJ','KeyR','Digit1','Digit2','Digit3'].includes(e.code)) e.preventDefault();
  if (e.repeat) return;
  if (e.code === 'Space') hold('keyboard');
  else if (e.code === 'KeyJ' || e.code === 'ArrowUp') game.jerk();
  else if (e.code === 'KeyR') restart();
  else if (/^Digit[123]$/.test(e.code)) setGear(+e.code.slice(-1)-1);
});
document.addEventListener('keyup', e => { if (e.code === 'Space') { e.preventDefault(); release('keyboard'); } });
function cancelAndPause() { holdSources.clear(); game.cancelInput(); if (inGame && !showingResult && !document.querySelector('dialog[open]')) setPaused(true); }
window.addEventListener('blur',cancelAndPause);
document.addEventListener('visibilitychange', () => { if (document.hidden) cancelAndPause(); });

function feedback(message) {
  clearTimeout(feedbackTimer);
  const el = $('floating-feedback');
  el.classList.remove('show'); el.textContent = message;
  if (message) { void el.offsetWidth; el.classList.add('show'); feedbackTimer = setTimeout(()=>el.classList.remove('show'),1400); }
}
function onGameEvent(event) {
  if (event.type === 'phase') {
    $('scene').classList.toggle('is-underwater',!['cast','flying'].includes(event.phase));
  } else if (event.type === 'cast') {
    tone(240,.35,'triangle',.035,800);
  } else if (event.type === 'splash') {
    splashAt = renderTime;
    tone(300,.2,'sine',.07,70);
    feedback(game.quality > .85 ? '漂亮的落点' : game.quality > .63 ? '落入标点附近' : '偏离标点');
  } else if (event.type === 'jerk') {
    tone(400,.08,'triangle',.025,700);
  } else if (event.type === 'combo') {
    feedback('抽停 · 有效诱鱼');
    tone(659,.12,'sine',.035); setTimeout(()=>tone(880,.15,'sine',.025),100);
  } else if (event.type === 'bite') {
    holdSources.clear(); feedback('中 鱼 了 ！');
    tone(180,.35,'square',.035,720);
  } else if (event.type === 'warning') {
    tone(392,.18,'square',.025); setTimeout(()=>tone(392,.18,'square',.025),250);
  } else if (event.type === 'caught') {
    catches++; setText('catch-count',String(catches));
    if (profile && profile.name === activePlayer) {
      profile.catches = (profile.catches || 0)+1;
      profile.best = Math.max(profile.best || 0,event.weight); storeProfile();
    }
    [523,659,784,1047].forEach((f,i)=>setTimeout(()=>tone(f,.3,'triangle',.04),i*110));
    showResult(true);
  } else if (event.type === 'lost') {
    tone(260,.45,'triangle',.04,100); showResult(false);
  }
}
function showResult(won) {
  if (resultScheduled) return;
  resultScheduled = true;
  const failedText = {
    line:['线，断了。','张力持续过高。鱼准备冲刺时松手放线，平稳下来再收。'],
    hook:['它脱钩了。','线松了太久。张力降到安全区后及时收线，保持与鱼的联系。'],
    empty:['米诺回来了。','这一趟没有开口。把落点放在桥墩旁，再试试「匀收—抽竿—停半秒」。'],
    uninterested:['鱼的兴趣淡了。','更准的落点能提高攻击欲上限；收线与抽停要有节奏。'],
  };
  $('result-fish').hidden = !won; $('result-species').hidden = !won;
  $('result-stats').hidden = !won;
  setText('result-kicker',won ? '暮色湖的第一份回应' : '每一竿，都在熟悉这片湖');
  setText('result-title',won ? '漂亮，上鱼了！' : failedText[game.lostReason][0]);
  setText('result-copy',won ? `抛投精度 ${Math.round(game.quality*100)}% · 有效抽停 ${game.comboCount} 次。轻轻放流，再见。` : failedText[game.lostReason][1]);
  $('result-stats').innerHTML = won ? `<span>${game.fishWeight.toFixed(2)} kg<small>重量</small></span><span>${game.fishLength} cm<small>体长</small></span>` : '';
  setTimeout(() => {
    if (!resultScheduled || !inGame) return;
    showingResult = true; $('result-dialog').showModal(); $('again').focus();
  },650);
}
$('result-dialog').addEventListener('cancel',e=>e.preventDefault());

function updateInterface() {
  const phase = game.phase;
  const cast = phase === 'cast' || phase === 'flying';
  const retrieve = phase === 'retrieve';
  const fight = phase === 'fight' || phase === 'caught' || phase === 'failed';
  document.querySelectorAll('[data-phase]').forEach(el => el.classList.toggle('active',el.dataset.phase===phaseNames[phase]));
  $('main-action').disabled = !['cast','retrieve','fight'].includes(phase);
  $('main-action').classList.toggle('is-held',game.holding);
  $('jerk').disabled = !retrieve || game.jerkCooldown > 0;
  document.querySelectorAll('[data-gear]').forEach(b=>b.disabled=cast);
  $('power-zone').hidden = !cast && !fight;
  $('accuracy-zone').hidden = !cast;
  $('accuracy-needle').hidden = !cast;
  $('secondary-fill').hidden = cast;
  $('primary-fill').style.width = `${cast ? game.power*100 : retrieve ? game.attack : Math.min(100,game.tension)}%`;
  $('primary-fill').style.background = fight ? game.tension > 78 ? '#ed9475' : game.tension < 15 ? '#87aaba' : '#9ccea3' : retrieve ? '#b5d298' : '#efc67a';
  $('power-zone').style.left = fight ? '22%' : '61%';
  $('power-zone').style.width = fight ? '48%' : '12%';
  $('accuracy-needle').style.left = `${50+game.accuracy*47}%`;
  $('secondary-fill').style.width = `${retrieve ? (game.jerkCooldown>0 ? (1-game.jerkCooldown/.7)*100 : 100) : Math.max(0,100-game.distance/Math.max(12,game.castDistance)*100)}%`;
  $('secondary-fill').style.background = '#8abca0';
  setText('main-label', cast ? phase==='flying' ? '拟饵飞行中' : game.holding ? '松手出竿' : '按住蓄力' : game.holding ? '正在收线' : '按住收线');
  setText('distance-caption', cast ? '标点距离 36.0 m' : `距岸 ${Math.max(0,game.distance).toFixed(1)} m`);
  let message='',coach='';
  $('scene-message').classList.remove('danger','success');
  if (cast) {
    setText('primary-label','抛投蓄力');setText('primary-value',game.holding ? `${Math.round(game.power*100)}%` : phase==='flying' ? `${Math.round(game.castPower*100)}%` : '按住蓄力');
    setText('primary-note','金色区间：约 2/3 力度');
    setText('secondary-label','落点精度');setText('secondary-value',Math.abs(game.accuracy)<.17?'正中':game.accuracy<0?'偏左':'偏右');
    setText('secondary-note','指针越靠中间，落点越稳');
    setText('scene-mode','落日时分');setText('scene-target','桥墩标点 · 36 m');
    message = phase==='flying' ? `出竿 · ${game.castDistance.toFixed(1)} m` : game.holding ? '盯住力度，也盯住时机。' : '把第一竿，抛向桥墩旁。';
    coach='按住空格或「按住蓄力」，力度约 2/3、指针居中时松手。';
  } else if (retrieve) {
    setText('primary-label','翘嘴攻击欲');setText('primary-value',`${Math.round(game.attack)}%`);
    setText('primary-note',`落点精度 ${Math.round(game.quality*100)}% · 攻击欲上限 ${Math.round(game.attackCap)}%`);
    setText('secondary-label','米诺泳姿');setText('secondary-value',game.swim);
    setText('secondary-note',`有效抽停 ${game.comboCount} 次 · ${game.jerkCooldown>0?'回摆中':'可以抽竿'}`);
    setText('scene-mode','水下视角');setText('scene-target','目标鱼 · 翘嘴');
    message=game.attack>67?'它盯上米诺了。':game.jerkAge<1&&!game.pauseRewarded?'抽竿后，松手停半秒。':game.comboCount?'保持节奏，它正在靠近。':'匀收、抽竿，停半秒。';
    coach=game.attackCap<82?'落点偏远，翘嘴不容易开口。可以收完这一竿，也可以按 R 重新找标点。':game.jerkAge<1.7&&!game.pauseRewarded?'现在松开空格，停顿半秒，让米诺悬停回摆。':'匀速按住收线，每 2～3 秒按 J 抽竿，再松手停半秒；重复这个节奏。';
  } else {
    setText('primary-label','线组张力');setText('primary-value',`${Math.round(game.tension)}%`);
    setText('primary-note',game.tension<12?`过松 ${game.slackTime.toFixed(1)}s · 及时收线`:'绿色区域内交替收线、放线');
    setText('secondary-label','距岸距离');setText('secondary-value',`${Math.max(0,game.distance).toFixed(1)} m`);
    setText('secondary-note',`鱼的体力 ${Math.round(game.stamina)}% · 拉近到 1.8 m 起鱼`);
    setText('scene-mode','搏鱼时刻');setText('scene-target','稳住，别硬拉');
    if (game.warning) { message='准备冲刺 · 现在松手！';coach='翘嘴蓄力了：松开空格放线，等冲刺结束再收。';$('scene-message').classList.add('danger'); }
    else if (game.rushing) { message='鱼在冲刺 · 保持放线';coach='让它跑一小段，消耗体力。冲刺时强收会迅速拉高张力。';$('scene-message').classList.add('danger'); }
    else if (game.tension>76) { message='张力偏高 · 松手缓一缓';coach='张力降到绿色区域后再收，别把线绷断。';$('scene-message').classList.add('danger'); }
    else if (game.tension<15) { message='线太松了 · 收线！';coach='按住空格收线；线松太久，鱼会脱钩。'; }
    else { message='稳住张力，慢慢拉近。';coach='按住收线，张力升高就松手；看到冲刺预警，立刻放线。'; }
    if (phase==='caught') { message='漂亮，上鱼了！';$('scene-message').classList.add('success'); }
    if (phase==='failed') message='下一竿，会更好。';
  }
  setText('scene-message',message); setText('coach',coach);
}

// Scene animation uses original high-detail assets; canvas adds only live fishing action.
function line(points,color='#f8e7b8',width=1) {
  ctx.strokeStyle=color;ctx.lineWidth=width;ctx.beginPath();
  points.forEach((p,i)=>i?ctx.lineTo(Math.round(p[0]),Math.round(p[1])):ctx.moveTo(Math.round(p[0]),Math.round(p[1])));ctx.stroke();
}
function lure(x,y,angle=0) {
  ctx.save();ctx.translate(Math.round(x),Math.round(y));ctx.rotate(angle);
  ctx.fillStyle='#113a45';ctx.fillRect(-17,-5,34,9);ctx.fillRect(-20,-3,5,5);
  ctx.fillStyle='#f6c268';ctx.fillRect(-13,-4,26,4);ctx.fillStyle='#fff1bb';ctx.fillRect(-12,0,25,3);
  ctx.fillStyle='#ee925a';ctx.fillRect(7,-4,7,5);ctx.fillStyle='#173a46';ctx.fillRect(11,-3,2,2);
  ctx.fillStyle='#46706a';for(let i=-9;i<6;i+=5)ctx.fillRect(i,-3,2,3);
  line([[-7,3],[-7,10],[-3,12],[0,8]],'#b6c5b6',1);
  line([[10,3],[10,9],[14,11],[17,7]],'#b6c5b6',1);
  line([[16,1],[23,4],[20,7]],'#c2ddd1',1);
  ctx.restore();
}
function drawFish(x,y,width,flip=false,intensity=1,alpha=1) {
  const img=images.culter;if(!img)return;
  const h=width*img.height/img.width;
  ctx.save();ctx.globalAlpha=alpha;ctx.translate(Math.round(x),Math.round(y));if(flip)ctx.scale(-1,1);
  const strips=20,sw=img.width/strips;
  for(let i=0;i<strips;i++){
    const wave=reducedMotion?0:Math.sin(renderTime*4.7-i*.42)*Math.pow(i/strips,2)*3.5*intensity;
    ctx.drawImage(img,i*sw,0,sw,img.height,-width/2+i*width/strips,-h/2+Math.round(wave),width/strips+.8,h);
  }
  ctx.restore();
}
function ripple(x,y,age,alpha=1) {
  if(age<0||age>2)return;
  ctx.save();ctx.globalAlpha=(1-age/2)*alpha;ctx.strokeStyle='#ffe3a2';ctx.lineWidth=1.5;
  for(let j=0;j<3;j++){ctx.beginPath();ctx.ellipse(x,y,6+age*23+j*8,2+age*5+j*2,0,0,Math.PI*2);ctx.stroke();}ctx.restore();
}
function draw() {
  ctx.clearRect(0,0,W,H);
  const t=renderTime;
  if(['cast','flying'].includes(game.phase)) {
    // Occasional water glints, kept restrained to preserve the original artwork.
    if(!reducedMotion)for(let i=0;i<26;i++){
      const x=85+(i*83)%790,y=319+(i*31)%174,a=(Math.sin(t*1.2+i*2.1)+1)*.12;
      ctx.fillStyle=`rgba(255,224,153,${a})`;ctx.fillRect(x,y,4+(i%4)*3,1);
    }
    const targetX=360,targetY=369;
    ctx.save();ctx.strokeStyle='#ffe6a7';ctx.lineWidth=2;
    ctx.globalAlpha=.8+(reducedMotion?0:Math.sin(t*2)*.18);
    ctx.beginPath();ctx.ellipse(targetX,targetY,27,8,0,0,Math.PI*2);ctx.stroke();
    line([[targetX,350],[targetX,344]],'#fff0bf',2);
    ctx.font='bold 10px sans-serif';ctx.textAlign='center';ctx.fillStyle='#fff1c5';ctx.shadowColor='#143d42';ctx.shadowBlur=3;
    ctx.fillText('36 m',targetX,336);ctx.restore();
    if(game.phase==='flying'){
      const p=clamp(game.phaseTime/1.15,0,1),ex=780-(game.castDistance/54)*630,ey=369+game.castAccuracy*30;
      const x=686+(ex-686)*p,y=220+(ey-220)*p-Math.sin(p*Math.PI)*190;
      const points=[];for(let i=0;i<=24;i++){const u=i/24;points.push([686+(x-686)*u,220+(y-220)*u+Math.sin(u*Math.PI)*18*p]);}
      line(points,'#fff0bfaa',1);if(p<1)lure(x,y,-.4+p*.6);else ripple(ex,ey,(game.phaseTime-1.15)*2);
    } else if(game.holding){
      const ex=780-(game.power)*630,ey=369+game.accuracy*30;
      ctx.fillStyle='#fff0c477';ctx.fillRect(ex-3,ey-3,6,6);
      line([[ex-9,ey],[ex-5,ey]],'#fff0c4',1);line([[ex+5,ey],[ex+9,ey]],'#fff0c4',1);
    }
  }else{
    // Small particles are live; the lake bed and light shafts remain crisp painted pixels.
    if(!reducedMotion)for(let i=0;i<25;i++){
      const x=175+(i*97)%710+Math.sin(t*.4+i)*4,y=510-((t*6+i*23)%460);
      ctx.fillStyle=`rgba(207,234,201,${.1+(i%3)*.09})`;ctx.fillRect(Math.round(x),Math.round(y),i%4===0?2:1,i%4===0?2:1);
    }
    drawFish(800-((t*4)%560),145+Math.sin(t*.2)*8,38,false,.5,.17);
    drawFish(860-((t*4)%560),170,24,false,.4,.13);
    if(game.phase==='retrieve'){
      const progress=clamp(1-game.distance/Math.max(1,game.castDistance),0,1);
      const jerkLift=Math.max(0,1-game.jerkAge/.65)*22;
      const lx=260+progress*390+Math.sin(t*2)*2+jerkLift*.25;
      const ly=258+(game.holding?Math.sin(t*9)*2:Math.sin(t*2)*3)-jerkLift;
      const fishX=lx+125+(1-game.attack/100)*135;
      const fishY=ly+50*(1-game.attack/100)+Math.sin(t*1.8)*5;
      drawFish(fishX,fishY,210,false,game.holding?1.2:.6);
      const points=[];for(let i=0;i<=25;i++){const u=i/25;points.push([lx+(940-lx)*u,ly+(50-ly)*u+Math.sin(u*Math.PI)*(game.holding?12:50)]);}
      line(points,'#e3e9c78a',1);lure(lx,ly,game.jerkAge<.3?-.22:Math.sin(t*6)*.04);
      if(game.attack>64){ctx.fillStyle='#ffe6a0';ctx.fillRect(fishX-105,fishY-34,3,9);ctx.fillRect(fishX-105,fishY-22,3,3);}
    }else{
      const progress=clamp(1-game.distance/Math.max(1,game.castDistance),0,1);
      const fx=375+progress*320+Math.sin(t*(game.rushing?7:1.8))*(game.rushing?17:7);
      const fy=265+Math.sin(t*(game.rushing?6:1.5))*(game.rushing?19:9);
      const fw=255,headX=fx+fw*.46;
      const points=[];for(let i=0;i<=25;i++){const u=i/25;points.push([headX+(955-headX)*u,fy-10+(38-(fy-10))*u+Math.sin(u*Math.PI)*Math.max(1,50-game.tension*.5)]);}
      if(game.lostReason!=='line')line(points,game.tension>78?'#ffd38f':'#f8eec6c7',game.rushing?2:1);
      drawFish(fx,fy,fw,true,game.rushing?3:1.2,game.phase==='failed'?.65:1);
      if(game.phase!=='failed')lure(headX-8,fy-8,-.18);
      if(game.rushing&&!reducedMotion){for(let i=0;i<8;i++){const x=fx-135-i*9,y=fy+(i%3-1)*16;ctx.fillStyle='#b4d7b575';ctx.fillRect(x,y,7+i%3*3,1);}}
    }
    ripple(300,85,t-splashAt,.5);
  }
}

function loop(timestamp) {
  const dt=Math.min(.05,Math.max(0,(timestamp-frameTime)/1000));frameTime=timestamp;
  if(inGame && !paused && !showingResult){renderTime+=dt;game.update(dt);updateInterface();draw();}
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
