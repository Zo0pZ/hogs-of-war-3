import * as NET from './net.js';
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { SSAOPass } from 'three/examples/jsm/postprocessing/SSAOPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

/* ================= DATA ================= */
const NATIONS=[
 {id:'US',name:'United States',team:'Task Force Bacon',helm:0x5a6152,flag:['#31456e','#e8e0c8','#b7332c'],names:['Hank','Buck','Tex','Cole','Duke','Rhino','Ace','Gunner'],perk:'Combined arms doctrine: air support arrives faster and hits harder.',taunt:'Overwatch has you painted, hostile.'},
 {id:'UK',name:'United Kingdom',team:'Royal Swine Guards',helm:0x4c5a45,flag:['#b7332c','#e8e0c8','#31456e'],names:['Nigel','Alfie','Reg','Monty','Percy','Bertie','Clive','Winston'],perk:'Best marksmanship training in NATO: designated marksmen never miss twice.',taunt:'Rather bad luck, that. Do try again.'},
 {id:'RU',name:'Russian Federation',team:'Ironsnout Brigade',helm:0x5c5a3e,flag:['#e8e0c8','#31456e','#b7332c'],names:['Boris','Ivan','Dmitri','Sergei','Yuri','Nikolai','Vlad','Igor'],perk:'Massed rocket artillery: HIMARS salvos carry an extra rocket.',taunt:'You brought drones. We brought everything else.'},
 {id:'CN',name:'China',team:'Jade Tusk Company',helm:0x4a5340,flag:['#b7332c','#d8a63c','#b7332c'],names:['Wei','Jian','Feng','Hao','Lei','Chen','Bo','Kai'],perk:'Drone swarm doctrine: reconnaissance drones loiter twice as long.',taunt:'Your position was uploaded some time ago.'},
 {id:'FR',name:'France',team:'Legion Sanglier',helm:0x455063,flag:['#31456e','#e8e0c8','#b7332c'],names:['Pierre','Marcel','Henri','Gaston','Luc','Antoine','Remy','Hugo'],perk:'Rapid reaction force: every trooper moves faster across open ground.',taunt:'You are outmanoeuvred. Again.'},
 {id:'DE',name:'Germany',team:'Panzerschwein Korps',helm:0x50554c,flag:['#2b2b2b','#b7332c','#d8a63c'],names:['Hans','Klaus','Dieter','Lukas','Jonas','Stefan','Max','Felix'],perk:'Engineering excellence: armour is tougher and sappers carry extra charges.',taunt:'Your equipment is, how you say, obsolete.'},
];
const CLASSES=[
 {id:'Assault',blurb:'+25% explosive damage; breaches hard targets', officer:'Fire Support Officer — calls in HIMARS'},
 {id:'Medic',blurb:'Self-regenerating; trauma kits heal the squad', officer:'Combat Surgeon — stabilises the whole section'},
 {id:'Recon',blurb:'Deadeye marksman; immune to mines and IEDs', officer:'Pathfinder — HALO insertion anywhere'},
 {id:'Engineer',blurb:'Extra charges; blast-hardened; crews vehicles', officer:'Sapper Chief — deploys hard cover'},
];
const RANKS=['Recruit','Private','Corporal','Sergeant','Lieutenant','Colonel'];

/* ================= SWILL ECONOMY & UPGRADES =================
   Coins ("swill marks") are earned in battle and spent in the Armoury between
   regions. Hogs and weapons each carry an upgrade level of 0..3. */
const MAX_TIER=3;
const HOG_UP_COST=[140,320,620];
const WPN_UP_COST=[110,260,520];
const HOG_TIERS=[
  {name:'Flak Jacket',   blurb:'+20 max health, +10% pace'},
  {name:'Steel Plating', blurb:'+40 max health, +20% pace'},
  {name:'Iron Trotters', blurb:'+60 max health, +30% pace, +15% blast resistance'},
];
const WPN_TIERS=[
  {name:'Honed',    blurb:'+15% damage, +8% blast, +1 ammo'},
  {name:'Improved', blurb:'+30% damage, +16% blast, +2 ammo'},
  {name:'Perfected',blurb:'+45% damage, +24% blast, +3 ammo'},
];
const BOUNTY={kill:60, dmgPer:3, victory:150, survivor:40};
/* Special Forces: an expensive one-off promotion. The hog keeps its class but
   gets elite conditioning, a double issue of its class special, and a beret. */
const ELITE_COST=780;
const ELITE_TITLE={Heavy:'Commando',Medic:'Surgeon-Major',Spy:'Shadow Boar',Engineer:'Sapper Marine'};
const ELITE_PERK={
  Heavy:'+30 health, twice the Sowzookas, blast-hardened',
  Medic:'+30 health, twice the Field Hospitals, heals on the move',
  Spy:'+30 health, twice the Teleports, silent approach',
  Engineer:'+30 health, twice the Girders, wades deep water',
};
const CLASS_SPECIAL={Assault:'sowzooka',Medic:'hospital',Recon:'tele',Engineer:'girder'};
function hogSpeedMul(up){ return 1+0.10*(up||0); }
function hogArmour(up){ return (up||0)>=3?0.85:1; }        // tier 3 shrugs off blasts
function wLevel(id){ return (campaign&&campaign.wUp&&campaign.wUp[id])||0; }
/* Return a weapon with the player's purchased upgrades folded in. Only the
   player's squad in a campaign benefits — skirmish and the AI use base stats. */
function effW(w,team,isCamp){
  if(!isCamp) return w;
  // team 1's level is set per battle from campaign progress; team 0 buys its own
  const L=team===0?wLevel(w.id):((B&&B.cfg&&B.cfg.foeW)||0);
  if(!L) return w;
  const o={...w};
  if(o.dmg)  o.dmg =Math.round(o.dmg*(1+0.15*L));
  if(o.r)    o.r   =o.r*(1+0.08*L);
  if(o.heal) o.heal=Math.round(o.heal*(1+0.15*L));
  return o;
}
/* AI difficulty: errMul scales aim jitter, elStep coarsens the trajectory search,
   sniperChance gates the line-of-sight sniper opportunism */
const DIFFS={
  easy:  {label:'Easy',   errMul:3.2,  elStep:0.20, sniperChance:0.10},
  normal:{label:'Normal', errMul:1.0,  elStep:0.10, sniperChance:0.40},
  hard:  {label:'Hard',   errMul:0.35, elStep:0.06, sniperChance:0.65},
};
let difficulty='normal';
try{ difficulty=DIFFS[localStorage.getItem('hogs2diff')]?localStorage.getItem('hogs2diff'):'normal'; }catch(e){}
function setDifficulty(d){
  difficulty=DIFFS[d]?d:'normal';
  try{ localStorage.setItem('hogs2diff',difficulty); }catch(e){}
  document.querySelectorAll('#diffRow .diffbtn').forEach(b=>
    b.classList.toggle('sel',b.dataset.diff===difficulty));
}
const WEAPONS=[
 {id:'rifle',  name:'Carbine',   key:'1', ammo:Infinity, kind:'ray', range:120, dmg:16},
 {id:'bazooka',name:'AT Rocket', key:'2', ammo:Infinity, kind:'shell', r:7, dmg:45, wind:true},
 {id:'grenade',name:'Frag',      key:'3', ammo:4, kind:'bounce', fuse:3, r:6.4, dmg:40},
 {id:'cluster',name:'Cluster',   key:'4', ammo:2, kind:'bounce', fuse:3, r:5, dmg:30, cluster:true},
 {id:'mg',     name:'LMG',       key:'5', ammo:3, kind:'burst', range:90, dmg:9, shots:8, spread:0.045},
 {id:'flame',  name:'Thermobaric',key:'6', ammo:2, kind:'flame', range:26, dmg:7, ticks:16, cone:0.30},
 {id:'sniper', name:'DMR',       key:'7', ammo:2, kind:'ray', range:400, dmg:55},
 {id:'mine',   name:'Claymore',  key:'8', ammo:3, kind:'minetoss', r:6.6, dmg:45},
 {id:'medikit',name:'Trauma Kit',key:'9', ammo:2, kind:'heal', heal:35},
 {id:'arty',   name:'HIMARS',    key:'0', ammo:1, kind:'howitzer', shells:3, r:11, dmg:58, wind:true, spread:0.045},
 // Stealth bomber sits last: selecting it swings the camera to the targeting pod
 {id:'strike', name:'Stealth Bomber', key:'-', ammo:1, kind:'strike', bombs:5, r:6.2, dmg:36},
 // ---- class specials: only the matching operator carries these ----
 {id:'sowzooka',name:'Javelin',  key:'=', ammo:1, kind:'shell', r:16, dmg:78, wind:true, classOnly:'Assault'},
 {id:'hospital',name:'Casevac',  key:'=', ammo:1, kind:'squadheal', heal:40, classOnly:'Medic'},
 {id:'tele',    name:'HALO Drop', key:'=', ammo:2, kind:'tele', classOnly:'Recon'},
 {id:'girder',  name:'Barrier',  key:'=', ammo:3, kind:'build', classOnly:'Engineer'},
 // ---- vehicle & emplacement weapons ----
 {id:'tankgun', name:'120mm Smoothbore', key:'1', ammo:Infinity, kind:'shell', r:13, dmg:72, crewOnly:'tank'},
 {id:'empgun',  name:'TOW Launcher',key:'1', ammo:Infinity, kind:'howitzer', shells:2, r:12, dmg:62, wind:true, spread:0.04, crewOnly:'arty'},
 {id:'empmg',   name:'.50 Cal',   key:'1', ammo:Infinity, kind:'burst', range:95, dmg:11, shots:10, spread:0.04, crewOnly:'mg'},
 {id:'boatgun', name:'RHIB Gun',  key:'[', ammo:Infinity, kind:'burst', range:100, dmg:12, shots:8, spread:0.05, crewOnly:'boat'},
 {id:'navalgun',name:'Carrier Strike', key:'1', ammo:3, kind:'howitzer', shells:2, r:19, dmg:98, wind:true, spread:0.03, crewOnly:'ship'},
];
const REGIONS=[
 {island:'Op. Iron Trotter', name:'Landing Zone Alpha', theme:'desert', brief:"Welcome to the sandbox. Hostile forces hold the LZ and they have dug in with everything short of a swimming pool. Secure it before the sun cooks us in our own crackling."},
 {island:'Op. Iron Trotter', name:'Highway of Ham', theme:'desert', brief:"A six-lane road to nowhere, littered with burnt-out vehicles and IEDs. Recon says the enemy is watching every culvert. Recon is usually right."},
 {island:'Op. Iron Trotter', name:'Wadi Bacon', theme:'desert', brief:"A dry riverbed that funnels everything into a killing ground. Use the drones, use the armour, and for pity's sake do not bunch up."},
 {island:'Op. Iron Trotter', name:'FOB Rasher', theme:'desert', brief:"Our forward base, currently hosting rather more hostiles than the guest list allowed. Clear it room by room."},
 {island:'Grid Sector Sow', name:'Grid Square 41', theme:'rock', brief:"Rocky high ground with commanding fields of fire. Whoever holds it dictates the whole valley. Take it, hold it, complain about it later."},
 {island:'Grid Sector Sow', name:'Ridgeline Oscar', theme:'rock', brief:"The enemy is dug into reverse slope positions. Direct fire will not reach them — this is what the HIMARS is for."},
 {island:'Grid Sector Sow', name:'Quarry Kilo', theme:'rock', brief:"A working quarry full of hard cover and unstable ledges. Half the terrain will collapse if you look at it aggressively."},
 {island:'Grid Sector Sow', name:'Checkpoint Trotter', theme:'rock', brief:"A vehicle checkpoint on the only road through. Expect armour, expect ATGMs, expect a very long afternoon."},
 {island:'Littoral Line', name:'Beachhead Bravo', theme:'beach', brief:"Amphibious assault. RHIBs from the carrier, straight onto a defended shoreline. Keep moving off the sand — it is the worst place to have opinions."},
 {island:'Littoral Line', name:'Harbour Hamlet', theme:'beach', brief:"A working port the enemy is using for resupply. Sink what floats, capture what does not."},
 {island:'Littoral Line', name:'Causeway Charlie', theme:'green', brief:"A single raised causeway between two islands, with water either side and no cover worth the name. Somebody in planning is having a laugh."},
 {island:'Littoral Line', name:'Carrier Station', theme:'beach', brief:"Our carrier group is on station offshore. Get a team out to her and that flight deck becomes the biggest gun in the theatre."},
 {island:'Cold Front', name:'Arctic Outpost', theme:'snow', brief:"Minus thirty and falling. The enemy has a listening post here and we would rather they did not. Mind the ice — it does not forgive."},
 {island:'Cold Front', name:'Frozen Airstrip', theme:'snow', brief:"A runway carved out of the permafrost. Deny it to them and their air support problem becomes our air support advantage."},
 {island:'Cold Front', name:'Glacier Pass', theme:'snow', brief:"A narrow pass with avalanche risk on both flanks. Heavy ordnance is inadvisable. Use it anyway, carefully."},
 {island:'Cold Front', name:'Silo Complex', theme:'snow', brief:"Hardened silos, thick concrete, and a garrison that has nowhere else to be. Bring the thermobarics."},
 {island:'Urban Sprawl', name:'District Nine', theme:'dark', brief:"Dense urban terrain. Every window is a firing position and every street is a channel. Fight building to building and trust your drones."},
 {island:'Urban Sprawl', name:'Rooftop Run', theme:'dark', brief:"The rooftops are the high ground here. Get up there before they do — and remember gravity is also a hostile."},
 {island:'Urban Sprawl', name:'Metro Junction', theme:'dark', brief:"Above ground it is a crossroads; below it is a maze. We are only fighting the top half today. Small mercies."},
 {island:'Urban Sprawl', name:'The Green Zone', theme:'dark', brief:"The last secure district, and the enemy wants it badly. Hold the perimeter and make the cost unreasonable."},
 {island:'Op. Final Cut', name:'Airfield Assault', theme:'rock', brief:"Their main airbase. Take the runway and the whole theatre goes quiet overhead. Expect their best troops."},
 {island:'Op. Final Cut', name:'Command Bunker', theme:'dark', brief:"Hardened command and control, buried deep. Crack the surface defences and the rest follows."},
 {island:'Op. Final Cut', name:'Missile Battery', theme:'rock', brief:"Long-range launchers that have been making our lives difficult for weeks. End them."},
 {island:'Op. Final Cut', name:'Bridge Too Far', theme:'green', brief:"One bridge, heavily defended, and no way round. Someone will write a book about this. Try to be in the appendix rather than the casualty list."},
 {island:'Op. Final Cut', name:'Objective Swine', theme:'dark', brief:"This is it. Their last command node and the end of the war. Everything you have learned, all at once. Do not waste the ammunition."},
];
const THEMES={
 beach:{grass:0x9aa04c,dirt:0x8a6f47,sand:0xc2a878,fog:0xd8c49a,sky:0xcfc093,amp:1.0},
 green:{grass:0x6f8a3c,dirt:0x6b4f33,sand:0xa89465,fog:0xcfc49a,sky:0xc4bd8e,amp:1.2},
 rock:{grass:0x8a7f57,dirt:0x6e5a44,sand:0x93815f,fog:0xc9b490,sky:0xbfae86,amp:1.9},
 snow:{grass:0xdfe3e0,dirt:0x9aa0a8,sand:0xc8ccc9,fog:0xdde2de,sky:0xd3d9d6,amp:1.4},
 dark:{grass:0x5c6136,dirt:0x4a3a2a,sand:0x77694c,fog:0xb09c76,sky:0xa39272,amp:1.6},
 // El Hamein Sands: bleached dunes, rocky outcrops, heat-haze sky
 desert:{grass:0xcfb277,dirt:0xa8834e,sand:0xe0cc99,fog:0xe6d3a4,sky:0xdcc894,amp:1.3},
};
const Q={
 turn:["Moving to contact.","Eyes on, weapons free.","This is Overwatch, you're clear.","Copy that, engaging.","Stack up, we're going in.","Say again, last transmission?"],
 hurt:["I'm hit! I'm hit!","Man down, request casevac!","Taking fire, taking fire!","That went straight through the plate!","Contact left! Contact left!","Somebody suppress that!"],
 kill:["Target down.","Splash one, confirmed.","Tango neutralised.","Good effect on target.","That's a hit, Overwatch."],
 death:["Tell them... I did my bit...","Comms going dark...","I regret... the paperwork...","Not like this..."],
 drown:["I can't swim in full plate!","Going under! Going under!","Somebody cut this rig off me!"],
 miss:["Rounds long, adjusting.","Missed, correcting fire.","Negative effect, going again.","Wind took that one."],
 fall:["Ugh, bad landing!","That's my knees gone!"],
 heal:["Patched and back in the fight.","Trauma kit's done its job.","Good to go, Overwatch."],
};
const pick=a=>a[Math.floor(Math.random()*a.length)];
const clamp=(v,a,b)=>v<a?a:v>b?b:v;
const $=id=>document.getElementById(id);

/* ================= VOICE & SFX ================= */
let voiceOn=true, gbVoice=null;
function initVoice(){ try{
  const load=()=>{ const vs=speechSynthesis.getVoices();
    gbVoice=vs.find(v=>/en[-_]GB/i.test(v.lang)&&/male|daniel|arthur|ryan/i.test(v.name))||vs.find(v=>/en[-_]GB/i.test(v.lang))||null; };
  load(); speechSynthesis.onvoiceschanged=load;
}catch(e){} }
function speak(t){ try{
  if(!voiceOn||!window.speechSynthesis) return;
  speechSynthesis.cancel();
  const u=new SpeechSynthesisUtterance(t);
  if(gbVoice) u.voice=gbVoice;
  u.rate=1.05; u.pitch=0.85; u.volume=0.9;
  speechSynthesis.speak(u);
}catch(e){} }
let AC=null, masterGain=null, sfxOn=true;
try{ sfxOn=localStorage.getItem('hogs2sfx')!=='0'; }catch(e){}
function audioCtx(){
  if(!AC){
    AC=new (window.AudioContext||window.webkitAudioContext)();
    masterGain=AC.createGain();
    masterGain.gain.value=sfxOn?0.85:0;
    masterGain.connect(AC.destination);
  }
  return AC;
}
function toggleSfx(){
  sfxOn=!sfxOn;
  if(masterGain) masterGain.gain.value=sfxOn?0.85:0;
  try{ localStorage.setItem('hogs2sfx',sfxOn?'1':'0'); }catch(e){}
  const b=$('sfxbtn'); if(b) b.textContent='Sound: '+(sfxOn?'ON':'OFF');
}
function sfx(kind){ try{
  if(!sfxOn) return;
  audioCtx();
  if(AC.state==='suspended') AC.resume();
  const t=AC.currentTime, g=AC.createGain();
  g.connect(masterGain);
  const env=(v,d)=>{ g.gain.setValueAtTime(v,t); g.gain.exponentialRampToValueAtTime(0.001,t+d); };
  if(kind==='boom'){
    const bufferSize=AC.sampleRate*1.5;
    const buffer=AC.createBuffer(1,bufferSize,AC.sampleRate);
    const data=buffer.getChannelData(0);
    for(let i=0;i<bufferSize;i++) data[i]=Math.random()*2-1;
    const noise=AC.createBufferSource(); noise.buffer=buffer;
    const filter=AC.createBiquadFilter();
    filter.type='lowpass';
    filter.frequency.setValueAtTime(1000,t);
    filter.frequency.exponentialRampToValueAtTime(50,t+1.2);
    g.gain.setValueAtTime(0.9,t);              // was 1.5 — clipped through the master bus
    g.gain.exponentialRampToValueAtTime(0.01,t+1.4);
    noise.connect(filter); filter.connect(g);
    noise.start(t); noise.stop(t+1.5);
  } else if(kind==='mg'){
    // sharp cracking report: filtered noise burst + a click transient
    const n=AC.createBufferSource(), buf=AC.createBuffer(1,AC.sampleRate*0.09,AC.sampleRate);
    const d0=buf.getChannelData(0);
    for(let i=0;i<d0.length;i++) d0[i]=(Math.random()*2-1)*Math.pow(1-i/d0.length,2.2);
    n.buffer=buf;
    const bp=AC.createBiquadFilter(); bp.type='bandpass'; bp.frequency.value=1750; bp.Q.value=0.9;
    g.gain.setValueAtTime(0.5,t); g.gain.exponentialRampToValueAtTime(0.001,t+0.1);
    n.connect(bp); bp.connect(g); n.start(t); n.stop(t+0.1);
  } else if(kind==='flame'){
    // roaring hiss: brown-ish noise through a sweeping lowpass
    const n=AC.createBufferSource(), buf=AC.createBuffer(1,AC.sampleRate*0.5,AC.sampleRate);
    const d0=buf.getChannelData(0); let last=0;
    for(let i=0;i<d0.length;i++){ last=(last+(Math.random()*2-1)*0.35)*0.94; d0[i]=last*2.4; }
    n.buffer=buf;
    const lp=AC.createBiquadFilter(); lp.type='lowpass';
    lp.frequency.setValueAtTime(2600,t); lp.frequency.exponentialRampToValueAtTime(700,t+0.45);
    g.gain.setValueAtTime(0.42,t); g.gain.exponentialRampToValueAtTime(0.001,t+0.5);
    n.connect(lp); lp.connect(g); n.start(t); n.stop(t+0.5);
  } else if(kind==='whistle'){
    // incoming shell: falling sine whistle
    const o=AC.createOscillator(); o.type='sine';
    o.frequency.setValueAtTime(1650,t); o.frequency.exponentialRampToValueAtTime(240,t+1.5);
    g.gain.setValueAtTime(0.001,t);
    g.gain.exponentialRampToValueAtTime(0.3,t+0.35);
    g.gain.exponentialRampToValueAtTime(0.001,t+1.6);
    o.connect(g); o.start(t); o.stop(t+1.65);
  } else if(kind==='plane'){
    // aero engine drone: two detuned saws with a slow throb
    const o1=AC.createOscillator(), o2=AC.createOscillator(), lfo=AC.createOscillator(), lg=AC.createGain();
    o1.type='sawtooth'; o2.type='sawtooth';
    o1.frequency.setValueAtTime(78,t); o2.frequency.setValueAtTime(83,t);
    lfo.frequency.setValueAtTime(7,t); lg.gain.setValueAtTime(9,t);
    lfo.connect(lg); lg.connect(o1.frequency);
    const lp=AC.createBiquadFilter(); lp.type='lowpass'; lp.frequency.value=900;
    g.gain.setValueAtTime(0.001,t);
    g.gain.exponentialRampToValueAtTime(0.22,t+0.6);
    g.gain.setValueAtTime(0.22,t+1.9);
    g.gain.exponentialRampToValueAtTime(0.001,t+3.2);
    o1.connect(lp); o2.connect(lp); lp.connect(g);
    o1.start(t); o2.start(t); lfo.start(t);
    o1.stop(t+3.25); o2.stop(t+3.25); lfo.stop(t+3.25);
  } else {
    const o=AC.createOscillator();
    o.connect(g);                              // g is already on the master bus
    if(kind==='shot'){ o.type='square'; o.frequency.setValueAtTime(700,t); o.frequency.exponentialRampToValueAtTime(160,t+0.08); env(0.18,0.1); o.start(t); o.stop(t+0.1); }
    else if(kind==='beep'){ o.type='sine'; o.frequency.setValueAtTime(1300,t); env(0.14,0.09); o.start(t); o.stop(t+0.09); }
    else if(kind==='splash'){ o.type='sine'; o.frequency.setValueAtTime(300,t); o.frequency.exponentialRampToValueAtTime(60,t+0.3); env(0.25,0.35); o.start(t); o.stop(t+0.35); }
    else if(kind==='launch'){ o.type='sawtooth'; o.frequency.setValueAtTime(180,t); o.frequency.exponentialRampToValueAtTime(520,t+0.28); env(0.13,0.3); o.start(t); o.stop(t+0.3); }
  }
}catch(e){} }

/* ================= THREE SETUP ================= */
// twice the battlefield: the grid scales with it so detail per metre is unchanged
const TW=480, TD=300, NX=300, NZ=176;   // terrain world size & grid
const WATER_Y=1.15, GRAV=16, MAX_POWER=16;
// one timestep shared by the live projectiles, the AI's simulation and the
// on-screen arc, so all three agree exactly regardless of frame rate
const PHYS_DT=1/60;
let projAcc=0;
const SUDDEN_DEATH_ROUND=12, SWILL_RISE=1.15;  // rounds before the swill starts rising, and per-round rise
let waterLevel=WATER_Y;
const stage=$('stage');
const renderer=new THREE.WebGLRenderer({antialias:true});
renderer.shadowMap.enabled=true;
renderer.shadowMap.type=THREE.PCFSoftShadowMap;
renderer.toneMapping=THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure=0.92;
renderer.outputColorSpace=THREE.SRGBColorSpace;
renderer.domElement.style.cssText='position:absolute;inset:0;width:100%;height:100%;display:block;';
stage.insertBefore(renderer.domElement,stage.firstChild);
const scene=new THREE.Scene();
const camera=new THREE.PerspectiveCamera(55,16/9,0.1,900);
const composer=new EffectComposer(renderer);
const renderPass=new RenderPass(scene,camera);
composer.addPass(renderPass);
const ssaoPass=new SSAOPass(scene,camera,window.innerWidth,window.innerHeight);
ssaoPass.kernelRadius=5;
ssaoPass.minDistance=0.018;
ssaoPass.maxDistance=0.035;
composer.addPass(ssaoPass);
const bloomPass=new UnrealBloomPass(new THREE.Vector2(window.innerWidth,window.innerHeight),0.25,0.4,0.95);
composer.addPass(bloomPass);
const outputPass=new OutputPass();
composer.addPass(outputPass);
const pmremGenerator=new THREE.PMREMGenerator(renderer);
pmremGenerator.compileEquirectangularShader();
const envScene=new THREE.Scene();
envScene.background=new THREE.Color(0xd8c791);
const envTarget=pmremGenerator.fromScene(envScene);
scene.environment=envTarget.texture;
scene.environmentIntensity=0.35;   // keep the warm bounce, stop it flattening the palette
function resize(){
  const w=Math.max(1,stage.clientWidth), h=Math.max(1,stage.clientHeight);
  const c=(typeof GFX_CFG!=='undefined'&&GFX_CFG[gfx])||{renderScale:1};
  const dpr=Math.min(window.devicePixelRatio||1,1.5);
  const pr=Math.max(0.5,Math.min(dpr*c.renderScale,MAX_PIXEL_RATIO));
  renderer.setPixelRatio(pr);
  renderer.setSize(w,h,false);
  composer.setPixelRatio&&composer.setPixelRatio(pr);
  composer.setSize(w,h);
  camera.aspect=w/h;                      // follows the real display aspect
  camera.updateProjectionMatrix();
  if(typeof gfxLabel==='function') gfxLabel();
}
addEventListener('resize',resize);

const hemi=new THREE.HemisphereLight(0xf2e8cc,0x6b5a3a,0.85); scene.add(hemi);
const keyLight=new THREE.DirectionalLight(0xfff5ea,1.2);
keyLight.position.set(50,80,40); keyLight.castShadow=true;
keyLight.shadow.mapSize.set(2048,2048);
keyLight.shadow.camera.near=0.5; keyLight.shadow.camera.far=200;
keyLight.shadow.camera.left=-60; keyLight.shadow.camera.right=60;
keyLight.shadow.camera.top=60; keyLight.shadow.camera.bottom=-60;
keyLight.shadow.bias=-0.0005;
scene.add(keyLight);
const fillLight=new THREE.DirectionalLight(0x8fa3c0,0.3);
fillLight.position.set(-40,30,-30); scene.add(fillLight);
const rimLight=new THREE.DirectionalLight(0xffdfa9,0.8);
rimLight.position.set(0,20,-50); scene.add(rimLight);
const ambientLight=new THREE.AmbientLight(0xb9c0c4,0.15); scene.add(ambientLight);

/* ---- graphics quality ----
   Each tier sets both the effect stack and how many real pixels we render.
   renderScale is a multiplier on CSS pixels; dprCap limits how far we follow a
   HiDPI display. The canvas always fills whatever space the stage has, so the
   game renders at the actual size of the screen it is on. */
/* renderScale is a true supersample factor, so Max and Ultra sharpen the image
   even on a standard 1× monitor rather than only helping on HiDPI screens. */
const GFX_LEVELS=['medium','high','max','ultra'];
const GFX_CFG={
  medium:{renderScale:0.72, ssao:false, bloom:false, shadow:1024},
  high:  {renderScale:1.0,  ssao:false, bloom:true,  shadow:2048},
  max:   {renderScale:1.3,  ssao:true,  bloom:true,  shadow:2048},
  ultra: {renderScale:1.7,  ssao:true,  bloom:true,  shadow:4096},
};
const MAX_PIXEL_RATIO=2.6;      // keeps 4K + HiDPI from producing absurd buffers
function defaultGfx(){
  const dpr=window.devicePixelRatio||1;
  const px=(screen.width||1280)*dpr;
  if(px>=3400) return 'max';        // 4k-class display
  if(px>=2200) return 'high';
  return 'high';
}
let gfx=defaultGfx();
try{
  const saved=localStorage.getItem('hogs2gfx');
  if(saved==='low') gfx='medium';                 // migrate the old tier names
  else if(GFX_CFG[saved]) gfx=saved;
}catch(e){}
function applyGfx(){
  const c=GFX_CFG[gfx]||GFX_CFG.high;
  ssaoPass.enabled=c.ssao;                        // SSAO is by far the dearest pass
  bloomPass.enabled=c.bloom;
  renderer.shadowMap.enabled=true;
  keyLight.castShadow=true;
  keyLight.shadow.mapSize.set(c.shadow,c.shadow);
  if(keyLight.shadow.map){ keyLight.shadow.map.dispose(); keyLight.shadow.map=null; }
  scene.traverse(o=>{ if(o.isMesh&&o.material) o.material.needsUpdate=true; });
  try{ localStorage.setItem('hogs2gfx',gfx); }catch(e){}
  resize();
}
function cycleGfx(){
  gfx=GFX_LEVELS[(GFX_LEVELS.indexOf(gfx)+1)%GFX_LEVELS.length];
  applyGfx();
}
function gfxLabel(){
  const b=$('gfxbtn'); if(!b) return;
  const w=Math.round(stage.clientWidth*renderer.getPixelRatio());
  const h=Math.round(stage.clientHeight*renderer.getPixelRatio());
  b.textContent=gfx.toUpperCase()+' · '+w+'×'+h;
}

// sky dome (canvas gradient, back side)
let skyMesh=null;
function setSky(topColor,botColor){
  const cnv=document.createElement('canvas'); cnv.width=2; cnv.height=256;
  const c2=cnv.getContext('2d');
  const gr=c2.createLinearGradient(0,0,0,256);
  gr.addColorStop(0,topColor); gr.addColorStop(0.62,botColor); gr.addColorStop(1,botColor);
  c2.fillStyle=gr; c2.fillRect(0,0,2,256);
  const tex=new THREE.CanvasTexture(cnv);
  if(!skyMesh){
    skyMesh=new THREE.Mesh(new THREE.SphereGeometry(760,24,16),
      new THREE.MeshBasicMaterial({map:tex,side:THREE.BackSide,fog:false,depthWrite:false}));
    skyMesh.renderOrder=-10;
    scene.add(skyMesh);
  } else { skyMesh.material.map.dispose(); skyMesh.material.map=tex; skyMesh.material.needsUpdate=true; }
}
// active-hog marker
const marker=new THREE.Mesh(new THREE.ConeGeometry(0.55,1.1,4),
  new THREE.MeshBasicMaterial({color:0xf0dc96}));
marker.rotation.x=Math.PI; marker.visible=false; scene.add(marker);

// sun disc + clouds
const sunDisc=new THREE.Mesh(new THREE.CircleGeometry(18,24),new THREE.MeshBasicMaterial({color:0xf7ecc0,fog:false}));
sunDisc.position.set(220,150,-320); sunDisc.lookAt(0,0,0); scene.add(sunDisc);
const clouds=new THREE.Group();
for(let i=0;i<10;i++){
  const c=new THREE.Mesh(new THREE.SphereGeometry(1,10,6),
    new THREE.MeshBasicMaterial({color:0xf0e6ca,transparent:true,opacity:0.55,fog:false}));
  c.scale.set(14+Math.random()*22,3+Math.random()*3,7+Math.random()*6);
  c.position.set((Math.random()-0.5)*600,70+Math.random()*50,-180-Math.random()*220);
  c.userData.s=0.6+Math.random()*1.2;
  clouds.add(c);
}
scene.add(clouds);

// water — segmented + animated low-poly waves
const waterMat=new THREE.MeshStandardMaterial({color:0x39647a,transparent:true,opacity:0.88,roughness:0.3,metalness:0.15,flatShading:true});
const waterGeo=new THREE.PlaneGeometry(900,620,56,38);
const water=new THREE.Mesh(waterGeo,waterMat);
water.rotation.x=-Math.PI/2; water.position.y=WATER_Y; scene.add(water);
const waterBase=waterGeo.attributes.position.array.slice();
function animateWater(t){
  const a=waterGeo.attributes.position.array;
  for(let i=0;i<a.length;i+=3){
    const x=waterBase[i], y=waterBase[i+1];
    a[i+2]=Math.sin(x*0.075+t*1.5)*0.16+Math.cos(y*0.06+t*1.1)*0.13;
  }
  waterGeo.attributes.position.needsUpdate=true;   // flatShading derives normals in-shader
}

/* ================= TERRAIN ================= */
let terrainMesh=null, heights=null, baseColors=null, theme=THEMES.green;
const VX=NX+1, VZ=NZ+1;
function idx(i,j){ return j*VX+i; }
/* ================= DETERMINISTIC RANDOMNESS =================
   Online play needs every player's copy of the battlefield to be identical, so
   map generation draws from a seeded stream rather than Math.random(). mulberry32
   is tiny, fast and produces the same sequence from the same seed in every
   browser — which is the whole point.

   IMPORTANT: only gameplay-shaping randomness may use rnd(). Anything cosmetic
   (particles, debris spin, voice lines, sound variation) must stay on
   Math.random(), because it fires a different number of times on different
   machines and would otherwise pull the shared stream out of step. */
let rngState=1;
function setSeed(seed){
  rngState=(seed>>>0)||1;
}
function rnd(){
  rngState=(rngState+0x6D2B79F5)>>>0;
  let t=rngState;
  t=Math.imul(t^(t>>>15),t|1);
  t^=t+Math.imul(t^(t>>>7),t|61);
  return ((t^(t>>>14))>>>0)/4294967296;
}
/* A fresh seed for a battle nobody is sharing. */
function newSeed(){ return (Math.random()*0xFFFFFFFF)>>>0; }

function genTerrain(themeKey,seed){
  // seed first: everything below draws from the shared stream
  setSeed(seed!==undefined?seed:newSeed());
  theme=THEMES[themeKey]||THEMES.green;
  scene.fog=new THREE.Fog(theme.fog,180,560);
  renderer.setClearColor(theme.sky);
  const sc=new THREE.Color(theme.sky);
  setSky('#'+sc.clone().offsetHSL(0.02,0.04,0.14).getHexString(),
         '#'+sc.clone().offsetHSL(-0.01,0.02,-0.02).getHexString());
  heights=new Float32Array(VX*VZ);
  const a1=(4+rnd()*3)*theme.amp, a2=(7+rnd()*5)*theme.amp, a3=2.2*theme.amp;
  const f1=0.045+rnd()*0.02, f2=0.016+rnd()*0.008, f3=0.11+rnd()*0.05;
  const p1=rnd()*9,p2=rnd()*9,p3=rnd()*9,p4=rnd()*9;
  const hasLagoon=rnd()<0.65;
  const lagX=(rnd()-0.5)*TW*0.5, lagZ=(rnd()-0.5)*TD*0.4, lagR=18+rnd()*14;
  for(let j=0;j<VZ;j++)for(let i=0;i<VX;i++){
    const x=-TW/2+i*(TW/NX), z=-TD/2+j*(TD/NZ);
    let h=5.5+Math.sin(x*f1+p1)*a1+Math.sin(z*f1*1.3+p2)*a1*0.7
      +Math.sin(x*f2+p3)*a2+Math.sin((x+z)*f3+p4)*a3
      +Math.sin(z*f2*0.8+p1)*a2*0.5;
    // island falloff at edges
    const ex=Math.abs(x)/(TW/2), ez=Math.abs(z)/(TD/2);
    const edge=Math.max(0,Math.max(ex,ez)-0.72)/0.28;
    h-=edge*edge*22;
    if(hasLagoon){ const d=Math.hypot(x-lagX,z-lagZ);
      if(d<lagR) h-=(1+Math.cos(d/lagR*Math.PI))*0.5*(h+2); }
    heights[idx(i,j)]=Math.max(h,-6);
  }
  const plan=placeStructures();    // picks + flattens all building sites in the heightfield
  buildTerrainMesh();
  buildStructures(plan);
  scatterProps();
  placeBoats();
  placeTanks();
  placeDestroyer();
  buildAssetTags();
}
function terrainColor(h,steep){
  const c=new THREE.Color();
  if(h<WATER_Y+0.9) c.setHex(theme.sand);
  else if(steep>0.55) c.setHex(theme.dirt);
  else c.setHex(theme.grass);
  c.offsetHSL(0,(Math.random()-0.5)*0.03,(Math.random()-0.5)*0.045);
  return c;
}
const detailTex=(function(){
  const c=document.createElement('canvas'); c.width=c.height=256;
  const g2=c.getContext('2d');
  g2.fillStyle='#e8e8e8'; g2.fillRect(0,0,256,256);
  for(let i=0;i<2600;i++){
    const v=205+Math.floor(Math.random()*50);
    g2.fillStyle='rgb('+v+','+v+','+v+')';
    g2.fillRect(Math.random()*256|0,Math.random()*256|0,1+Math.random()*3|0,1+Math.random()*3|0);
  }
  for(let i=0;i<70;i++){
    g2.fillStyle='rgba(120,120,120,'+(0.05+Math.random()*0.08)+')';
    g2.beginPath(); g2.arc(Math.random()*256,Math.random()*256,4+Math.random()*14,0,7); g2.fill();
  }
  const t=new THREE.CanvasTexture(c);
  t.wrapS=t.wrapT=THREE.RepeatWrapping; t.repeat.set(30,18);
  return t;
})();
function buildTerrainMesh(){
  if(terrainMesh){ scene.remove(terrainMesh); terrainMesh.geometry.dispose(); }
  const g=new THREE.BufferGeometry();
  const pos=new Float32Array(VX*VZ*3), col=new Float32Array(VX*VZ*3), uv=new Float32Array(VX*VZ*2);
  for(let j=0;j<VZ;j++)for(let i=0;i<VX;i++){
    const k=idx(i,j), x=-TW/2+i*(TW/NX), z=-TD/2+j*(TD/NZ), h=heights[k];
    pos[k*3]=x; pos[k*3+1]=h; pos[k*3+2]=z;
    uv[k*2]=i/NX; uv[k*2+1]=j/NZ;
    const hx=heights[idx(Math.min(i+1,VX-1),j)]-heights[idx(Math.max(i-1,0),j)];
    const hz=heights[idx(i,Math.min(j+1,VZ-1))]-heights[idx(i,Math.max(j-1,0))];
    const steep=Math.min(1,Math.hypot(hx,hz)*0.28);
    const c=terrainColor(h,steep);
    col[k*3]=c.r; col[k*3+1]=c.g; col[k*3+2]=c.b;
  }
  const ind=[];
  for(let j=0;j<NZ;j++)for(let i=0;i<NX;i++){
    const a=idx(i,j),b=idx(i+1,j),c=idx(i,j+1),d=idx(i+1,j+1);
    ind.push(a,c,b,b,c,d);
  }
  g.setAttribute('position',new THREE.BufferAttribute(pos,3));
  g.setAttribute('color',new THREE.BufferAttribute(col,3));
  g.setAttribute('uv',new THREE.BufferAttribute(uv,2));
  g.setIndex(ind); g.computeVertexNormals();
  baseColors=col.slice();
  terrainMesh=new THREE.Mesh(g,new THREE.MeshStandardMaterial({vertexColors:true,map:detailTex,flatShading:true,roughness:0.95,metalness:0}));
  terrainMesh.receiveShadow=true; terrainMesh.castShadow=false;
  scene.add(terrainMesh);
}
function heightAt(x,z){
  const fi=clamp((x+TW/2)/(TW/NX),0,NX-0.001), fj=clamp((z+TD/2)/(TD/NZ),0,NZ-0.001);
  const i=Math.floor(fi), j=Math.floor(fj), u=fi-i, v=fj-j;
  const h00=heights[idx(i,j)],h10=heights[idx(i+1,j)],h01=heights[idx(i,j+1)],h11=heights[idx(i+1,j+1)];
  return h00*(1-u)*(1-v)+h10*u*(1-v)+h01*(1-u)*v+h11*u*v;
}
function normalAt(x,z){
  const e=1.2;
  const n=new THREE.Vector3(heightAt(x-e,z)-heightAt(x+e,z),2*e,heightAt(x,z-e)-heightAt(x,z+e));
  return n.normalize();
}
let craterLog=[];
function crater(x,z,r,depth){
  // remembered so a returning player can replay the damage onto a fresh map
  if(craterLog) craterLog.push([x,z,r,depth]);
  const g=terrainMesh.geometry, pos=g.attributes.position, col=g.attributes.color;
  const dirtC=new THREE.Color(theme.dirt).offsetHSL(0,0,-0.06);
  const i0=Math.max(0,Math.floor((x-r+TW/2)/(TW/NX))), i1=Math.min(NX,Math.ceil((x+r+TW/2)/(TW/NX)));
  const j0=Math.max(0,Math.floor((z-r+TD/2)/(TD/NZ))), j1=Math.min(NZ,Math.ceil((z+r+TD/2)/(TD/NZ)));
  for(let j=j0;j<=j1;j++)for(let i=i0;i<=i1;i++){
    const k=idx(i,j), vx=pos.getX(k), vz=pos.getZ(k);
    const d=Math.hypot(vx-x,vz-z);
    if(d<r){
      const f=(1+Math.cos(d/r*Math.PI))*0.5;
      const nh=Math.max(heights[k]-depth*f,-6);
      heights[k]=nh; pos.setY(k,nh);
      const mix=Math.min(1,f*1.6);
      col.setXYZ(k,
        col.getX(k)*(1-mix)+dirtC.r*mix,
        col.getY(k)*(1-mix)+dirtC.g*mix,
        col.getZ(k)*(1-mix)+dirtC.b*mix);
    }
  }
  pos.needsUpdate=true; col.needsUpdate=true;
  g.computeVertexNormals();
}

/* ================= DESTRUCTIBLE STRUCTURES ================= */
const unitBox=new THREE.BoxGeometry(1,1,1);
const brickMat=new THREE.MeshStandardMaterial({color:0x9a5b45,roughness:0.9,flatShading:true});
const brickMat2=new THREE.MeshStandardMaterial({color:0x8d503c,roughness:0.9,flatShading:true});
const roofMat=new THREE.MeshStandardMaterial({color:0x6e4a38,roughness:0.85,flatShading:true});
const woodMat=new THREE.MeshStandardMaterial({color:0x7a5c3a,roughness:0.95,flatShading:true});
const concreteMat=new THREE.MeshStandardMaterial({color:0x8d8d82,roughness:0.95,flatShading:true});
const stoneMat=new THREE.MeshStandardMaterial({color:0xa8a094,roughness:0.95,flatShading:true});
const stoneMat2=new THREE.MeshStandardMaterial({color:0x9a9286,roughness:0.95,flatShading:true});
const sandbagMat=new THREE.MeshStandardMaterial({color:0x9a8a5e,roughness:1,flatShading:true});
const folMat=new THREE.MeshStandardMaterial({color:0x4e6b2e,roughness:0.95,flatShading:true});
let buildings=[], props=[], debris=[], loose=[], hazards=[], boats=[], tanks=[], emplacements=[];
function clearStructures(){
  for(const bd of buildings) for(const b of bd.blocks) scene.remove(b.mesh);
  for(const pr of props) scene.remove(pr.mesh);
  for(const d of debris) scene.remove(d.mesh);
  for(const m of loose) scene.remove(m);          // roofs/doors/windows/chimneys
  for(const hz of hazards) scene.remove(hz.mesh); // explosive kegs
  for(const bt of boats) scene.remove(bt.mesh);   // landing craft
  for(const tk of tanks) scene.remove(tk.mesh);   // armour
  for(const em of emplacements) scene.remove(em.mesh);
  for(const sh of ships) scene.remove(sh.mesh);
  buildings=[]; props=[]; debris=[]; loose=[]; hazards=[]; boats=[]; tanks=[]; emplacements=[]; ships=[];
}
// non-destructible decoration that still has to be cleaned up between battles
function addLoose(...meshes){ for(const m of meshes){ scene.add(m); loose.push(m); } return meshes[0]; }
function newBuilding(cx,cz){
  const bd={center:new THREE.Vector3(cx,heightAt(cx,cz)+2,cz), radius:0, blocks:[]};
  buildings.push(bd); return bd;
}
let blockSeq=0;
function bBlock(bd,x,y,z,sx,sy,sz,mat,rx=0,ry=0){
  const m=new THREE.Mesh(unitBox,mat);
  m.userData.bid=blockSeq++;         // stable id: indices shift as blocks are removed
  m.scale.set(sx,sy,sz); m.position.set(x,y,z); m.rotation.set(rx,ry,0);
  m.castShadow=true; m.receiveShadow=true; scene.add(m);
  let hx=sx/2,hy=sy/2,hz=sz/2;
  if(rx){ const c=Math.abs(Math.cos(rx)),s=Math.abs(Math.sin(rx));
    const ny=hy*c+hz*s,nz=hz*c+hy*s; hy=ny; hz=nz; }
  if(ry){ const c=Math.abs(Math.cos(ry)),s=Math.abs(Math.sin(ry));
    const nx=hx*c+hz*s,nz=hz*c+hx*s; hx=nx; hz=nz; }
  const b={mesh:m,half:new THREE.Vector3(hx,hy,hz)};
  bd.blocks.push(b);
  const d=m.position.distanceTo(bd.center)+Math.max(hx,hy,hz);
  if(d>bd.radius) bd.radius=d;
  return b;
}
function pointInBlock(p,b,pad){
  const m=b.mesh.position,h=b.half;
  return Math.abs(p.x-m.x)<h.x+pad&&Math.abs(p.y-m.y)<h.y+pad&&Math.abs(p.z-m.z)<h.z+pad;
}
/* Highest standable surface at (x,z) — terrain, or the top of any building block
   at or below `fromY`. This is what lets hogs walk and land on roofs. */
function surfaceY(x,z,fromY){
  let best=heightAt(x,z);
  for(const bd of buildings){
    const dx=bd.center.x-x, dz=bd.center.z-z;
    const rr=bd.radius+3;
    if(dx*dx+dz*dz>rr*rr) continue;
    for(const b of bd.blocks){
      const m=b.mesh.position, hf=b.half;
      if(Math.abs(x-m.x)<hf.x+0.3&&Math.abs(z-m.z)<hf.z+0.3){
        const top=m.y+hf.y;
        if(top<=fromY+0.45&&top>best) best=top;
      }
    }
  }
  return best;
}
function blockAt(p,pad=0){
  for(const bd of buildings){
    const rr=bd.radius+4+pad;
    if(p.distanceToSquared(bd.center)>rr*rr) continue;
    for(const b of bd.blocks){ if(pointInBlock(p,b,pad)) return {bd,b}; }
  }
  return null;
}
function detachBlock(bd,b,blast){
  const i=bd.blocks.indexOf(b); if(i<0) return;
  bd.blocks.splice(i,1);
  let vel;
  if(blast){ const dir=b.mesh.position.clone().sub(blast); dir.y=Math.abs(dir.y)+1.6;
    vel=dir.normalize().multiplyScalar(7+Math.random()*8); }
  else vel=new THREE.Vector3((Math.random()-0.5)*2.5,1.5,(Math.random()-0.5)*2.5);
  debris.push({mesh:b.mesh,half:b.half,vel,
    spin:new THREE.Vector3((Math.random()-.5)*7,(Math.random()-.5)*7,(Math.random()-.5)*7),
    life:2.4+Math.random()});
}
function settleBuilding(bd){
  let changed=true,guard=0;
  while(changed&&guard++<5){
    changed=false;
    for(let i=bd.blocks.length-1;i>=0;i--){
      const b=bd.blocks[i],p=b.mesh.position,bottom=p.y-b.half.y;
      if(bottom-heightAt(p.x,p.z)<0.95) continue;
      let sup=false;
      for(const o of bd.blocks){ if(o===b) continue;
        if(Math.abs((o.mesh.position.y+o.half.y)-bottom)<0.55&&
           Math.abs(o.mesh.position.x-p.x)<o.half.x+b.half.x-0.05&&
           Math.abs(o.mesh.position.z-p.z)<o.half.z+b.half.z-0.05){ sup=true; break; } }
      if(!sup){ detachBlock(bd,b,null); changed=true; }
    }
  }
}
function damageStructures(pos,r){
  const hit=new Set();
  for(const bd of buildings){
    if(pos.distanceTo(bd.center)>bd.radius+r*1.5+4) continue;
    for(let i=bd.blocks.length-1;i>=0;i--){
      const b=bd.blocks[i];
      if(b.mesh.position.distanceTo(pos)<r*0.85+b.half.length()*0.35){ detachBlock(bd,b,pos); hit.add(bd); }
    }
  }
  hit.forEach(settleBuilding);
  for(let i=props.length-1;i>=0;i--){
    const pr=props[i];
    if(pr.mesh.position.distanceTo(pos)<r*1.5+2.2){
      props.splice(i,1);
      const dir=pr.mesh.position.clone().sub(pos); dir.y=Math.abs(dir.y)+2.2;
      debris.push({mesh:pr.mesh,half:new THREE.Vector3(0.5,0.5,0.5),
        vel:dir.normalize().multiplyScalar(6+Math.random()*5),
        spin:new THREE.Vector3((Math.random()-.5)*5,(Math.random()-.5)*3,(Math.random()-.5)*5),life:3});
    }
  }
}
function updateDebris(dt){
  for(let i=debris.length-1;i>=0;i--){
    const d=debris[i];
    d.vel.y-=GRAV*0.85*dt;
    d.mesh.position.addScaledVector(d.vel,dt);
    d.mesh.rotation.x+=d.spin.x*dt; d.mesh.rotation.y+=d.spin.y*dt; d.mesh.rotation.z+=d.spin.z*dt;
    const g=heightAt(d.mesh.position.x,d.mesh.position.z);
    if(d.mesh.position.y-d.half.y<g){
      d.mesh.position.y=g+d.half.y;
      if(Math.abs(d.vel.y)>3.5){ d.vel.y*=-0.3; d.vel.x*=0.55; d.vel.z*=0.55; }
      else { d.vel.set(0,0,0); d.spin.multiplyScalar(0.75); }
    }
    d.life-=dt;
    if(d.life<0.55) d.mesh.scale.multiplyScalar(Math.max(0.0,1-dt*2.4));
    if(d.life<=0){ scene.remove(d.mesh); debris.splice(i,1); }
  }
}
/* --- builders --- */
function buildCottage(cx,cz){
  const bd=newBuilding(cx,cz), y0=heightAt(cx,cz);
  const W=7,D=5.4,H=3.2,t=0.5,rows=4,rh=H/rows;
  for(let side=0;side<4;side++){
    const horiz=side<2, len=horiz?W:D-2*t;
    const n=Math.max(2,Math.round(len/1.75));
    for(let r=0;r<rows;r++)for(let k=0;k<n;k++){
      if(side===0&&r<3&&k===Math.floor(n/2)) continue;           // door
      if(r===2&&k===1&&side!==0) continue;                        // windows
      const off=-len/2+(k+0.5)*(len/n);
      const px=horiz?cx+off:cx+(side===2?-1:1)*(W/2-t/2);
      const pz=horiz?cz+(side===0?1:-1)*(D/2-t/2):cz+off;
      bBlock(bd,px,y0+rh/2+r*rh,pz,horiz?len/n-0.06:t,rh-0.05,horiz?t:len/n-0.06,r%2?brickMat:brickMat2);
    }
  }
  const slope=0.58, rw=D*0.7, peak=Math.sin(slope)*rw*0.5;
  for(let s2=0;s2<2;s2++){
    const sign=s2?1:-1;
    for(let k=0;k<3;k++){
      bBlock(bd,cx-((W+0.8)/2)+(k+0.5)*(W+0.8)/3, y0+H+peak*0.55,
        cz+sign*Math.cos(slope)*rw*0.27,(W+0.8)/3-0.05,0.22,rw*0.56,roofMat,sign*slope,0);
    }
  }
  bBlock(bd,cx+W*0.3,y0+H+1.1,cz,0.7,1.7,0.7,stoneMat);
}
function buildBunker(cx,cz){
  const bd=newBuilding(cx,cz), y0=heightAt(cx,cz);
  const W=6,D=4.6,H=2.2,t=0.8;
  bBlock(bd,cx-W/4-0.4,y0+H/2,cz+D/2-t/2,W/2-0.8,H,t,concreteMat);
  bBlock(bd,cx+W/4+0.4,y0+H/2,cz+D/2-t/2,W/2-0.8,H,t,concreteMat);
  bBlock(bd,cx,y0+H-0.25,cz+D/2-t/2,W,0.5,t,concreteMat);
  bBlock(bd,cx,y0+0.45,cz+D/2-t/2,W,0.9,t,concreteMat);
  bBlock(bd,cx-W/2+t/2,y0+H/2,cz,t,H,D-2*t,concreteMat);
  bBlock(bd,cx+W/2-t/2,y0+H/2,cz,t,H,D-2*t,concreteMat);
  bBlock(bd,cx,y0+H/2,cz-D/2+t/2,W,H,t,concreteMat);
  bBlock(bd,cx-W/4,y0+H+0.35,cz,W/2,0.7,D+0.6,concreteMat);
  bBlock(bd,cx+W/4,y0+H+0.35,cz,W/2,0.7,D+0.6,concreteMat);
}
function buildTower(cx,cz){
  const bd=newBuilding(cx,cz), y0=heightAt(cx,cz);
  const W=3.6,H=9,t=0.55,lv=6,lh=H/lv;
  for(let l=0;l<lv;l++)for(let s=0;s<4;s++){
    if(l===4&&s<2) continue;                                     // bell openings
    const horiz=s<2;
    const px=horiz?cx:cx+(s===2?-1:1)*(W/2-t/2);
    const pz=horiz?cz+(s===0?1:-1)*(W/2-t/2):cz;
    bBlock(bd,px,y0+lh/2+l*lh,pz,horiz?W:t,lh-0.06,horiz?t:W-2*t,l%2?stoneMat:stoneMat2);
  }
  for(let k=0;k<3;k++) bBlock(bd,cx,y0+H+0.42+k*0.8,cz,W-k*1.05,0.8,W-k*1.05,roofMat);
}
function buildWatch(cx,cz){
  const bd=newBuilding(cx,cz), y0=heightAt(cx,cz);
  const W=2.8,H=4.6;
  for(const sx of [-1,1])for(const sz of [-1,1])
    bBlock(bd,cx+sx*W/2,y0+H/2,cz+sz*W/2,0.35,H,0.35,woodMat);
  bBlock(bd,cx,y0+H+0.15,cz,W+1.2,0.3,W+1.2,woodMat);
  for(const s of [-1,1]){
    bBlock(bd,cx+s*(W/2+0.45),y0+H+0.75,cz,0.18,0.9,W+1.2,woodMat);
    bBlock(bd,cx,y0+H+0.75,cz+s*(W/2+0.45),W+1.2,0.9,0.18,woodMat);
  }
  bBlock(bd,cx,y0+H+1.9,cz,W+1.6,0.25,W+1.6,roofMat);
}
function buildRuin(cx,cz){
  const bd=newBuilding(cx,cz), y0=heightAt(cx,cz);
  const n1=4,n2=3;
  for(let k=0;k<n1;k++){
    const hgt=1.2+rnd()*2.6;
    bBlock(bd,cx-3+k*1.6,y0+hgt/2,cz,1.5,hgt,0.5,k%2?brickMat:brickMat2);
  }
  for(let k=0;k<n2;k++){
    const hgt=1.0+rnd()*2.2;
    bBlock(bd,cx-3.55,y0+hgt/2,cz+1.0+k*1.6,0.5,hgt,1.5,k%2?brickMat2:brickMat);
  }
}
function buildSandbags(cx,cz){
  const bd=newBuilding(cx,cz), y0=heightAt(cx,cz);
  for(let k=0;k<5;k++){
    const a=-0.8+k*0.4;
    const px=cx+Math.cos(a)*3, pz=cz+Math.sin(a)*3;
    bBlock(bd,px,y0+0.35,pz,1.3,0.7,0.8,sandbagMat,0,-a);
    if(k%2===0) bBlock(bd,px,y0+1.0,pz,1.2,0.6,0.75,sandbagMat,0,-a);
  }
}
/* 1940s house — fully subdivided so every wall, roof slab and chimney course is a
   destructible block. No loose meshes: everything goes through bBlock() so it is
   tracked, collapses via settleBuilding(), and is cleared between battles. */
function spawn1940sHouse(x,y,z,sceneRef=scene,style='cottage'){
  const bd=newBuilding(x,z);
  const y0=heightAt(x,z);
  const wallMat  =new THREE.MeshStandardMaterial({color:0xc9b896,roughness:0.95,flatShading:true});
  const wallMat2 =new THREE.MeshStandardMaterial({color:0xbeae8a,roughness:0.95,flatShading:true});
  const roofMat  =new THREE.MeshStandardMaterial({color:0x4a3b28,roughness:0.82,flatShading:true});
  const trimMat  =new THREE.MeshStandardMaterial({color:0x7e5f3b,roughness:0.86,flatShading:true});
  const doorMat  =new THREE.MeshStandardMaterial({color:0x5a3620,roughness:0.92,flatShading:true});
  const windowMat=new THREE.MeshStandardMaterial({color:0x9ec6de,emissive:0x14293a,roughness:0.25,metalness:0.1,flatShading:true});
  const chimMat  =new THREE.MeshStandardMaterial({color:0x6f4d2d,roughness:0.9,flatShading:true});

  const P = style==='shed'  ? {W:10.4,D:7.4,H:4.6,rows:4,gable:0.30}
          : style==='block' ? {W:9.4, D:7.4,H:5.8,rows:5,gable:0.20}
          :                   {W:10.0,D:8.0,H:6.2,rows:5,gable:0.34};
  const W=P.W, D=P.D, H=P.H, rows=P.rows, gable=P.gable, t=0.55, rh=H/rows;

  // --- four walls, brick-by-brick, with a front door and windows ---
  for(let side=0;side<4;side++){
    const horiz=side<2;
    const len=horiz?W:D-2*t;
    const n=Math.max(3,Math.round(len/1.7));
    const mid=Math.floor(n/2);
    const winRow=Math.min(2,rows-2);
    for(let r=0;r<rows;r++)for(let k=0;k<n;k++){
      let mat=(r+k)%2?wallMat:wallMat2;
      if(side===0&&k===mid&&r<2) mat=doorMat;                        // front door
      else if(r===winRow&&(k===1||k===n-2)) mat=windowMat;           // windows
      const off=-len/2+(k+0.5)*(len/n);
      const px=horiz?x+off:x+(side===2?-1:1)*(W/2-t/2);
      const pz=horiz?z+(side===0?1:-1)*(D/2-t/2):z+off;
      bBlock(bd,px,y0+rh/2+r*rh,pz,
        horiz?len/n-0.05:t, rh-0.04, horiz?t:len/n-0.05, mat);
    }
  }
  // --- gabled roof: pitched slabs each side, plus a ridge course ---
  const rw=D*0.62, peak=Math.sin(gable)*rw*0.5;
  const rn=Math.max(3,Math.round(W/2.6));
  for(const sgn of [-1,1])
    for(let k=0;k<rn;k++)
      bBlock(bd, x-(W+0.9)/2+(k+0.5)*(W+0.9)/rn, y0+H+peak*0.55,
        z+sgn*Math.cos(gable)*rw*0.27,
        (W+0.9)/rn-0.05, 0.28, rw*0.58, roofMat, sgn*gable, 0);
  for(let k=0;k<rn;k++)
    bBlock(bd, x-(W+0.4)/2+(k+0.5)*(W+0.4)/rn, y0+H+peak*0.92, z,
      (W+0.4)/rn-0.05, 0.30, 1.0, roofMat);
  // --- chimney stack ---
  for(let k=0;k<3;k++)
    bBlock(bd, x+W*0.28, y0+H+peak*0.5+0.45+k*0.75, z-D*0.22,
      1.2, 0.75, 1.2, k===2?trimMat:chimMat);
  return bd;
}
/* ================= LANDING CRAFT =================
   Flat-bottomed LCVP-style boats moored along the shoreline. A hog walks aboard,
   drives across open water and beaches on the far side — which matters most once
   sudden death floods the low ground and breaks the map into islands. */
function makeLandingCraft(){
  const g=new THREE.Group();
  const hullM=new THREE.MeshStandardMaterial({color:0x3a4048,roughness:0.55,metalness:0.3,flatShading:true});
  const tubeM=new THREE.MeshStandardMaterial({color:0x22262b,roughness:0.85,flatShading:true});
  const deckM=new THREE.MeshStandardMaterial({color:0x4a5058,roughness:0.8,flatShading:true});
  const L=8.0, W=3.4;
  // rigid hull with inflatable collar
  const hull=new THREE.Mesh(new THREE.BoxGeometry(L,1.0,W-0.7),hullM);
  hull.position.y=0.55; g.add(hull);
  const bow=new THREE.Mesh(new THREE.ConeGeometry((W-0.7)/2,2.2,4),hullM);
  bow.rotation.z=-Math.PI/2; bow.rotation.y=Math.PI/4;
  bow.position.set(L/2+0.9,0.55,0); g.add(bow);
  for(const s of [-1,1]){                          // buoyancy tubes
    const tube=new THREE.Mesh(new THREE.CapsuleGeometry(0.42,L-0.8,5,8),tubeM);
    tube.rotation.z=Math.PI/2; tube.position.set(0,0.85,s*(W/2-0.15)); g.add(tube);
  }
  const deck=new THREE.Mesh(new THREE.BoxGeometry(L-1.6,0.16,W-1.3),deckM);
  deck.position.y=1.08; g.add(deck);
  const console_=new THREE.Mesh(new THREE.BoxGeometry(1.0,0.85,1.5),deckM);
  console_.position.set(-1.2,1.55,0); g.add(console_);
  const screen=new THREE.Mesh(new THREE.BoxGeometry(0.1,0.5,1.1),
    new THREE.MeshStandardMaterial({color:0x2a3a44,emissive:0x0e2a33,roughness:0.3}));
  screen.position.set(-0.68,1.75,0); g.add(screen);
  const gunMount=new THREE.Mesh(new THREE.CylinderGeometry(0.14,0.3,1.0,7),tubeM);
  gunMount.position.set(2.4,1.55,0); g.add(gunMount);
  const gun=new THREE.Mesh(new THREE.CylinderGeometry(0.09,0.09,1.7,7),tubeM);
  gun.rotation.z=-Math.PI/2; gun.position.set(3.3,2.0,0); g.add(gun);
  const twinOB=new THREE.Mesh(new THREE.BoxGeometry(0.9,1.0,1.6),tubeM);
  twinOB.position.set(-L/2-0.2,0.75,0); g.add(twinOB);          // outboards
  g.traverse(o=>{ if(o.isMesh){ o.castShadow=true; o.receiveShadow=true; } });
  return g;
}
function spawnBoat(x,z,yaw){
  const mesh=makeLandingCraft();
  mesh.position.set(x,waterLevel,z);
  mesh.rotation.y=yaw;
  scene.add(mesh);
  const b={mesh,x,z,yaw,rider:null,bob:rnd()*6};
  boats.push(b);
  return b;
}
// deep enough to float, and land within reach so it is actually useful
function isNavigable(x,z){ return heightAt(x,z)<waterLevel-0.35; }
function landNear(x,z,rad){
  for(let i=0;i<16;i++){
    const a=i/16*Math.PI*2;
    for(let d=3;d<=rad;d+=1.5){
      const px=x+Math.cos(a)*d, pz=z+Math.sin(a)*d;
      if(heightAt(px,pz)>waterLevel+0.9) return {x:px,z:pz};
    }
  }
  return null;
}
/* Moor each craft a short step off a real beach. Working outward FROM the shore
   (rather than hunting for water and hoping land is nearby) guarantees a hog can
   stand on dry sand and still be inside boarding range. */
function placeBoats(){
  let placed=0,tries=0;
  while(placed<6&&tries++<1200){
    const bx=(rnd()-0.5)*(TW-20), bz=(rnd()-0.5)*(TD-14);
    const bh=heightAt(bx,bz);
    if(bh<waterLevel+0.7||bh>waterLevel+4) continue;      // must be a gentle beach
    if(blockAt(new THREE.Vector3(bx,bh+1.2,bz),2)) continue;
    let moor=null;
    for(let i=0;i<24&&!moor;i++){
      const a=i/24*Math.PI*2;
      for(let d=3.5;d<=6;d+=0.8){
        const wx=bx+Math.cos(a)*d, wz=bz+Math.sin(a)*d;
        if(isNavigable(wx,wz)){ moor={x:wx,z:wz}; break; }
      }
    }
    if(!moor) continue;
    if(boats.some(b=>Math.hypot(b.x-moor.x,b.z-moor.z)<24)) continue;
    const b=spawnBoat(moor.x,moor.z,Math.atan2(bz-moor.z,bx-moor.x));
    b.shore={x:bx,z:bz};                                   // remembered landing point
    placed++;
  }
}
const BOARD_RANGE=8.5;
/* The single "use what's in front of me" action, shared by the keyboard, the
   gamepad and the touch button so they can never drift apart again. */
/* Movement for the active hog, whatever it happens to be sitting in. Keyboard,
   gamepad and touch all route through here so driving works on every input. */
function moveActive(h,dx,dz,dt){
  if(!h) return;
  if(netOn()&&!NETG.applying&&iControl(h.team)) netSendMove(h);
  if(h.ship) driveShip(h.ship,dx,dz,dt);
  else if(h.boat) driveBoat(h.boat,dx,dz,dt);
  else if(h.tank) driveTank(h.tank,dx,dz,dt);
  else if(!h.emplacement) walkHog(h,dx,dz,dt);
}
function useNearby(h){
  if(!h||!B||B.state!=='action'||isAI(B.team)) return false;
  if(h.ship) return leaveShip(h);
  if(h.boat){
    if(shipAt(h.position,18)) return boardShip(h);   // alongside the destroyer
    return disembark(h);
  }
  if(h.tank) return leaveTank(h);
  if(h.emplacement){ h.emplacement=null; buildTray(); bubble(h,'Standing down.'); return true; }
  if(tankAt(h.position,BOARD_RANGE)) return boardTank(h);
  if(boatAt(h.position,BOARD_RANGE)) return boardBoat(h);
  const e=emplacementAt(h.position,6.5);
  if(e){
    h.emplacement=e; B.sel='1'; buildTray();
    bubble(h,e.type==='arty'?'Gun crew ready!':'On the gun!'); sfx('beep');
    return true;
  }
  return false;
}
/* The AI's own boarding action. useNearby() is the player's, and is gated on
   the player's turn because it rebuilds the weapon tray and speaks the hint. */
function aiBoard(h,o){
  if(!B||B.over) return false;
  if(tanks.includes(o)){ if(o.rider||o.dead) return false;
    o.rider=h; h.tank=o; h.vel.set(0,0,0); h.grounded=true;
    bubble(h,pick(['Start her up!','Right, this is more like it.'])); sfx('beep'); return true; }
  if(boats.includes(o)){ if(o.rider) return false;
    o.rider=h; h.boat=o; h.vel.set(0,0,0); h.grounded=true;
    bubble(h,pick(['All aboard!','Cast off!'])); sfx('beep'); return true; }
  if(emplacements.includes(o)){ if(o.shots<=0||empManned(o)) return false;
    h.emplacement=o;
    bubble(h,o.type==='arty'?'Gun crew ready!':'On the gun!'); sfx('beep'); return true; }
  return false;
}
function boatAt(pos,rad){
  for(const b of boats){ if(!b.rider&&Math.hypot(b.x-pos.x,b.z-pos.z)<rad) return b; }
  return null;
}
function boardBoat(h){
  const b=boatAt(h.position,BOARD_RANGE);
  if(!b) return false;
  b.rider=h; h.boat=b; h.vel.set(0,0,0); h.grounded=true;
  bubble(h,pick(['Boat team, go!','Cast off!','Anchors aweigh!']));
  sfx('beep');
  return true;
}
function disembark(h){
  const b=h.boat; if(!b) return false;
  const spot=landNear(b.x,b.z,12)||b.shore;
  if(!spot){ bubble(h,'No beach to land on!'); return false; }
  h.boat=null; b.rider=null;
  h.position.set(spot.x,heightAt(spot.x,spot.z),spot.z);
  h.grounded=true; h.vel.set(0,0,0);
  bubble(h,pick(['Ashore!','Feet dry!','Off we go!']));
  sfx('beep');
  return true;
}
function driveBoat(b,dx,dz,dt){
  const sp=11*dt;
  const nx=clamp(b.x+dx*sp,-TW/2+4,TW/2-4), nz=clamp(b.z+dz*sp,-TD/2+4,TD/2-4);
  if(heightAt(nx,nz)>waterLevel+0.35) return;             // ran aground
  b.x=nx; b.z=nz;
  b.yaw=Math.atan2(dz,dx);
}
function updateBoats(dt){
  for(const b of boats){
    b.bob+=dt;
    b.mesh.position.set(b.x,waterLevel+Math.sin(b.bob*1.6)*0.12,b.z);
    b.mesh.rotation.y=-b.yaw;
    b.mesh.rotation.z=Math.sin(b.bob*1.2)*0.03;
    if(b.rider&&!b.rider.dead){
      const h=b.rider;
      h.position.set(b.x,b.mesh.position.y+1.35,b.z);
      h.mesh.rotation.y=-b.yaw;
    } else if(b.rider&&b.rider.dead){ b.rider.boat=null; b.rider=null; }
  }
}

/* ================= DESTROYER =================
   A warship anchored in deep water. Sail a landing craft out to her, climb
   aboard, and her main battery reaches anywhere on the map. */
function makeDestroyer(){
  const g=new THREE.Group();
  const hullM=new THREE.MeshStandardMaterial({color:0x4a5158,roughness:0.72,metalness:0.4,flatShading:true});
  const deckM=new THREE.MeshStandardMaterial({color:0x33383d,roughness:0.95,flatShading:true});
  const islandM=new THREE.MeshStandardMaterial({color:0x3d444a,roughness:0.7,metalness:0.35,flatShading:true});
  const lineM=new THREE.MeshBasicMaterial({color:0xd8d2b8});
  const L=54, W=11;
  const hull=new THREE.Mesh(new THREE.BoxGeometry(L,5.2,W),hullM);
  hull.position.y=1.9; g.add(hull);
  const bow=new THREE.Mesh(new THREE.ConeGeometry(W/2,8,4),hullM);
  bow.rotation.z=-Math.PI/2; bow.rotation.y=Math.PI/4;
  bow.position.set(L/2+3,1.9,0); g.add(bow);
  // the flight deck: wide, flat, with an angled landing strip
  const deck=new THREE.Mesh(new THREE.BoxGeometry(L+6,0.7,W+7),deckM);
  deck.position.y=4.9; g.add(deck);
  const angled=new THREE.Mesh(new THREE.BoxGeometry(L*0.62,0.72,6.4),deckM);
  angled.position.set(2,4.95,-4.2); angled.rotation.y=0.16; g.add(angled);
  // deck markings
  const centre=new THREE.Mesh(new THREE.PlaneGeometry(L-6,0.5),lineM);
  centre.rotation.x=-Math.PI/2; centre.position.set(0,5.28,2.4); g.add(centre);
  const angleLine=new THREE.Mesh(new THREE.PlaneGeometry(L*0.5,0.45),lineM);
  angleLine.rotation.x=-Math.PI/2; angleLine.rotation.z=0.16;
  angleLine.position.set(2,5.32,-4.2); g.add(angleLine);
  // island superstructure to starboard
  const island=new THREE.Mesh(new THREE.BoxGeometry(7.5,4.2,3.4),islandM);
  island.position.set(-6,7.3,W/2+1.2); g.add(island);
  const bridge=new THREE.Mesh(new THREE.BoxGeometry(5,1.6,3.0),
    new THREE.MeshStandardMaterial({color:0x2a3238,roughness:0.35,metalness:0.5,flatShading:true}));
  bridge.position.set(-6,9.9,W/2+1.2); g.add(bridge);
  const mast=new THREE.Mesh(new THREE.BoxGeometry(0.35,5.5,0.35),islandM);
  mast.position.set(-7.5,13.2,W/2+1.2); g.add(mast);
  for(let i=0;i<3;i++){                           // radar panels
    const rad=new THREE.Mesh(new THREE.BoxGeometry(0.2,1.5,1.5),
      new THREE.MeshStandardMaterial({color:0x555f66,roughness:0.5,metalness:0.5}));
    rad.position.set(-4.2,8.6,W/2+1.2); rad.rotation.y=i*2.1; g.add(rad);
  }
  // parked aircraft on the deck
  for(let i=0;i<3;i++){
    const jet=new THREE.Group();
    const jm=new THREE.MeshStandardMaterial({color:0x596069,roughness:0.5,metalness:0.45,flatShading:true});
    const fus=new THREE.Mesh(new THREE.CylinderGeometry(0.3,0.22,3.6,7),jm);
    fus.rotation.z=Math.PI/2; jet.add(fus);
    const wg=new THREE.Mesh(new THREE.BoxGeometry(1.1,0.1,3.4),jm); jet.add(wg);
    const tail=new THREE.Mesh(new THREE.BoxGeometry(0.7,1.0,0.1),jm);
    tail.position.set(-1.5,0.5,0); jet.add(tail);
    jet.position.set(-16+i*7,5.6,4.6); jet.rotation.y=0.4;
    jet.scale.setScalar(1.15); g.add(jet);
  }
  g.traverse(o=>{ if(o.isMesh){ o.castShadow=true; o.receiveShadow=true; } });
  return g;
}
let ships=[];
function spawnDestroyer(x,z,yaw){
  const mesh=makeDestroyer();
  mesh.position.set(x,waterLevel,z);
  mesh.rotation.y=yaw;
  scene.add(mesh);
  const s={mesh,x,z,yaw,bob:rnd()*6,crew:null,y:waterLevel+4.4};
  ships.push(s);
  return s;
}
function placeDestroyer(){
  // wants deep water with sea room, ideally out towards a map edge
  let best=null;
  for(let i=0;i<600;i++){
    const x=(rnd()-0.5)*(TW-16), z=(rnd()-0.5)*(TD-16);
    if(!isNavigable(x,z)) continue;
    let clear=true;
    for(let a=0;a<8&&clear;a++){
      const ang=a/8*Math.PI*2;
      if(!isNavigable(x+Math.cos(ang)*15,z+Math.sin(ang)*15)) clear=false;
    }
    if(!clear) continue;
    const nearBoat=boats.length?Math.min(...boats.map(b=>Math.hypot(b.x-x,b.z-z))):999;
    const score=-nearBoat;                     // prefer sitting near the moorings
    if(!best||score>best.score) best={x,z,score};
  }
  if(best) spawnDestroyer(best.x,best.z,rnd()*Math.PI*2);
}
function shipAt(pos,rad){
  for(const s of ships){ if(!s.crew&&Math.hypot(s.x-pos.x,s.z-pos.z)<rad) return s; }
  return null;
}
function boardShip(h){
  const s=shipAt(h.position,18);              // she's big; board from alongside
  if(!s||!h.boat) return false;
  s.crew=h; h.ship=s;
  h.shipFromBoat=h.boat;                      // remember the craft moored alongside
  bubble(h,pick(["Flight deck, we're aboard!",'Carrier air wing, stand by!','Now this is artillery.']));
  speak('Carrier air wing, stand by!');
  sfx('beep'); B.sel='1'; buildTray();
  return true;
}
function leaveShip(h){
  const s=h.ship; if(!s) return false;
  h.ship=null; s.crew=null;
  const b=h.shipFromBoat||h.boat;
  if(b){ h.boat=b; b.rider=h; }               // climb back down into the boat
  bubble(h,'Back to the boat.'); sfx('beep');
  B.sel='1'; buildTray();
  return true;
}
/* Steer the destroyer. She's 34m long, so the whole hull footprint has to stay
   in deep water — checking just the centre would let her bow ride up a beach. */
function shipFits(s,x,z,yaw){
  const c=Math.cos(yaw), sn=Math.sin(yaw);
  for(const along of [-17,-9,0,9,17]){
    for(const beam of [-3.4,3.4]){
      const px=x+c*along-sn*beam, pz=z+sn*along+c*beam;
      if(Math.abs(px)>TW/2-6||Math.abs(pz)>TD/2-6) return false;
      if(heightAt(px,pz)>waterLevel-0.6) return false;   // would run aground
    }
  }
  return true;
}
function driveShip(s,dx,dz,dt){
  const want=Math.atan2(dz,dx);
  // swing the bow round rather than sliding sideways
  let diff=want-s.yaw;
  while(diff>Math.PI) diff-=Math.PI*2;
  while(diff<-Math.PI) diff+=Math.PI*2;
  s.yaw+=clamp(diff,-1.5*dt,1.5*dt);
  // makes way once she's roughly on the heading, so turns cost you distance
  const onCourse=Math.max(0.25,1-Math.abs(diff)/Math.PI);
  const sp=11*dt*onCourse;
  const nx=s.x+Math.cos(s.yaw)*sp, nz=s.z+Math.sin(s.yaw)*sp;
  if(shipFits(s,nx,nz,s.yaw)){ s.x=nx; s.z=nz; }
}
function updateShips(dt){
  for(const s of ships){
    s.bob+=dt;
    s.mesh.position.set(s.x,waterLevel+Math.sin(s.bob*0.9)*0.1,s.z);
    s.mesh.rotation.z=Math.sin(s.bob*0.7)*0.012;
    s.y=s.mesh.position.y+4.4;
    if(s.crew&&!s.crew.dead){
      const h=s.crew;
      h.position.set(s.x,s.y,s.z);
      h.mesh.rotation.y=-s.yaw;
      // tow the landing craft alongside so you aren't stranded when you climb down
      const b=h.shipFromBoat;
      if(b){
        b.x=s.x-Math.sin(s.yaw)*7.5;
        b.z=s.z+Math.cos(s.yaw)*7.5;
        b.yaw=s.yaw;
      }
    } else if(s.crew&&s.crew.dead){ s.crew.ship=null; s.crew=null; }
  }
}

/* ================= TANKS =================
   Two per map. Climb in for heavy armour and a main gun that flattens anything;
   the trade is that you're slow, loud, and a very obvious target. */
function makeTank(){
  const g=new THREE.Group();
  const hullM=new THREE.MeshStandardMaterial({color:0x6a6a58,roughness:0.72,metalness:0.35,flatShading:true});
  const darkM=new THREE.MeshStandardMaterial({color:0x33352c,roughness:0.85,metalness:0.3,flatShading:true});
  // low, sloped, angular — composite armour rather than riveted steel
  const hull=new THREE.Mesh(new THREE.BoxGeometry(8.2,1.3,4.6),hullM);
  hull.position.y=1.55; g.add(hull);
  const glacis=new THREE.Mesh(new THREE.BoxGeometry(2.8,1.05,4.6),hullM);
  glacis.position.set(3.9,1.5,0); glacis.rotation.z=-0.55; g.add(glacis);
  const skirt=new THREE.Mesh(new THREE.BoxGeometry(8.4,0.7,5.0),darkM);
  skirt.position.y=1.05; g.add(skirt);
  for(const s of [-1,1]){
    const tr=new THREE.Mesh(new THREE.BoxGeometry(8.6,1.15,1.15),darkM);
    tr.position.set(0,0.75,s*2.25); g.add(tr);
    for(let i=0;i<7;i++){
      const wheel=new THREE.Mesh(new THREE.CylinderGeometry(0.46,0.46,0.55,10),darkM);
      wheel.rotation.x=Math.PI/2; wheel.position.set(-3.4+i*1.14,0.75,s*2.25); g.add(wheel);
    }
  }
  const turret=new THREE.Group();
  const tur=new THREE.Mesh(new THREE.BoxGeometry(4.4,1.15,3.2),hullM);
  tur.position.y=2.75; turret.add(tur);
  const bustle=new THREE.Mesh(new THREE.BoxGeometry(1.9,0.95,3.0),darkM);
  bustle.position.set(-2.6,2.75,0); turret.add(bustle);          // ammo bustle
  const mantlet=new THREE.Mesh(new THREE.BoxGeometry(0.8,0.85,1.5),darkM);
  mantlet.position.set(2.3,2.75,0); turret.add(mantlet);
  const barrel=new THREE.Mesh(new THREE.CylinderGeometry(0.2,0.24,6.4,10),darkM);
  barrel.rotation.z=-Math.PI/2; barrel.position.set(5.6,2.75,0); turret.add(barrel);
  const brake=new THREE.Mesh(new THREE.CylinderGeometry(0.3,0.3,0.6,10),darkM);
  brake.rotation.z=-Math.PI/2; brake.position.set(8.5,2.75,0); turret.add(brake);
  const cwsMount=new THREE.Mesh(new THREE.BoxGeometry(0.7,0.45,0.7),darkM);   // remote weapon station
  cwsMount.position.set(-0.7,3.55,0.75); turret.add(cwsMount);
  const cwsGun=new THREE.Mesh(new THREE.CylinderGeometry(0.08,0.08,1.5,6),darkM);
  cwsGun.rotation.z=-Math.PI/2; cwsGun.position.set(0.2,3.65,0.75); turret.add(cwsGun);
  g.add(turret); g.userData.turret=turret;
  g.traverse(o=>{ if(o.isMesh){ o.castShadow=true; o.receiveShadow=true; } });
  return g;
}
function spawnTank(x,z,yaw){
  const mesh=makeTank();
  mesh.position.set(x,heightAt(x,z),z);
  mesh.rotation.y=yaw;
  scene.add(mesh);
  const t={mesh,x,z,yaw,rider:null,hp:150,dead:false};
  tanks.push(t);
  return t;
}
/* One tank per side, parked in the half each squad deploys into, so both teams
   actually have armour within walking distance instead of it landing wherever. */
function placeTanks(){
  // with three or more squads there is no "your half", so the two tanks go near
  // the middle where they are equally worth fighting over
  if(B&&B.cfg&&B.cfg.nats.length>2){
    let put=0;
    for(let i=0;i<600&&put<2;i++){
      const x=(rnd()-0.5)*TW*0.34, z=(rnd()-0.5)*TD*0.34;
      if(heightAt(x,z)<WATER_Y+2.5) continue;
      if(blockAt(new THREE.Vector3(x,heightAt(x,z)+1.6,z),3)) continue;
      if(tanks.some(t=>Math.hypot(t.x-x,t.z-z)<40)) continue;
      spawnTank(x,z,rnd()*Math.PI*2); put++;
    }
    if(put) return;
  }
  for(const side of [-1,1]){
    let done=false;
    const attempt=(minX,maxX,slope)=>{
      for(let i=0;i<400;i++){
        const x=side*(minX+rnd()*(maxX-minX));
        const z=(rnd()-0.5)*(TD-40);
        const y=heightAt(x,z);
        if(y<waterLevel+2.2) continue;
        if(Math.abs(heightAt(x+4,z)-y)>slope||Math.abs(heightAt(x,z+4)-y)>slope) continue;
        if(blockAt(new THREE.Vector3(x,y+1.6,z),3.4)) continue;
        if(tanks.some(t=>Math.hypot(t.x-x,t.z-z)<30)) continue;
        spawnTank(x,z,rnd()*Math.PI*2);
        return true;
      }
      return false;
    };
    done=attempt(34,130,2.2)||attempt(18,170,3.4)||attempt(10,200,5.0);
  }
}
function tankAt(pos,rad){
  for(const t of tanks){ if(!t.rider&&!t.dead&&Math.hypot(t.x-pos.x,t.z-pos.z)<rad) return t; }
  return null;
}
function boardTank(h){
  const t=tankAt(h.position,BOARD_RANGE);
  if(!t) return false;
  t.rider=h; h.tank=t; h.vel.set(0,0,0); h.grounded=true;
  bubble(h,pick(['Mounting up!','Right, this is more like it.','Mind the paintwork.']));
  sfx('beep'); B.sel='1'; buildTray();
  return true;
}
function leaveTank(h){
  const t=h.tank; if(!t) return false;
  // step off beside the hull onto solid ground
  for(let i=0;i<12;i++){
    const a=i/12*Math.PI*2;
    const px=t.x+Math.cos(a)*5.5, pz=t.z+Math.sin(a)*5.5;
    const py=heightAt(px,pz);
    if(py>waterLevel+0.5&&!blockAt(new THREE.Vector3(px,py+1.2,pz),1)){
      h.tank=null; t.rider=null;
      h.position.set(px,py,pz); h.grounded=true; h.vel.set(0,0,0);
      bubble(h,'Out we get.'); sfx('beep'); B.sel='1'; buildTray();
      return true;
    }
  }
  bubble(h,'No room to climb out!');
  return false;
}
function driveTank(t,dx,dz,dt){
  const sp=7.5*dt;
  const nx=clamp(t.x+dx*sp,-TW/2+5,TW/2-5), nz=clamp(t.z+dz*sp,-TD/2+5,TD/2-5);
  const ny=heightAt(nx,nz);
  if(ny<waterLevel+0.4) return;                     // tanks don't float
  if(Math.abs(ny-heightAt(t.x,t.z))>1.8) return;    // can't climb cliffs
  if(blockAt(new THREE.Vector3(nx,ny+1.6,nz),2.6)) return;
  t.x=nx; t.z=nz; t.yaw=Math.atan2(dz,dx);
}
/* A tank that ends up under the rising swill floods. The crew were being missed
   entirely: riders skip the hog physics step (the vehicle drives their position),
   and that is where the drowning check lives — so a submerged tank sat happily on
   the seabed with a live pig inside it. */
function floodTank(t){
  if(t.dead) return;
  t.dead=true;
  const rider=t.rider;
  if(rider){ rider.tank=null; t.rider=null; if(!rider.dead) drown(rider); }
  sfx('splash');
  spawnParticles(new THREE.Vector3(t.x,waterLevel,t.z),18,0x7f9bb0,5);
  sinkMesh(t.mesh);
}
function updateTanks(dt){
  for(const t of tanks){
    if(t.dead) continue;
    // hull deck under water — she floods, and anyone buttoned up goes with her
    if(heightAt(t.x,t.z)<waterLevel-0.6){ floodTank(t); continue; }
    t.mesh.position.set(t.x,heightAt(t.x,t.z),t.z);
    t.mesh.rotation.y=-t.yaw;
    if(t.mesh.userData.turret&&t.rider)
      t.mesh.userData.turret.rotation.y=-(B.aimPitch?0:0);
    if(t.rider&&!t.rider.dead){
      const h=t.rider;
      h.position.set(t.x,t.mesh.position.y+2.6,t.z);
      h.mesh.rotation.y=-t.yaw;
    } else if(t.rider&&t.rider.dead){ t.rider.tank=null; t.rider=null; }
  }
}
function damageTank(t,amount,owner){
  if(t.dead) return;
  t.hp-=amount;
  if(t.hp<=0){
    t.dead=true;
    const rider=t.rider;
    if(rider){ rider.tank=null; t.rider=null; damageHog(rider,45,owner,'tank'); }
    if(B&&B.stats&&owner&&owner.team!=null) ST(owner.team).vehicles++;
    scene.remove(t.mesh);
    boom(new THREE.Vector3(t.x,heightAt(t.x,t.z)+1.5,t.z),13,60,owner,'tank');
  }
}

/* ================= DEFENCE BASES =================
   A sandbagged strongpoint with an emplaced field gun and a machine-gun nest.
   Stand at one and you can fire it for free — no drain on your own ammo. */
function buildDefenceBase(cx,cz){
  const bd=newBuilding(cx,cz), y0=heightAt(cx,cz);
  const sandM=new THREE.MeshStandardMaterial({color:0x9a8a5e,roughness:1,flatShading:true});
  const sandM2=new THREE.MeshStandardMaterial({color:0x8d7e54,roughness:1,flatShading:true});
  const concM=new THREE.MeshStandardMaterial({color:0x8d8d82,roughness:0.95,flatShading:true});
  // sandbag horseshoe
  for(let k=0;k<11;k++){
    const a=-2.5+k*0.42;
    const px=cx+Math.cos(a)*6.5, pz=cz+Math.sin(a)*6.5;
    bBlock(bd,px,y0+0.42,pz,1.5,0.85,1.0,k%2?sandM:sandM2,0,-a);
    if(k%2===0) bBlock(bd,px,y0+1.2,pz,1.4,0.8,0.95,sandM2,0,-a);
  }
  // concrete revetment at the back
  bBlock(bd,cx-4.6,y0+1.1,cz,1.1,2.2,7.0,concM);
  // the gun itself
  const gun=makeFieldGun();
  gun.position.set(cx+1.2,y0,cz-1.4);
  gun.rotation.y=rnd()*Math.PI*2;
  scene.add(gun); loose.push(gun);
  emplacements.push({type:'arty',mesh:gun,x:cx+1.2,z:cz-1.4,y:y0,shots:2});
  // machine-gun nest
  const nest=new THREE.Group();
  const mgM=new THREE.MeshStandardMaterial({color:0x40453a,roughness:0.6,metalness:0.5,flatShading:true});
  const tripod=new THREE.Mesh(new THREE.CylinderGeometry(0.12,0.5,1.1,6),mgM);
  tripod.position.y=0.55; nest.add(tripod);
  const body=new THREE.Mesh(new THREE.BoxGeometry(1.5,0.4,0.35),mgM);
  body.position.y=1.25; nest.add(body);
  const bl=new THREE.Mesh(new THREE.CylinderGeometry(0.09,0.09,2.0,8),mgM);
  bl.rotation.z=-Math.PI/2; bl.position.set(1.5,1.28,0); nest.add(bl);
  nest.position.set(cx+1.0,y0,cz+3.0);
  nest.rotation.y=rnd()*Math.PI*2;
  nest.traverse(o=>{ if(o.isMesh){ o.castShadow=true; o.receiveShadow=true; } });
  scene.add(nest); loose.push(nest);
  emplacements.push({type:'mg',mesh:nest,x:cx+1.0,z:cz+3.0,y:y0,shots:3});
  return bd;
}
function emplacementAt(pos,rad){
  for(const e of emplacements){ if(e.shots>0&&Math.hypot(e.x-pos.x,e.z-pos.z)<rad) return e; }
  return null;
}

/* Ammo crate: a small stack of boxes. Blow it up and it cooks off — a smaller,
   snappier bang than the fuel kegs, but it chain-reacts just the same. */
function spawnAmmoCrate(x,y,z,big){
  const g=new THREE.Group();
  const woodM=new THREE.MeshStandardMaterial({color:0x8a6a3c,roughness:0.95,flatShading:true});
  const bandM=new THREE.MeshStandardMaterial({color:0x5c5236,roughness:0.8,metalness:0.3,flatShading:true});
  const stencilM=new THREE.MeshStandardMaterial({color:0xb8ac82,roughness:0.9});
  const box=(bx,by,bz,s,rot)=>{
    const b=new THREE.Mesh(new THREE.BoxGeometry(s*1.5,s*0.95,s),woodM);
    b.position.set(bx,by,bz); b.rotation.y=rot; g.add(b);
    const band=new THREE.Mesh(new THREE.BoxGeometry(s*1.54,s*0.16,s*1.04),bandM);
    band.position.copy(b.position); band.rotation.y=rot; g.add(band);
    const mark=new THREE.Mesh(new THREE.PlaneGeometry(s*0.5,s*0.28),stencilM);
    mark.position.set(bx+Math.sin(rot)*0.01,by+s*0.1,bz+Math.cos(rot)*(s/2+0.02));
    mark.rotation.y=rot; g.add(mark);
  };
  const n=big?6:2, s=1.05;
  for(let i=0;i<n;i++){
    const tier=Math.floor(i/2);
    box((i%2?1:-1)*s*0.82+(rnd()-0.5)*0.2, s*0.5+tier*s*0.98,
        (rnd()-0.5)*0.5, s, (rnd()-0.5)*0.5);
  }
  g.traverse(o=>{ if(o.isMesh){ o.castShadow=true; o.receiveShadow=true; } });
  g.position.set(x,y,z);
  scene.add(g);
  hazards.push({type:'ammo',mesh:g,x,y:y+1.2,z,hp:big?34:18,dead:false,
    blast:big?13:8, dmg:big?60:42});
  return g;
}
function spawnExplosiveKeg(x,y,z,sceneRef=scene){
  const keg=new THREE.Group();
  const bodyMat=new THREE.MeshStandardMaterial({color:0x9ba5ae,metalness:0.8,roughness:0.45});
  const bandMat=new THREE.MeshStandardMaterial({color:0x7a4f29,metalness:0.35,roughness:0.8});
  const R=1.05, Hk=2.8;
  const body=new THREE.Mesh(new THREE.CylinderGeometry(R,R*1.06,Hk,14),bodyMat);
  const top=new THREE.Mesh(new THREE.CylinderGeometry(R*1.04,R*1.04,0.16,14),bodyMat);
  const bottom=new THREE.Mesh(new THREE.CylinderGeometry(R*1.04,R*1.04,0.16,14),bodyMat);
  top.position.y=Hk/2; bottom.position.y=-Hk/2;
  const stripe=new THREE.Mesh(new THREE.CylinderGeometry(R*1.07,R*1.07,0.34,14),
    new THREE.MeshStandardMaterial({color:0xaa3322,roughness:0.7}));
  keg.add(body,top,bottom,stripe);
  for(const yy of [-0.75,0.75]){
    const band=new THREE.Mesh(new THREE.TorusGeometry(R*1.05,0.09,7,16),bandMat);
    band.rotation.x=Math.PI/2; band.position.y=yy; keg.add(band);
  }
  keg.traverse(o=>{ if(o.isMesh){ o.castShadow=true; o.receiveShadow=true; } });
  keg.position.set(x,y+Hk/2+0.1,z);      // sits ON the ground, not floating
  scene.add(keg);
  // module-level so it survives genTerrain() running before B exists, and is cleaned up
  hazards.push({type:'keg',mesh:keg,x,y:y+Hk/2+0.1,z,hp:25,dead:false});
  return keg;
}
const BUILDERS={cottage:buildCottage,bunker:buildBunker,tower:buildTower,watch:buildWatch,ruin:buildRuin,sand:buildSandbags};
function flattenSite(cx,cz,rad){
  const base=heightAt(cx,cz);
  for(let j=0;j<VZ;j++)for(let i=0;i<VX;i++){
    const x=-TW/2+i*(TW/NX), z=-TD/2+j*(TD/NZ);
    const d=Math.hypot(x-cx,z-cz);
    if(d<rad){ const f=(1+Math.cos(d/rad*Math.PI))*0.5;
      heights[idx(i,j)]=heights[idx(i,j)]*(1-f)+base*f; }
  }
}
function placeStructures(){
  clearStructures();
  const kinds=['cottage','bunker','ruin','tower','watch','sand','cottage','ruin'];
  const sites=[]; let tries=0;
  const count=11+Math.floor(rnd()*4);
  while(sites.length<count&&tries++<400){
    const x=(rnd()-0.5)*(TW-70), z=(rnd()-0.5)*(TD-45);
    const h=heightAt(x,z);
    if(h<WATER_Y+2.2) continue;
    if(Math.abs(heightAt(x+5,z)-h)>2.4||Math.abs(heightAt(x,z+5)-h)>2.4) continue;
    if(sites.some(s=>Math.hypot(s.x-x,s.z-z)<22)) continue;
    // cycle the list — more sites than kinds would otherwise give undefined
    sites.push({x,z,kind:kinds[sites.length%kinds.length]});
  }
  // 1940s houses share the same site-selection + flattening as the procedural
  // structures, so they never clip a slope or land on top of each other
  const houseStyles=['cottage','shed','block','cottage'];
  let hTries=0, wanted=5+Math.floor(rnd()*4);
  const houses=[];
  while(houses.length<wanted&&hTries++<300){
    const x=(rnd()-0.5)*(TW-70), z=(rnd()-0.5)*(TD-45);
    const h=heightAt(x,z);
    if(h<WATER_Y+2.2) continue;
    if(Math.abs(heightAt(x+6,z)-h)>2.6||Math.abs(heightAt(x,z+6)-h)>2.6) continue;
    if(sites.some(s=>Math.hypot(s.x-x,s.z-z)<24)) continue;
    if(houses.some(s=>Math.hypot(s.x-x,s.z-z)<24)) continue;
    houses.push({x,z,style:houseStyles[houses.length%houseStyles.length]});
  }
  // one fortified strongpoint per map, sited before the mesh is built so its
  // ground gets flattened along with everything else
  // relax the siting rules in stages so every map gets a strongpoint
  let base=null;
  const tryBase=(gap,slope,tries)=>{
    for(let i=0;i<tries;i++){
      const x=(rnd()-0.5)*(TW-60), z=(rnd()-0.5)*(TD-40);
      const h=heightAt(x,z);
      if(h<WATER_Y+2.4) continue;
      if(Math.abs(heightAt(x+6,z)-h)>slope||Math.abs(heightAt(x,z+6)-h)>slope) continue;
      if(sites.some(s=>Math.hypot(s.x-x,s.z-z)<gap)) continue;
      if(houses.some(s=>Math.hypot(s.x-x,s.z-z)<gap)) continue;
      return {x,z};
    }
    return null;
  };
  // a bigger battlefield gets a strongpoint on each side
  const bases=[];
  for(let n=0;n<2;n++){
    const b=tryBase(30,2.6,300)||tryBase(20,4.0,300)||tryBase(14,6.0,400);
    if(b&&!bases.some(o=>Math.hypot(o.x-b.x,o.z-b.z)<70)) bases.push(b);
  }
  base=bases[0]||null;
  for(const s of sites) flattenSite(s.x,s.z,7.5);
  for(const s of houses) flattenSite(s.x,s.z,9.0);
  for(const b of bases) flattenSite(b.x,b.z,10);
  return {sites,houses,bases};
}
function buildStructures(plan){
  for(const s of plan.sites){
    const make=BUILDERS[s.kind]||BUILDERS.cottage;   // never let a bad kind kill the map
    make(s.x,s.z);
  }
  for(const s of plan.houses) spawn1940sHouse(s.x,0,s.z,scene,s.style);
  for(const b of (plan.bases||[])) buildDefenceBase(b.x,b.z);
  // volatile scenery: fuel kegs, scattered ammo crates and a couple of big dumps
  const dropHazard=(place,minGap)=>{
    let t=0;
    while(t++<200){
      const x=(rnd()-0.5)*(TW-60), z=(rnd()-0.5)*(TD-36);
      const y=heightAt(x,z);
      if(y<WATER_Y+1.8) continue;
      if(blockAt(new THREE.Vector3(x,y+1.4,z),1.8)) continue;
      if(hazards.some(h=>Math.hypot(h.x-x,h.z-z)<minGap)) continue;
      place(x,y,z); return true;
    }
    return false;
  };
  for(let i=0;i<6;i++) dropHazard((x,y,z)=>spawnExplosiveKeg(x,y,z,scene),14);
  for(let i=0;i<9;i++) dropHazard((x,y,z)=>spawnAmmoCrate(x,y,z,false),10);
  for(let i=0;i<4;i++) dropHazard((x,y,z)=>spawnAmmoCrate(x,y,z,true),18);
}
function scatterProps(){
  folMat.color.setHex(theme===THEMES.snow?0xc9d4cc:theme===THEMES.dark?0x44502e:
    theme===THEMES.desert?0x7d9642:theme===THEMES.beach?0x6f8a3c:0x4e6b2e);
  let placed=0,tries=0;
  while(placed<32&&tries++<600){
    const x=(rnd()-0.5)*(TW-40), z=(rnd()-0.5)*(TD-24);
    if(heightAt(x,z)<WATER_Y+1.8) continue;
    if(blockAt(new THREE.Vector3(x,heightAt(x,z)+1,z),3)) continue;
    const g=new THREE.Group(), y=heightAt(x,z);
    if(theme===THEMES.desert){
      // date palm: leaning trunk with a crown of drooping fronds, plus dry scrub
      if(rnd()<0.68){
        const lean=(rnd()-0.5)*0.22, ht=3.4+rnd()*1.8;
        const trunk=new THREE.Mesh(new THREE.CylinderGeometry(0.17,0.3,ht,7),
          new THREE.MeshStandardMaterial({color:0x8a6b42,roughness:0.95,flatShading:true}));
        trunk.position.y=ht/2; trunk.rotation.z=lean; g.add(trunk);
        const top=new THREE.Vector3(Math.sin(lean)*-ht/2,ht,0);
        const nf=6+Math.floor(rnd()*3);
        for(let i=0;i<nf;i++){
          const a=i/nf*Math.PI*2+rnd()*0.3;
          const frond=new THREE.Mesh(new THREE.ConeGeometry(0.42,2.5+rnd()*0.7,4),folMat);
          frond.position.copy(top);
          frond.rotation.z=Math.PI/2-0.55-rnd()*0.3;
          frond.rotation.y=a;
          frond.position.x+=Math.cos(a)*1.05; frond.position.z+=Math.sin(a)*1.05;
          frond.position.y-=0.25;
          g.add(frond);
        }
        const nuts=new THREE.Mesh(new THREE.SphereGeometry(0.3,7,5),
          new THREE.MeshStandardMaterial({color:0xa8763a,roughness:0.9}));
        nuts.position.copy(top).y-=0.35; g.add(nuts);
      } else {
        const scrubMat=new THREE.MeshStandardMaterial({color:0x9aa05e,roughness:1,flatShading:true});
        for(let i=0;i<4;i++){
          const b=new THREE.Mesh(new THREE.SphereGeometry(0.45+rnd()*0.4,6,4),scrubMat);
          b.position.set((rnd()-0.5)*1.5,0.3+rnd()*0.35,(rnd()-0.5)*1.5);
          b.scale.y=0.55; g.add(b);
        }
      }
    } else {
      const trunk=new THREE.Mesh(new THREE.CylinderGeometry(0.22,0.34,1.7,7),woodMat);
      trunk.position.y=0.85; g.add(trunk);
      const nf=2+Math.floor(rnd()*2), sc=0.8+rnd()*0.5;
      for(let i=0;i<nf;i++){
        const f=new THREE.Mesh(new THREE.ConeGeometry((1.6-i*0.42)*sc,1.7*sc,8),folMat);
        f.position.y=1.8+i*1.0*sc; g.add(f);
      }
    }
    g.position.set(x,y,z);
    g.traverse(o=>{ if(o.isMesh) o.castShadow=true; });
    scene.add(g); props.push({mesh:g}); placed++;
  }
  for(let k=0;k<14;k++){    const x=(rnd()-0.5)*(TW-40), z=(rnd()-0.5)*(TD-24);
    if(heightAt(x,z)<WATER_Y+1.6) continue;
    const g=new THREE.Group();
    for(let i=0;i<3;i++){
      const bar=new THREE.Mesh(new THREE.BoxGeometry(0.22,2.4,0.22),
        new THREE.MeshStandardMaterial({color:0x4c4a44,roughness:0.7,metalness:0.5,flatShading:true}));
      bar.rotation.set(rnd()*0.5+(i===0?0.9:0.4),i*2.1,0.6);
      g.add(bar);
    }
    g.position.set(x,heightAt(x,z)+0.8,z);
    g.traverse(o=>{ if(o.isMesh) o.castShadow=true; });
    scene.add(g); props.push({mesh:g});
  }
}

/* ================= PIG FACTORY ================= */
const pinkMat=new THREE.MeshStandardMaterial({color:0xe8a0a8,roughness:0.6,metalness:0.0});
const pinkDark=new THREE.MeshStandardMaterial({color:0xd98a95,roughness:0.75,metalness:0.0});
const snoutMat=new THREE.MeshStandardMaterial({color:0xf0b3ba,roughness:0.6,metalness:0.0});
const eyeMat=new THREE.MeshStandardMaterial({color:0x2b2416,roughness:0.4,metalness:0.0});
function makePig(helmColor){
  const g=new THREE.Group();
  const body=new THREE.Mesh(new THREE.SphereGeometry(1,18,14),pinkMat);
  body.scale.set(1.15,0.95,0.9); body.position.y=0.95; g.add(body);
  // plate carrier over the torso
  const rigMat=new THREE.MeshStandardMaterial({color:0x4a4f42,roughness:0.85,flatShading:true});
  const rig=new THREE.Mesh(new THREE.BoxGeometry(1.5,1.15,1.75),rigMat);
  rig.position.set(-0.1,1.0,0); g.add(rig);
  for(const s of [-1,1]){                       // magazine pouches
    const pouch=new THREE.Mesh(new THREE.BoxGeometry(0.5,0.42,0.34),
      new THREE.MeshStandardMaterial({color:0x3c4136,roughness:0.9,flatShading:true}));
    pouch.position.set(0.42,0.78,s*0.5); g.add(pouch);
  }
  const head=new THREE.Mesh(new THREE.SphereGeometry(0.62,16,12),pinkMat);
  head.position.set(0.95,1.45,0); g.add(head);
  const snout=new THREE.Mesh(new THREE.CylinderGeometry(0.24,0.3,0.3,12),snoutMat);
  snout.rotation.z=-Math.PI/2; snout.position.set(1.62,1.38,0); g.add(snout);
  for(const s of [-1,1]){
    const ear=new THREE.Mesh(new THREE.ConeGeometry(0.17,0.42,8),pinkDark);
    ear.position.set(0.78,2.0,0.3*s); ear.rotation.x=0.25*s; g.add(ear);
    const eye=new THREE.Mesh(new THREE.SphereGeometry(0.07,8,6),eyeMat);
    eye.position.set(1.4,1.62,0.24*s); g.add(eye);
    for(const f of [-1,1]){
      const leg=new THREE.Mesh(new THREE.CylinderGeometry(0.14,0.12,0.6,8),pinkDark);
      leg.position.set(0.55*f,0.28,0.42*s); g.add(leg);
    }
  }
  const helmMat=new THREE.MeshStandardMaterial({color:helmColor,roughness:0.7,metalness:0.15,flatShading:true});
  // modern ballistic helmet: rounded shell, no wide brim
  const helm=new THREE.Mesh(new THREE.SphereGeometry(0.7,16,10,0,Math.PI*2,0,Math.PI*0.58),helmMat);
  helm.position.set(0.95,1.5,0); helm.scale.set(1.06,1.0,1.06); g.add(helm);
  const rail=new THREE.Mesh(new THREE.BoxGeometry(0.5,0.09,0.62),
    new THREE.MeshStandardMaterial({color:0x2c2f28,roughness:0.6,flatShading:true}));
  rail.position.set(0.95,1.95,0); g.add(rail);
  // night-vision mount on the brow
  const nvg=new THREE.Mesh(new THREE.BoxGeometry(0.3,0.22,0.34),
    new THREE.MeshStandardMaterial({color:0x25281f,roughness:0.5,metalness:0.4,flatShading:true}));
  nvg.position.set(1.42,1.86,0); g.add(nvg);
  // comms headset
  for(const s of [-1,1]){
    const cup=new THREE.Mesh(new THREE.CylinderGeometry(0.17,0.17,0.14,10),
      new THREE.MeshStandardMaterial({color:0x2c2f28,roughness:0.7,flatShading:true}));
    cup.rotation.x=Math.PI/2; cup.position.set(0.92,1.44,s*0.6); g.add(cup);
  }
  // rank pips on the helmet
  const pip=new THREE.MeshStandardMaterial({color:0xd8d2b0,roughness:0.6});
  g.userData.pips=[];
  g.traverse(o=>{ if(o.isMesh){ o.castShadow=true; } });
  g.scale.setScalar(1.32);
  return g;
}
// elite hogs swap the tin hat for a rakish beret
function addBeret(g,helmColor){
  const beret=new THREE.Mesh(new THREE.SphereGeometry(0.66,14,9,0,Math.PI*2,0,Math.PI*0.55),
    new THREE.MeshStandardMaterial({color:0x6d2230,roughness:0.85,flatShading:true}));
  beret.position.set(0.95,1.62,0); beret.scale.set(1.06,0.62,1.06); beret.rotation.z=-0.22;
  g.add(beret);
  const badge=new THREE.Mesh(new THREE.CircleGeometry(0.12,10),
    new THREE.MeshStandardMaterial({color:0xd8b34a,roughness:0.4,metalness:0.6}));
  badge.position.set(1.42,1.72,0.2); badge.rotation.y=Math.PI/2;
  g.add(badge);
  beret.castShadow=true;
  return g;
}
function makeGrave(){
  const g=new THREE.Group();
  const m=new THREE.MeshStandardMaterial({color:0x5a4a34,roughness:0.9});
  const v=new THREE.Mesh(new THREE.BoxGeometry(0.25,2.0,0.25),m); v.position.y=1.0; g.add(v);
  const h=new THREE.Mesh(new THREE.BoxGeometry(1.2,0.25,0.25),m); h.position.y=1.5; g.add(h);
  g.traverse(o=>{ if(o.isMesh) o.castShadow=true; });
  return g;
}

/* ================= GAME STATE ================= */
let screenState='menu';
let campaign=null, pendingMode='campaign', B=null;
let shake=0;
function loadSave(){ try{ const s=localStorage.getItem('hogs2'); return s?JSON.parse(s):null; }catch(e){ return null; } }
function save(){ try{ if(campaign) localStorage.setItem('hogs2',JSON.stringify(campaign)); }catch(e){} }
/* Bank the player's side of a finished campaign battle into the career record. */
function bankCareer(won){
  if(!campaign||!B||!B.stats) return;
  campaign.career=mergeStats(campaign.career||blankStats(),B.stats[0]);
  campaign.career.battles=(campaign.career.battles||0)+1;
  campaign.career.won=(campaign.career.won||0)+(won?1:0);
  campaign.career.rounds=(campaign.career.rounds||0)+(B.round||0);
  save();
}
function clearSave(){ try{ localStorage.removeItem('hogs2'); }catch(e){} }
function makeSquad(natIdx){
  const pool=[...NATIONS[natIdx].names];
  return CLASSES.map(c=>{ const i=Math.floor(rnd()*pool.length);
    return {name:pool.splice(i,1)[0], cls:c.id, rank:0, maxhp:100, up:0, branch:c.officer}; });
}
/* Find dry, unobstructed ground for a hog. The old version gave up after 80
   random tries and used whatever it had last — which is how squads ended up
   spawning in the sea. This one degrades through progressively wider searches
   and, as a last resort, sweeps the map for the highest point available. */
function findSpawn(team,placed){
  const N=(B&&B.cfg&&B.cfg.nats.length)||2;
  const side=team===0?-1:1;
  /* Three or more squads can't be split into two halves. Give each one a wedge
     of the map instead, evenly spaced so nobody starts in somebody's lap. */
  if(N>2){
    const a=(team/N)*Math.PI*2;
    const cx=Math.cos(a)*TW*0.33, cz=Math.sin(a)*TD*0.30;
    const dryN=(x,z)=>heightAt(x,z)>WATER_Y+1.8;
    const clearN=(x,z)=>!blockAt(new THREE.Vector3(x,heightAt(x,z)+1.2,z),1.5);
    const spacedN=(x,z,d)=>!placed.some(p=>Math.hypot(p.position.x-x,p.position.z-z)<d);
    for(const [rad,gap] of [[38,9],[62,7],[95,5],[140,3]]){
      for(let i=0;i<500;i++){
        const r=rnd()*rad, th=rnd()*Math.PI*2;
        const x=clamp(cx+Math.cos(th)*r,-TW/2+6,TW/2-6);
        const z=clamp(cz+Math.sin(th)*r,-TD/2+6,TD/2-6);
        if(dryN(x,z)&&clearN(x,z)&&spacedN(x,z,gap)) return {x,z};
      }
    }
    // fall through to the two-sided search rather than risk a spawn in the sea
  }
  const dry=(x,z)=>heightAt(x,z)>WATER_Y+1.8;
  const clear=(x,z)=>!blockAt(new THREE.Vector3(x,heightAt(x,z)+1.2,z),1.5);
  const spaced=(x,z,d)=>!placed.some(p=>p.team===team&&Math.hypot(p.position.x-x,p.position.z-z)<d);
  // 1. preferred: own half, sensible spacing
  for(let i=0;i<400;i++){
    const x=side*(30+rnd()*140), z=(rnd()-0.5)*TD*0.72;
    if(dry(x,z)&&clear(x,z)&&spaced(x,z,9)) return {x,z};
  }
  // 2. own half, any spacing
  for(let i=0;i<400;i++){
    const x=side*(14+rnd()*200), z=(rnd()-0.5)*TD*0.85;
    if(dry(x,z)&&clear(x,z)) return {x,z};
  }
  // 3. anywhere at all that is dry
  for(let i=0;i<600;i++){
    const x=(rnd()-0.5)*(TW-20), z=(rnd()-0.5)*(TD-14);
    if(dry(x,z)&&clear(x,z)) return {x,z};
  }
  // 4. last resort: sweep for the highest ground on the map
  let best={x:0,z:0,h:-1e9};
  for(let j=4;j<NZ-4;j+=2)for(let i=4;i<NX-4;i+=2){
    const x=-TW/2+i*(TW/NX), z=-TD/2+j*(TD/NZ), hh=heightAt(x,z);
    if(hh>best.h) best={x,z,h:hh};
  }
  return {x:best.x,z:best.z};
}
function teamAmmo(sq,team,isCamp){
  const a={};
  WEAPONS.forEach(w=>{
    let n=w.ammo;
    if(n!==Infinity&&team===0&&isCamp) n+=wLevel(w.id);   // upgrades carry spare rounds
    a[w.id]=n;
  });
  if(sq.some(m=>m.cls==='Engineer')) a.mine+=2;
  // special forces draw a double issue of their class special
  for(const m of sq){
    if(m.elite&&CLASS_SPECIAL[m.cls]&&a[CLASS_SPECIAL[m.cls]]!==Infinity)
      a[CLASS_SPECIAL[m.cls]]+=WEAPONS.find(w=>w.id===CLASS_SPECIAL[m.cls]).ammo;
  }
  return a;
}

/* camera rig */
const cam={yaw:0.5,pitch:0.42,dist:30,target:new THREE.Vector3(0,8,0),follow:null};
/* First person: sighting down the barrel of the direct-fire weapons. Blends in
   and out so switching weapons doesn't snap the view. */
const FPS_WEAPONS=['rifle','sniper','flame','mg'];
let fpsBlend=0, bombCamBlend=0;
/* ---- napalm: an alternate payload for the bomber ----
   Smaller burst, but it lays a burning patch that scorches anyone still standing
   in it when their turn comes round. Toggle with N while the Bomber is up. */
function toggleNapalm(){
  if(!B||currentWeapon().kind!=='strike') return;
  B.napalm=!B.napalm;
  sfx('beep');
  const h=activeHog();
  if(h) bubble(h,B.napalm?'Load the sticky stuff!':'Back to high explosive.');
}
function spawnFire(x,z,r,rounds){
  if(!B) return;
  const g=new THREE.Group();
  for(let i=0;i<14;i++){
    const a=Math.random()*Math.PI*2, d=Math.random()*r;
    const f=new THREE.Mesh(new THREE.ConeGeometry(0.5+Math.random()*0.6,1.6+Math.random()*1.4,6),
      new THREE.MeshBasicMaterial({color:i%3?0xff8a1e:0xffd23d,transparent:true,opacity:0.85}));
    const px=x+Math.cos(a)*d, pz=z+Math.sin(a)*d;
    f.position.set(px,heightAt(px,pz)+0.7,pz);
    g.add(f);
  }
  scene.add(g);
  B.fires.push({x,z,r,rounds,mesh:g,t:Math.random()*6});
}
function updateFires(dt){
  if(!B||!B.fires) return;
  for(const f of B.fires){
    f.t+=dt;
    f.mesh.children.forEach((c,i)=>{
      c.scale.y=0.75+Math.abs(Math.sin(f.t*4+i))*0.55;
      c.material.opacity=0.55+Math.abs(Math.sin(f.t*3+i*0.7))*0.35;
    });
  }
}
// burn anyone standing in a fire, then let the fires die down a round
function burnInFires(){
  if(!B||!B.fires||!B.fires.length) return;
  for(const h of B.hogs){
    if(h.dead||h.boat||h.ship) continue;
    for(const f of B.fires){
      if(Math.hypot(h.position.x-f.x,h.position.z-f.z)<f.r){
        damageHog(h,14,null,'fire');
        if(!h.dead) bubble(h,pick(['I\'m alight!','Hot hot hot!','Me bacon\'s crisping!']));
        break;
      }
    }
  }
  for(let i=B.fires.length-1;i>=0;i--){
    if(--B.fires[i].rounds<=0){ scene.remove(B.fires[i].mesh); B.fires.splice(i,1); }
  }
}

/* ---- bombsight: a stable top-down tactical view for calling in air strikes ---- */
function inBombView(){
  return !!B&&B.state==='action'&&!isAI(B.team)&&currentWeapon().kind==='strike';
}
// project the mouse through the camera onto the terrain
const bombRay=new THREE.Raycaster();
function groundUnderMouse(){
  bombRay.setFromCamera(mouseNDC,camera);
  const o=bombRay.ray.origin.clone(), d=bombRay.ray.direction.clone();
  if(d.y>-0.01) return null;
  const p=o.clone(), step=d.clone().multiplyScalar(1.5);
  for(let i=0;i<600;i++){
    p.add(step);
    if(p.y<heightAt(p.x,p.z)) return p;
    if(p.y<waterLevel-2) return p;
    if(Math.abs(p.x)>TW||Math.abs(p.z)>TD) return null;
  }
  return null;
}
function adsHeld(){ return mouseHeld||ltHeld; }
function wantsFPS(){
  if(!B||B.state!=='action'||isAI(B.team)) return false;
  if(!adsHeld()) return false;              // hold LMB / left trigger to sight up
  const h=activeHog();
  return !!h&&FPS_WEAPONS.includes(currentWeapon().id);
}
function updateCamera(dt){
  // Bombsight: lift to a fixed tactical view of the whole battlefield. Aiming a
  // distant ground point through the orbit camera was the hard part, so here the
  // camera holds still and you simply point at the map.
  if(inBombView()){
    bombCamBlend=Math.min(1,bombCamBlend+dt*3.5);
    const eye=new THREE.Vector3(0,336,124), look=new THREE.Vector3(0,6,0);
    if(bombCamBlend>=1){ camera.position.copy(eye); camera.lookAt(look); }
    else {
      camera.position.lerp(eye,bombCamBlend);
      const cur=new THREE.Vector3(cam.target.x,cam.target.y+2,cam.target.z);
      camera.lookAt(cur.lerp(look,bombCamBlend));
    }
    if(camera.fov!==55){ camera.fov=55; camera.updateProjectionMatrix(); }
    for(const g of B.hogs) if(g.mesh&&!g.dead) g.mesh.visible=true;
    return;
  }
  bombCamBlend=0;
  let want=cam.target;
  if(cam.follow&&cam.follow.position) want=cam.follow.position;
  cam.target.lerp(want.clone?want:cam.target,Math.min(1,dt*4));
  cam.pitch=clamp(cam.pitch,0.08,1.25);
  cam.dist=clamp(cam.dist,10,140);
  const target=wantsFPS()?1:0;
  fpsBlend+=(target-fpsBlend)*Math.min(1,dt*6);
  if(fpsBlend<0.002) fpsBlend=0;
  const cp=new THREE.Vector3(
    cam.target.x+Math.cos(cam.pitch)*Math.cos(cam.yaw)*cam.dist,
    cam.target.y+Math.sin(cam.pitch)*cam.dist,
    cam.target.z+Math.cos(cam.pitch)*Math.sin(cam.yaw)*cam.dist);
  const minY=heightAt(cp.x,cp.z)+1.6;
  if(cp.y<minY) cp.y=minY;
  if(fpsBlend>0.002){
    // sit just behind and above the hog's snout, looking along the aim azimuth
    const h=activeHog();
    if(h){
      const fw=camAzimuth();
      const eye=new THREE.Vector3(
        h.position.x-fw.x*0.5, h.position.y+2.35, h.position.z-fw.z*0.5);
      cp.lerp(eye,fpsBlend);
      const look=eye.clone().addScaledVector(fw,30);
      look.y=eye.y-Math.tan(cam.pitch-0.42)*30;
      cam.fpsLook=look;
      if(h.mesh) h.mesh.visible=fpsBlend<0.72;    // don't stare at your own bacon
    }
  } else {
    cam.fpsLook=null;
    for(const g of (B?B.hogs:[])) if(g.mesh&&!g.dead) g.mesh.visible=true;
  }
  if(shake>0){ cp.x+=(Math.random()-0.5)*shake; cp.y+=(Math.random()-0.5)*shake; cp.z+=(Math.random()-0.5)*shake; shake*=Math.pow(0.02,dt); if(shake<0.02) shake=0; }
  camera.position.copy(cp);
  if(cam.fpsLook&&fpsBlend>0.002){
    const orbit=new THREE.Vector3(cam.target.x,cam.target.y+2,cam.target.z);
    camera.lookAt(orbit.lerp(cam.fpsLook,fpsBlend));
  } else {
    camera.lookAt(cam.target.x,cam.target.y+2,cam.target.z);
  }
}
function aimDir(){ const d=new THREE.Vector3(); camera.getWorldDirection(d); return d; }
function camAzimuth(){ return new THREE.Vector3(-Math.cos(cam.yaw),0,-Math.sin(cam.yaw)); }
function aimDirBallistic(){
  const fw=camAzimuth(), p=B?B.aimPitch:0.5;
  return new THREE.Vector3(fw.x*Math.cos(p),Math.sin(p),fw.z*Math.cos(p)).normalize();
}
function crosshairDir(h){
  const from=camera.position.clone(), d=aimDir();
  const hit=rayGround(from,d);
  if(hit) return hit.sub(muzzle(h)).normalize();
  return d;
}

/* ================= BATTLE ================= */
function startBattle(cfg){
  disposeBattle();
  // the seed IS the battlefield: same seed, same terrain, same everything
  if(cfg.seed===undefined) cfg.seed=newSeed();
  craterLog=[]; blockSeq=0;        // ids must be reproducible from the seed too
  genTerrain(cfg.theme,cfg.seed);
  craterLog=[];                      // ignore anything the generator itself dug
  B={ cfg, hogs:[], projs:[], mines:[], parts:[], graves:[], planes:[], tracers:[],
      wind:0, state:'start', st:0, timer:45,
      team:Math.floor(rnd()*cfg.nats.length), idx:cfg.nats.map(()=>0),
      charging:false, power:0, sel:1, shotHurt:false, over:false,
      turns:0, round:1, sudden:false, earned:{kills:0,dmg:0}, fires:[], napalm:false,
      stats:cfg.nats.map(()=>blankStats()), shotTeam:null, shotHitFoe:false,
      ammo:cfg.squads.map((sq,t)=>teamAmmo(sq,t,cfg.campaign)), aiPlan:null };
  waterLevel=WATER_Y;
  for(let t=0;t<cfg.nats.length;t++){
    cfg.squads[t].forEach((m,i)=>{
      const spot=findSpawn(t,B.hogs);
      const x=spot.x, z=spot.z;
      const mesh=makePig(NATIONS[cfg.nats[t]].helm);
      const y=heightAt(x,z);
      mesh.position.set(x,y,z);
      mesh.rotation.y=t===0?0:Math.PI;
      scene.add(mesh);
      const hp=m.maxhp+(t===1?(cfg.hpBonus||0):0);
      const up=cfg.campaign?(t===0?(m.up||0):(cfg.foeUp||0)):0;
      const elite=!!(t===0&&cfg.campaign&&m.elite);
      if(elite) addBeret(mesh,NATIONS[cfg.nats[t]].helm);
      B.hogs.push({mesh,position:mesh.position,vel:new THREE.Vector3(),hp,maxhp:hp,
        name:m.name,cls:m.cls,rank:m.rank,team:t,dead:false,ref:m,grounded:true,tag:makeTag(m,t),
        up, elite, speedMul:hogSpeedMul(up)*(elite?1.15:1),
        armour:elite?Math.min(hogArmour(up),0.9):hogArmour(up),
        wades:elite&&m.cls==='Engineer'});
    });
  }
  newWind();
  buildTeamBoxes();
  $('hud').classList.remove('hidden'); $('tray').classList.remove('hidden');
  screenState='battle';
  beginTurn(true);
  if(!tutorialSeen()) laterInBattle(()=>showTutorial(0),2200);
}
function disposeBattle(){
  if(!B) return;
  for(const h of B.hogs){ scene.remove(h.mesh); h.tag.remove(); }
  for(const p of B.projs) scene.remove(p.mesh);
  for(const m of B.mines) scene.remove(m.mesh);
  for(const g of B.graves) scene.remove(g);
  for(const pl of B.planes) scene.remove(pl.mesh);
  for(const p of B.parts) scene.remove(p.mesh);
  if(B.fires) for(const f of B.fires) scene.remove(f.mesh);
  // hazards/loose decoration are owned by clearStructures(), not the battle object
  document.querySelectorAll('.bub').forEach(e=>e.remove());
  B=null;
}
function newWind(){ B.wind=(rnd()*2-1)*7;
  const f=$('windfill'), half=45*Math.min(1,Math.abs(B.wind)/7);
  if(B.wind>=0){ f.style.left='50%'; f.style.width=half+'px'; f.style.right='auto'; }
  else { f.style.right='50%'; f.style.width=half+'px'; f.style.left='auto'; }
}
/* Deferred work must only land in the battle that scheduled it. Guarding on
   `B && !B.over` isn't enough — B may by then be a *different* battle, so a
   stale salvo timer could end the new battle's first turn or drop a shell into
   it at the old coordinates. Capture the reference and check identity. */
function laterInBattle(fn,ms){
  const myB=B;
  return setTimeout(()=>{ if(B===myB&&B&&!B.over) fn(); },ms);
}
function sameBattle(myB){ return B===myB&&B&&!B.over; }
/* One record per side. "shots" counts trigger pulls, not individual rounds, so a
   machine-gun burst is one shot — which is what accuracy means to a player. */
function blankStats(){
  return {shots:0, hits:0, dmg:0, taken:0, kills:0, losses:0, tk:0, tkKills:0, mishap:0,
          drowned:0, best:0, blocks:0, vehicles:0, turns:0, wep:{}};
}
function ST(team){
  if(!B||!B.stats) return blankStats();
  return B.stats[team]||(B.stats[team]=blankStats());
}
/* Merge a battle's record into a running career total. */
function mergeStats(into,from){
  for(const k of ['shots','hits','dmg','taken','kills','losses','tk','tkKills',
                  'mishap','drowned','blocks','vehicles','turns'])
    into[k]=(into[k]||0)+(from[k]||0);
  into.best=Math.max(into.best||0,from.best||0);
  into.wep=into.wep||{};
  for(const w in (from.wep||{})) into.wep[w]=(into.wep[w]||0)+from.wep[w];
  return into;
}
const pct=(a,b)=>b>0?Math.round(a/b*100)+'%':'—';
const kd =(k,d)=>d>0?(k/d).toFixed(2):(k>0?k.toFixed(2):'0.00');
function favWeapon(s){
  let best=null,bn=0;
  for(const id in (s.wep||{})) if(s.wep[id]>bn){ bn=s.wep[id]; best=id; }
  const w=best&&WEAPONS.find(x=>x.id===best);
  return w?w.name+' ('+bn+')':'—';
}
function aliveHogs(t){ return B.hogs.filter(h=>h.team===t&&!h.dead); }
/* How many sides are in this battle. Everything used to assume two. */
function nTeams(){ return (B&&B.cfg&&B.cfg.nats.length)||2; }
/* Everyone who is not on your side. With six teams "the enemy" is no longer a
   single opposing squad, so every 1-h.team lookup routes through here. */
function foesOf(team){ return B.hogs.filter(h=>h.team!==team&&!h.dead); }
/* Which teams still have somebody standing. */
function livingTeams(){
  const out=[];
  for(let i=0;i<nTeams();i++) if(aliveHogs(i).length) out.push(i);
  return out;
}
/* Distinct colours so six squads can be told apart at a glance. The first two
   are the greens and reds the two-sided game already used. */
const TEAM_TINT=['#7fa24a','#b0532f','#5b83b8','#c8a13a','#8d5fa8','#3fa39a'];
const TEAM_NAME_TINT=['#e6f0cf','#f2cdb4','#cfe0f5','#f6e6bd','#e6d5f2','#c9efeb'];
function activeHog(){ const l=aliveHogs(B.team); return l.length?l[B.idx[B.team]%l.length]:null; }
function isAI(team){ return B.cfg.ai[team]; }
/* Hot-seat handover. With one human it would be pointless; with two or more it
   stops the next player seeing the last one's plans while the camera swings. */
function maybeHandover(){
  if(netOn()) return;                     // online, everyone is at their own screen
  if(!B||B.over||(B.cfg.humans||0)<2||isAI(B.team)) return;
  if(B.prevTeam===undefined||B.prevTeam===B.team) return;
  if(isAI(B.prevTeam)) return;                    // came from a CPU turn, no secret to keep
  const ov=$('passover'); if(!ov) return;
  const nat=NATIONS[B.cfg.nats[B.team]];
  $('passTeam').textContent=nat.team;
  $('passTeam').style.color=TEAM_TINT[B.team%TEAM_TINT.length];
  $('passName').textContent='Player '+(B.team+1)+' — '+nat.name;
  ov.classList.remove('hidden');
  B.paused=true;
}
function beginTurn(first){
  if(B.over) return;
  if(!first){
    // hand on to the next side that still has somebody standing, so a wiped-out
    // team is skipped rather than stalling the rotation on an empty squad
    let nx=B.team;
    for(let i=0;i<nTeams();i++){ nx=(nx+1)%nTeams(); if(aliveHogs(nx).length) break; }
    B.prevTeam=B.team; B.team=nx;
    const l=aliveHogs(B.team); if(l.length) B.idx[B.team]=(B.idx[B.team]+1)%l.length;
    B.turns++;
    burnInFires();                       // napalm scorches whoever is still in it
    const newRound=Math.floor(B.turns/nTeams())+1;   // a round is one go each
    if(newRound>B.round){
      B.round=newRound;
      if(B.round>=SUDDEN_DEATH_ROUND){
        if(!B.sudden){
          B.sudden=true;
          banner('SUDDEN DEATH','THE SWILL IS RISING — GET TO HIGH GROUND');
          speak('Sudden death! The swill is rising. Get to high ground!');
        } else {
          waterLevel+=SWILL_RISE;
          sfx('splash');
        }
      }
    }
  }
  newWind();
  B.state='start'; B.st=0; B.timer=45; B.shotHurt=false; B.aiPlan=null; B.charging=false; B.power=0; B.sel=1; B.aimPitch=0.5;
  B.aiMove=undefined; B.aiMoveEnd=undefined; B.aiBoard=null; B.aiAimAt=null;   // recomputed each AI turn
  B.strikeHeading=null; B.strikeTarget=null; B.bombCursor=null;   // re-aimed each turn
  // you have to re-man an emplacement each turn; vehicles you stay in
  for(const g of B.hogs) if(g.emplacement) g.emplacement=null;
  maybeHandover();
  // every other turn, quietly check that everybody still agrees on the world
  if(netOn()&&NETG.isHost&&B.turns>0&&B.turns%2===0) NETG.link.send({t:'hashreq'});
  const h=activeHog();
  if(h){
    if(h.cls==='Medic'&&h.hp<h.maxhp) h.hp=Math.min(h.maxhp,h.hp+4);
    // face + camera behind hog looking toward enemy centroid
    const foes=foesOf(B.team);
    if(foes.length){
      const c=foes.reduce((v,f)=>v.add(f.position),new THREE.Vector3()).multiplyScalar(1/foes.length);
      const az=Math.atan2(c.z-h.position.z,c.x-h.position.x);
      h.mesh.rotation.y=-az;
      cam.yaw=az+Math.PI; cam.pitch=0.42; cam.dist=30;
    }
    cam.follow=h.mesh;
    const nat=NATIONS[B.cfg.nats[h.team]];
    banner(nat.team, RANKS[h.rank].toUpperCase()+' '+h.name.toUpperCase()+"'S TURN");
    if(!isAI(B.team)&&Math.random()<0.45) bubble(h,pick(Q.turn));
  }
  buildTray(); updateHUD();
}

/* ================= HOG PHYSICS ================= */
let hogAcc=0;
function hogPhysics(h,dt){
  if(h.dead) return;
  // riding anything — the vehicle drives the position. Missing h.ship here left
  // carrier crew permanently "airborne", which hung the resolve phase forever.
  if(h.boat||h.tank||h.ship){ h.grounded=true; return; }
  const p=h.position, ground=surfaceY(p.x,p.z,p.y);
  if(h.grounded){
    if(p.y>ground+0.35){ h.grounded=false; }       // crater or roof gone from under us
    else p.y=ground;
  }
  if(!h.grounded){
    h.vel.y-=GRAV*dt;
    // step the fall so we can't drop straight through a thin roof slab
    const fall=Math.abs(h.vel.y*dt);
    const sub=Math.max(1,Math.ceil(fall/0.25));
    let landed=false;
    for(let s=0;s<sub&&!landed;s++){
      p.addScaledVector(h.vel,dt/sub);
      p.x=clamp(p.x,-TW/2+2,TW/2-2); p.z=clamp(p.z,-TD/2+2,TD/2-2);
      if(h.vel.y<=0&&p.y<=surfaceY(p.x,p.z,p.y+0.9)) landed=true;
    }
    const g2=surfaceY(p.x,p.z,p.y+0.9);
    if(landed&&h.vel.y<=0){
      p.y=g2;
      if(h.vel.y<-14) { damageHog(h,Math.round((-h.vel.y-14)*3),null,'fall'); if(!h.dead) bubble(h,pick(Q.fall)); }
      h.vel.set(0,0,0); h.grounded=true;
    }
  } else {
    // knockback slide
    if(h.vel.lengthSq()>0.05){
      p.x=clamp(p.x+h.vel.x*dt,-TW/2+2,TW/2-2);
      p.z=clamp(p.z+h.vel.z*dt,-TD/2+2,TD/2-2);
      p.y=heightAt(p.x,p.z);
      h.vel.multiplyScalar(Math.pow(0.02,dt));
    }
  }
  if(!h.dead&&p.y<waterLevel-(h.wades?2.6:0.5)) drown(h);
}
function walkHog(h,dirX,dirZ,dt){
  if(!h.grounded) return;
  const sp=9*dt*(h.speedMul||1), p=h.position;
  const nx=clamp(p.x+dirX*sp,-TW/2+2,TW/2-2), nz=clamp(p.z+dirZ*sp,-TD/2+2,TD/2-2);
  // walk on terrain OR on top of building blocks (roofs, girders, sandbags)
  const hNew=surfaceY(nx,nz,p.y+1.2);
  if(hNew-p.y>1.5) return;               // too tall a step — jump for that
  // hogs can't swim — refuse to wade in rather than letting the player walk to
  // their death trying to reach a boat. Blasts can still throw you in.
  if(hNew<waterLevel-(h.wades?2.2:0.15)) return;   // Sapper Marines can wade deeper
  // is something solid occupying the space we'd be standing in?
  if(blockAt(new THREE.Vector3(nx,hNew+1.1,nz),0.45)) return;
  p.x=nx; p.z=nz;
  if(hNew<p.y-1.6){ h.grounded=false; h.vel.set(dirX*6,0,dirZ*6); }
  else p.y=hNew;
  h.mesh.rotation.y=-Math.atan2(dirZ,dirX);
  h.walkT=(h.walkT||0)+dt*10;
  h.mesh.position.y=p.y+Math.abs(Math.sin(h.walkT))*0.12;
}
function jumpHog(h){
  if(!h.grounded) return;
  const az=-h.mesh.rotation.y;
  h.grounded=false;
  h.vel.set(Math.cos(az)*5,11,Math.sin(az)*5);
}
function drown(h){
  h.dead=true; sfx('splash');
  if(B&&B.stats){ ST(h.team).drowned++; ST(h.team).losses++; }
  spawnParticles(h.position.clone().setY(waterLevel),14,0x7f9bb0,4);
  bubble(h,pick(Q.drown));
  sinkMesh(h.mesh);
  h.tag.style.display='none';
  fixIdx(h);
}
function sinkMesh(m){
  const t0=performance.now();
  (function s(){ m.position.y-=0.06; m.rotation.z+=0.02;
    if(performance.now()-t0<2500) requestAnimationFrame(s); else scene.remove(m); })();
}
function damageHog(h,amount,src,srcType){
  if(h.dead||amount<=0) return;
  if(srcType==='mine'&&h.cls==='Engineer') amount=Math.round(amount*0.5);
  if(h.armour&&h.armour!==1&&srcType!=='fall') amount=Math.round(amount*h.armour);
  if(h.tank&&srcType!=='tank') amount=Math.round(amount*0.35);   // buttoned up in armour
  if(amount<=0) return;
  h.hp-=amount;
  floatText(h.position,'-'+amount,'#f0e0b0');
  if(src&&src.team!==h.team){ B.shotHurt=true; B.shotHitFoe=true; }
  // damage dealt and taken, and friendly fire kept separate from the real thing
  if(src&&B.stats){
    if(src.team!==h.team) ST(src.team).dmg+=amount; else ST(src.team).tk+=amount;
  }
  if(B.stats) ST(h.team).taken+=amount;
  // bank swill marks for damage the player deals to the enemy
  if(B.earned&&src&&src.team===0&&h.team===1) B.earned.dmg+=amount;
  if(h.hp<=0){
    h.hp=0; h.dead=true;
    if(B.earned&&src&&src.team===0&&h.team===1) B.earned.kills++;
    if(B.stats){
      ST(h.team).losses++;
      if(src&&src.team!==h.team){
        ST(src.team).kills++;
        const r=src.position.distanceTo(h.position);
        if(r>ST(src.team).best) ST(src.team).best=Math.round(r);
      }
      else if(src) ST(src.team).tkKills++;      // shot by one of your own
      else ST(h.team).mishap++;                 // a fall, a fire, an unowned blast
    }
    bubble(h,pick(Q.death));
    const g=makeGrave(); g.position.copy(h.position); g.position.y=heightAt(h.position.x,h.position.z);
    scene.add(g); B.graves.push(g);
    spawnParticles(h.position,20,0xe8a0a8,6);
    scene.remove(h.mesh); h.tag.style.display='none';
    if(src&&!src.dead&&src.team!==h.team) laterInBattle(()=>{ if(!src.dead) bubble(src,pick(Q.kill)); },600);
    fixIdx(h);
  } else if(Math.random()<0.6&&(!src||src.team!==h.team)) bubble(h,pick(Q.hurt));
}
function fixIdx(h){ const l=aliveHogs(h.team); if(B.idx[h.team]>=l.length) B.idx[h.team]=0; }

/* ================= PROJECTILES & EXPLOSIONS ================= */
function makeShellMesh(type){
  if(type==='bomb'){                       // aerial bomb: fat body, nose cone, tail fins
    const g=new THREE.Group();
    const body=new THREE.Mesh(new THREE.CapsuleGeometry(0.42,1.0,4,10),
      new THREE.MeshStandardMaterial({color:0x3f4238,roughness:0.55,metalness:0.45}));
    g.add(body);
    const nose=new THREE.Mesh(new THREE.ConeGeometry(0.42,0.6,10),
      new THREE.MeshStandardMaterial({color:0x8a2f1f,roughness:0.6}));
    nose.position.y=1.0; g.add(nose);
    const finMat=new THREE.MeshStandardMaterial({color:0x2e3129,roughness:0.7,metalness:0.3,side:THREE.DoubleSide});
    for(let i=0;i<4;i++){
      const fin=new THREE.Mesh(new THREE.BoxGeometry(0.06,0.5,0.45),finMat);
      fin.position.y=-0.85; fin.rotation.y=i*Math.PI/2;
      fin.position.x=Math.cos(i*Math.PI/2)*0.24; fin.position.z=Math.sin(i*Math.PI/2)*0.24;
      g.add(fin);
    }
    return g;
  }
  if(type==='bazooka'||type==='shell'){
    const g=new THREE.Group();
    const sc=type==='shell'?1.9:1;    // artillery shells are noticeably heavier
    const b=new THREE.Mesh(new THREE.CylinderGeometry(0.22*sc,0.22*sc,1.1*sc,10),new THREE.MeshStandardMaterial({color:type==='shell'?0x6b6250:0x4a4636,roughness:0.6,metalness:type==='shell'?0.5:0}));
    g.add(b);
    const n=new THREE.Mesh(new THREE.ConeGeometry(0.22*sc,0.45*sc,10),new THREE.MeshStandardMaterial({color:0x8a2f1f,roughness:0.6}));
    n.position.y=0.77*sc; g.add(n);
    return g;
  }
  const colr=type==='cluster'?0x5c5822:type==='mine'?0x333126:type==='bomblet'?0x31302a:0x3d4a2a;
  return new THREE.Mesh(new THREE.SphereGeometry(type==='bomblet'?0.22:0.34,10,8),
    new THREE.MeshStandardMaterial({color:colr,roughness:0.7}));
}
function spawnProj(type,pos,vel,opts){
  const mesh=makeShellMesh(type);
  mesh.position.copy(pos); scene.add(mesh);
  mesh.traverse(o=>{ if(o.isMesh) o.castShadow=true; });
  B.projs.push({type,mesh,position:mesh.position,vel:vel.clone(),age:0,...opts});
}
function stepProjPhysics(p,dt){
  p.age+=dt;
  if(p.windAcc) p.vel.x+=p.windAcc*dt;
  p.vel.y-=GRAV*dt;
  // Substeps must be finer than the thinnest thing they can hit. Roof slabs are
  // only ~0.22 thick, so the old 0.8 stride let fast bombs tunnel through them.
  const steps=Math.max(1,Math.ceil(p.vel.length()*dt/0.18));
  for(let s=0;s<steps;s++){
    p.position.addScaledVector(p.vel,dt/steps);
    const {x,y,z}=p.position;
    if(Math.abs(x)>TW/2+30||Math.abs(z)>TD/2+30||y<-30) return {t:'gone'};
    if(y<waterLevel&&heightAt(x,z)<waterLevel) return {t:'splash'};
    const g=heightAt(x,z);
    if(y<=g){
      if(p.bounce){
        p.position.y=g+0.05;
        const n=normalAt(x,z);
        p.vel.reflect(n).multiplyScalar(0.42);
        if(p.vel.length()<2){ p.vel.set(0,0,0);
          if(p.type==='mine') return {t:'rest'}; }
        continue;
      }
      return {t:'explode'};
    }
    const bh=blockAt(p.position,0.12);
    if(bh){
      if(p.bounce){
        const m=bh.b.mesh.position,hf=bh.b.half;
        const dx=(p.position.x-m.x)/hf.x, dy=(p.position.y-m.y)/hf.y, dz2=(p.position.z-m.z)/hf.z;
        const ax=Math.abs(dx),ay=Math.abs(dy),az=Math.abs(dz2);
        if(ax>=ay&&ax>=az){ p.vel.x*=-0.42; p.position.x=m.x+Math.sign(dx)*(hf.x+0.16); }
        else if(ay>=az){ p.vel.y*=-0.42; p.position.y=m.y+Math.sign(dy)*(hf.y+0.16); }
        else { p.vel.z*=-0.42; p.position.z=m.z+Math.sign(dz2)*(hf.z+0.16); }
        p.vel.multiplyScalar(0.85);
        if(p.vel.length()<2&&p.type==='mine') return {t:'rest'};
        continue;
      }
      return {t:'explode'};
    }
    if(!p.bounce){
      for(const h of B.hogs){ if(h.dead) continue;
        if(h===p.owner&&p.age<0.35) continue;
        if(p.position.distanceTo(h.position.clone().setY(h.position.y+1))<1.5) return {t:'explode'}; }
    }
  }
  if(p.fuse!=null){ p.fuse-=dt; if(p.fuse<=0) return {t:'explode'}; }
  // orient shells along velocity
  if(p.type==='bazooka'||p.type==='bomb'||p.type==='shell'){
    const v=p.vel.clone().normalize();
    p.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),v);
  }
  return null;
}
function spawn3DExplosion(x,y,z,radius,sceneRef=scene){
  const flash=new THREE.PointLight(0xffaa00,15,radius*5);
  flash.position.set(x,y,z); sceneRef.add(flash);
  const geo=new THREE.SphereGeometry(radius*0.3,16,16);
  const mat=new THREE.MeshBasicMaterial({color:0xff6600,transparent:true,opacity:1});
  const fireball=new THREE.Mesh(geo,mat);
  fireball.position.set(x,y,z); sceneRef.add(fireball);
  if(!window.activeExplosions) window.activeExplosions=[];
  window.activeExplosions.push({light:flash,mesh:fireball,life:1.0});
}
function spawnParticles(pos,n,color,speed){
  for(let i=0;i<n;i++){
    const m=new THREE.Mesh(new THREE.TetrahedronGeometry(0.22+Math.random()*0.3),
      new THREE.MeshStandardMaterial({color,roughness:0.9,transparent:true}));
    m.position.copy(pos);
    scene.add(m);
    B.parts.push({mesh:m,vel:new THREE.Vector3((Math.random()-0.5)*speed*2,Math.random()*speed,(Math.random()-0.5)*speed*2),life:0.9+Math.random()*0.8});
  }
}
function boomFX(pos,r){
  if(!B) return;
  sfx('boom'); shake=Math.max(shake,Math.min(6.5,r*0.65));
  spawn3DExplosion(pos.x,pos.y+0.2,pos.z,r,scene);
  spawnParticles(pos,38,0xffcc00,r*1.9);
  spawnParticles(pos,18,0xff6600,r*1.4);
  spawnParticles(pos,16,0x4a4636,r*0.95);
  spawnParticles(pos,12,0xe8b24a,r*1.1);
  // smoke plume
  for(let i=0;i<5;i++){
    const s=new THREE.Mesh(new THREE.SphereGeometry(0.7+Math.random()*0.7,8,6),
      new THREE.MeshBasicMaterial({color:i%2?0x3c362c:0x55503f,transparent:true,opacity:0.55}));
    s.position.copy(pos).add(new THREE.Vector3((Math.random()-0.5)*1.5,i*0.7,(Math.random()-0.5)*1.5));
    scene.add(s);
    B.parts.push({mesh:s,smoke:true,vel:new THREE.Vector3((Math.random()-0.5)*1.2,2.4+Math.random()*1.6,(Math.random()-0.5)*1.2),life:1.7+Math.random()*0.9});
  }
  // ground shockwave ring
  const gy=heightAt(pos.x,pos.z);
  if(pos.y-gy<r*1.6){
    const sw=new THREE.Mesh(new THREE.RingGeometry(0.5,1.0,26),
      new THREE.MeshBasicMaterial({color:0xf0e0b0,transparent:true,opacity:0.75,side:THREE.DoubleSide,depthWrite:false}));
    sw.position.set(pos.x,gy+0.25,pos.z);
    sw.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1),normalAt(pos.x,pos.z));
    scene.add(sw);
    B.parts.push({mesh:sw,ring:true,life:0.55});
  }
  const light=new THREE.PointLight(0xffc060,200,r*9); light.position.copy(pos).y+=2; scene.add(light);
  setTimeout(()=>scene.remove(light),140);
  const flash=new THREE.Mesh(new THREE.SphereGeometry(1,14,10),
    new THREE.MeshBasicMaterial({color:0xf4de96,transparent:true,opacity:0.95}));
  flash.position.copy(pos); scene.add(flash);
  const t0=performance.now();
  (function f(){ const k=(performance.now()-t0)/240;
    if(k<1){ flash.scale.setScalar(1+k*r*1.25); flash.material.opacity=0.95*(1-k); requestAnimationFrame(f); }
    else scene.remove(flash); })();
}
const BLAST_SCALE=1.05;   // global explosion size tweak — every blast goes through here
function boom(pos,r,dmg,owner,srcType){
  r*=BLAST_SCALE;
  crater(pos.x,pos.z,r*1.25,r*0.62);
  damageStructures(pos,r);
  boomFX(pos,r);
  for(const h of B.hogs){
    if(h.dead) continue;
    const d=pos.distanceTo(h.position.clone().setY(h.position.y+1));
    if(d<r*1.9){
      const f=clamp(1-d/(r*2.1),0.12,1);
      let amount=Math.round(dmg*f);
      if(owner&&owner.cls==='Heavy') amount=Math.round(amount*1.25);
      const dir=h.position.clone().setY(h.position.y+1).sub(pos).normalize();
      h.grounded=false;
      h.vel.addScaledVector(dir,f*16); h.vel.y=Math.max(h.vel.y,f*11);
      h.position.y+=0.15;
      damageHog(h,amount,owner,srcType);
    }
  }
  // armour takes blast damage too, and brews up spectacularly
  for(const t of tanks){
    if(t.dead) continue;
    const d=Math.hypot(pos.x-t.x,pos.z-t.z);
    if(d<r*1.6+3) damageTank(t,Math.round(dmg*clamp(1-d/(r*2+4),0.15,1)),owner);
  }
  for(let i=hazards.length-1;i>=0;i--){
    const haz=hazards[i];
    if(haz.dead||srcType==='keg'&&haz.mesh===null) continue;
    const d=Math.hypot(pos.x-haz.x,pos.z-haz.z);
    if(d<r+4){
      const f=clamp(1-d/(r+8),0.1,1);
      haz.hp-=Math.round(dmg*f);
      if(haz.hp<=0){
        haz.dead=true; scene.remove(haz.mesh);
        // chain-react on a short fuse so dumps and kegs cook off in sequence
        const br=haz.blast||11, bd=haz.dmg||55, hx=haz.x, hy=haz.y, hz=haz.z;
        laterInBattle(()=>boom(new THREE.Vector3(hx,hy,hz),br,bd,owner,'keg'),
          haz.type==='ammo'?90:150);
      }
    }
  }
  for(const m of B.mines){ if(!m.boomed&&m.fuse==null&&pos.distanceTo(m.mesh.position)<r*1.6) m.fuse=0.35; }
}

/* ================= FIRING ================= */
const W=id=>WEAPONS.find(w=>w.id===id);
const CROSSHAIR_KINDS=['ray','strike','burst','flame','tele','build'];
/* What can this hog actually shoot right now? Crewing a tank or an emplacement
   replaces the whole kit with that weapon; otherwise it's general issue plus
   your own class special. */
function crewedWith(h){
  if(!h) return null;
  if(h.ship) return 'ship';                 // a destroyer's battery replaces your kit
  if(h.tank) return 'tank';
  if(h.emplacement) return h.emplacement.type;
  return null;
}
function canUse(w,h){
  const crew=crewedWith(h);
  if(crew) return w.crewOnly===crew;
  if(w.crewOnly==='boat') return !!(h&&h.boat);   // the boat gun ADDS to your kit
  if(w.crewOnly) return false;
  return !w.classOnly||(h&&w.classOnly===h.cls);
}
const BALLISTIC_KINDS=['shell','bounce','minetoss','howitzer'];
function currentWeapon(){
  const act=activeHog();
  return WEAPONS.filter(w=>canUse(w,act)).find(w=>w.key===String(B.sel))||W('bazooka');
}
function muzzle(h){ return h.position.clone().add(new THREE.Vector3(0,2.5,0)); }
/* shared hitscan used by the rifle-likes, the machine gun and the flamethrower */
function hitscan(h,dir,range,dmg,srcType,tol){
  const from=muzzle(h), p=from.clone(), step=dir.clone().multiplyScalar(0.6);
  let hit=null, end=null;
  for(let s=0;s<range/0.6;s++){
    p.add(step);
    if(p.y<heightAt(p.x,p.z)){ if(srcType!=='flame') crater(p.x,p.z,1.1,0.4); end=p.clone(); break; }
    const bh=blockAt(p,0.1);
    if(bh){ detachBlock(bh.bd,bh.b,p.clone().addScaledVector(dir,-3)); settleBuilding(bh.bd); end=p.clone(); break; }
    let done=false;
    for(const hh of B.hogs){ if(hh.dead||hh===h) continue;
      if(p.distanceTo(hh.position.clone().setY(hh.position.y+1))<(tol||1.3)){ hit=hh; end=p.clone(); done=true; break; } }
    if(done) break;
    if(Math.abs(p.x)>TW/2+40||Math.abs(p.z)>TD/2+40||p.y<-10){ end=p.clone(); break; }
  }
  if(srcType!=='flame') tracer(from,end||p);
  if(hit){
    let d=dmg; if(h.cls==='Spy'&&srcType!=='flame') d=Math.round(d*1.3);
    hit.grounded=false; hit.vel.addScaledVector(dir,2.2); hit.vel.y=Math.max(hit.vel.y,1.6);
    damageHog(hit,d,h,srcType);
  }
  return hit;
}
function muzzleFlash(h){
  const fl=new THREE.PointLight(0xffd080,70,20);
  fl.position.copy(muzzle(h)); scene.add(fl);
  setTimeout(()=>scene.remove(fl),90);
}
function fire(h,w,dir,speed){
  /* In a networked game a shot is the unit of truth: we send it, everyone runs
     it, and the deterministic simulation does the rest. Guard against echoing
     back an action we are in the middle of applying. */
  if(netOn()&&!NETG.applying){
    if(!iControl(h.team)) return;          // not our shot to take
    netSendAct(h,w,dir,speed);
  }
  // emplaced guns burn their own limited rounds, not your kit
  if(w.crewOnly&&h.emplacement){
    h.emplacement.shots--;
    if(h.emplacement.shots<=0){ h.emplacement=null; }
  }
  if(B.stats){
    const s=ST(h.team);
    s.shots++; s.wep[w.id]=(s.wep[w.id]||0)+1;
    B.shotTeam=h.team; B.shotHitFoe=false;
  }
  const a=B.ammo[h.team];
  const baseId=w.id;
  w=effW(w,h.team,B.cfg.campaign);          // fold in purchased upgrades
  w.id=baseId;                              // ammo is still tracked under the base id
  if(a[w.id]!==Infinity){ if(a[w.id]<=0) return; a[w.id]--; }
  h.mesh.rotation.y=-Math.atan2(dir.z,dir.x);
  if(w.kind==='heal'){
    const amt=h.cls==='Medic'?50:w.heal;
    h.hp=Math.min(h.maxhp,h.hp+amt); bubble(h,pick(Q.heal)); sfx('beep');
    floatText(h.position,'+'+amt,'#9fc46a');
    endAction(); return;
  }
  if(w.kind==='strike'){
    sfx('launch');
    // use the exact point the player was previewing, and the run heading they set
    let t=(!isAI(h.team)&&B.strikeTarget)?B.strikeTarget.clone()
         :(B.aiAimAt?B.aiAimAt.clone()
         :(rayGround(muzzle(h),dir)||h.position.clone().add(dir.clone().multiplyScalar(60))));
    // never let a bomb run land on the hog that called it in
    if(t.distanceTo(h.position)<22){
      const away=new THREE.Vector3(t.x-h.position.x,0,t.z-h.position.z);
      if(away.lengthSq()<0.01) away.set(1,0,0);
      t=h.position.clone().addScaledVector(away.normalize(),26);
      t.y=heightAt(t.x,t.z);
    }
    B.aiAimAt=null;
    let az;
    if(!isAI(h.team)&&B.strikeHeading!=null){
      az=new THREE.Vector3(Math.cos(B.strikeHeading),0,Math.sin(B.strikeHeading));
    } else {
      az=new THREE.Vector3(dir.x,0,dir.z).normalize();
    }
    if(az.lengthSq()<0.01) az.set(1,0,0);
    const start=t.clone().addScaledVector(az,-130); start.y=52;
    const plane=makePlaneMesh();
    plane.position.copy(start);
    plane.quaternion.setFromUnitVectors(new THREE.Vector3(1,0,0),az);
    scene.add(plane);
    B.planes.push({mesh:plane,az,target:t,dropped:false,owner:h,
      bombs:w.bombs||3, r:w.r||5.6, dmg:w.dmg||32, napalm:!!B.napalm});
    bubble(h,'Bomber inbound, danger close!');
    sfx('plane');
    endAction(); return;
  }
  if(w.kind==='squadheal'){      // MEDIC: patch up the whole surviving squad
    bubble(h,'Field hospital, coming up!');
    speak('Field hospital, coming up!');
    sfx('beep');
    for(const m of aliveHogs(h.team)){
      const amt=m===h?w.heal+10:w.heal;
      m.hp=Math.min(m.maxhp,m.hp+amt);
      floatText(m.position,'+'+amt,'#9fc46a');
      const halo=new THREE.Mesh(new THREE.RingGeometry(1.2,1.7,20),
        new THREE.MeshBasicMaterial({color:0x9fc46a,transparent:true,opacity:0.9,side:THREE.DoubleSide,depthWrite:false}));
      halo.position.copy(m.position).y+=0.3; halo.rotation.x=-Math.PI/2;
      scene.add(halo);
      B.parts.push({mesh:halo,ring:true,life:0.7});
    }
    endAction(); return;
  }
  if(w.kind==='tele'){           // SPY: vanish and reappear at the crosshair
    const t=(isAI(h.team)&&B.aiAimAt)?B.aiAimAt.clone()
           :(rayGround(camera.position.clone(),aimDir())||rayGround(muzzle(h),dir));
    B.aiAimAt=null;
    if(!t){ bubble(h,'Nowhere to slip away to!'); return; }
    if(a[w.id]!==Infinity) {} // ammo already decremented above
    bubble(h,pick(['Now you see me…','Cheerio!','Ta-ra!']));
    sfx('beep');
    spawnParticles(h.position.clone().setY(h.position.y+1),18,0x9ec6de,7);
    h.position.set(clamp(t.x,-TW/2+4,TW/2-4),0,clamp(t.z,-TD/2+4,TD/2-4));
    h.position.y=heightAt(h.position.x,h.position.z);
    h.vel.set(0,0,0); h.grounded=true;
    spawnParticles(h.position.clone().setY(h.position.y+1),18,0x9ec6de,7);
    cam.follow=h.mesh;
    endAction(); return;
  }
  if(w.kind==='build'){          // ENGINEER: drop a girder of hard cover
    const t=(isAI(h.team)&&B.aiAimAt)?B.aiAimAt.clone()
           :(rayGround(camera.position.clone(),aimDir())||rayGround(muzzle(h),dir));
    B.aiAimAt=null;
    if(!t){ bubble(h,'Cannot site it there!'); return; }
    bubble(h,'Get behind this!');
    sfx('beep');
    const bd=newBuilding(t.x,t.z);
    const y0=heightAt(t.x,t.z);
    let ry;
    if(isAI(h.team)){                     // face the wall at the nearest enemy
      const f=foesOf(h.team).slice().sort((a,b)=>
        t.distanceTo(a.position)-t.distanceTo(b.position))[0];
      ry=f?-Math.atan2(f.position.z-t.z,f.position.x-t.x):0;
    } else { const az=camAzimuth(); ry=-Math.atan2(az.z,az.x); }
    const steel=new THREE.MeshStandardMaterial({color:0x6b6f63,roughness:0.6,metalness:0.5,flatShading:true});
    for(let r=0;r<3;r++)
      for(let k=0;k<3;k++)
        bBlock(bd,t.x+Math.cos(ry+Math.PI/2)*(k-1)*1.7,y0+0.85+r*1.6,
                  t.z-Math.sin(ry+Math.PI/2)*(k-1)*1.7,1.7,1.6,0.9,steel,0,ry);
    endAction(); return;
  }
  if(w.kind==='burst'){          // machine gun: a rapid, spreading string of shots
    bubble(h,pick(["Give 'em the good news!",'Rat-a-tat-tat!','Eat lead, porker!']));
    let n=0;
    const myB=B;
    const rip=()=>{
      if(!sameBattle(myB)||n>=w.shots) return;
      const d=dir.clone();
      d.x+=(rnd()-0.5)*w.spread; d.y+=(rnd()-0.5)*w.spread*0.7; d.z+=(rnd()-0.5)*w.spread;
      hitscan(h,d.normalize(),w.range,w.dmg,'mg',1.1);
      sfx('mg'); muzzleFlash(h);
      n++; setTimeout(rip,70);
    };
    rip();
    laterInBattle(endAction, w.shots*70+260);
    B.state='firing';
    return;
  }
  if(w.kind==='flame'){          // flamethrower: short cone, lots of little burning ticks
    bubble(h,pick(['Crackling, anyone?','Toasty!','Roast pork tonight!']));
    sfx('flame');
    let n=0;
    const myB=B;
    const lick=()=>{
      if(!sameBattle(myB)||n>=w.ticks) return;
      const d=dir.clone();
      d.x+=(rnd()-0.5)*w.cone; d.y+=(rnd()-0.5)*w.cone*0.6+0.02; d.z+=(rnd()-0.5)*w.cone;
      d.normalize();
      const reach=w.range*(0.55+rnd()*0.45);
      const tip=muzzle(h).addScaledVector(d,reach*0.5);
      // visible flame puff
      const f=new THREE.Mesh(new THREE.SphereGeometry(0.55+Math.random()*0.6,7,6),
        new THREE.MeshBasicMaterial({color:n%3?0xff8a1e:0xffd23d,transparent:true,opacity:0.85}));
      f.position.copy(muzzle(h)).addScaledVector(d,1.2);
      scene.add(f);
      B.parts.push({mesh:f,smoke:true,vel:d.clone().multiplyScalar(15+Math.random()*8),life:0.45+Math.random()*0.25});
      hitscan(h,d,reach,w.dmg,'flame',1.9);
      if(n%4===0) sfx('flame');
      n++; setTimeout(lick,45);
    };
    lick();
    laterInBattle(endAction, w.ticks*45+420);
    B.state='firing';
    return;
  }
  if(w.kind==='howitzer'){       // field gun: wheels up beside the hog and lobs heavy shells
    // a warship already has turrets — don't wheel a field gun onto her deck
    const shipboard=!!h.ship;
    bubble(h,shipboard?'Air wing, cleared hot!':'Fire mission, over!');
    speak(shipboard?'Air wing, cleared hot!':'Fire mission, over!');
    const back=dir.clone().setY(0).normalize();
    let gun=null;
    if(!shipboard){
      gun=makeFieldGun();
      gun.position.copy(h.position).addScaledVector(back,-2.4);
      gun.position.y=heightAt(gun.position.x,gun.position.z);
      gun.rotation.y=-Math.atan2(dir.z,dir.x);
      scene.add(gun); loose.push(gun);
    }
    let n=0;
    const myB=B;
    const salvo=()=>{
      if(!sameBattle(myB)||n>=w.shells) return;
      const d=dir.clone();
      d.x+=(rnd()-0.5)*w.spread; d.y+=(rnd()-0.5)*w.spread*0.55; d.z+=(rnd()-0.5)*w.spread;
      d.normalize();
      // fire from the wheeled gun if there is one, otherwise from the ship's turret line
      const origin=gun?gun.position.clone().add(new THREE.Vector3(0,2.1,0)):muzzle(h);
      spawnProj('shell', origin.addScaledVector(d,2.4),
        d.multiplyScalar(speed*1.06),
        {owner:h, windAcc:B.wind, bounce:false, fuse:null, r:w.r, dmg:w.dmg});
      cam.follow=B.projs[B.projs.length-1].mesh;   // track the newest shell of the salvo
      sfx('boom'); shake=Math.max(shake,shipboard?2.1:1.3);
      if(gun){                                   // recoil kick on the wheeled gun
        gun.position.addScaledVector(back,-0.55);
        setTimeout(()=>{ if(gun.parent) gun.position.addScaledVector(back,0.55); },140);
      }
      n++; setTimeout(salvo,620);
    };
    salvo();
    setTimeout(()=>{
      if(gun){ const i=loose.indexOf(gun); if(i>=0) loose.splice(i,1); scene.remove(gun); }
      if(sameBattle(myB)) endAction();
    }, w.shells*620+900);
    B.state='firing';
    return;
  }
  if(w.kind==='ray'){
    sfx('shot'); muzzleFlash(h);
    let pos=muzzle(h), hit=null, end=null;
    const step=dir.clone().multiplyScalar(0.6);
    const p=pos.clone();
    for(let s=0;s<w.range/0.6;s++){
      p.add(step);
      if(p.y<heightAt(p.x,p.z)){ crater(p.x,p.z,1.6,0.7); end=p.clone(); break; }
      const bh=blockAt(p,0.1);
      if(bh){ detachBlock(bh.bd,bh.b,p.clone().sub(dir.clone().multiplyScalar(3)));
        settleBuilding(bh.bd); end=p.clone(); break; }
      let done=false;
      for(const hh of B.hogs){ if(hh.dead||hh===h) continue;
        if(p.distanceTo(hh.position.clone().setY(hh.position.y+1))<1.3){ hit=hh; end=p.clone(); done=true; break; } }
      if(done) break;
      if(Math.abs(p.x)>TW/2+40||Math.abs(p.z)>TD/2+40||p.y<-10){ end=p.clone(); break; }
    }
    end=end||p;
    tracer(pos,end);
    if(hit){ let d=w.dmg; if(h.cls==='Spy') d=Math.round(d*1.3);
      hit.grounded=false; hit.vel.addScaledVector(dir,6); hit.vel.y=Math.max(hit.vel.y,4);
      damageHog(hit,d,h,'ray'); }
    endAction(); return;
  }
  sfx('launch'); muzzleFlash(h);
  spawnProj(w.id,muzzle(h).addScaledVector(dir,1.4),dir.clone().multiplyScalar(speed),{
    owner:h, windAcc:w.wind?B.wind:0, bounce:w.kind==='bounce'||w.kind==='minetoss',
    fuse:w.kind==='bounce'?w.fuse:null, r:w.r, dmg:w.dmg, cluster:!!w.cluster});
  cam.follow=B.projs[B.projs.length-1].mesh;
  endAction();
}
function rayGround(from,dir){
  const p=from.clone(), step=dir.clone().multiplyScalar(1.2);
  for(let s=0;s<400;s++){ p.add(step);
    if(p.y<heightAt(p.x,p.z)) return p;
    if(Math.abs(p.x)>TW/2+60||Math.abs(p.z)>TD/2+60||p.y<-20) return null; }
  return null;
}
function makeFieldGun(){
  const g=new THREE.Group();
  const steel=new THREE.MeshStandardMaterial({color:0x53584a,roughness:0.55,metalness:0.6});
  const dark =new THREE.MeshStandardMaterial({color:0x393d34,roughness:0.7,metalness:0.4});
  const barrel=new THREE.Mesh(new THREE.CylinderGeometry(0.26,0.32,4.2,12),steel);
  barrel.rotation.z=-Math.PI/2+0.42; barrel.position.set(1.5,1.85,0); g.add(barrel);
  const brake=new THREE.Mesh(new THREE.CylinderGeometry(0.36,0.36,0.5,12),dark);
  brake.rotation.z=-Math.PI/2+0.42; brake.position.set(3.28,2.68,0); g.add(brake);
  const breech=new THREE.Mesh(new THREE.BoxGeometry(1.1,0.9,0.9),dark);
  breech.position.set(0.35,1.35,0); g.add(breech);
  const shield=new THREE.Mesh(new THREE.BoxGeometry(0.16,1.5,2.6),steel);
  shield.position.set(-0.1,1.35,0); shield.rotation.z=0.12; g.add(shield);
  for(const s of [-1,1]){
    const wheel=new THREE.Mesh(new THREE.CylinderGeometry(0.85,0.85,0.26,14),dark);
    wheel.rotation.x=Math.PI/2; wheel.position.set(0,0.85,s*1.35); g.add(wheel);
    const trail=new THREE.Mesh(new THREE.BoxGeometry(2.6,0.22,0.22),steel);
    trail.position.set(-1.5,0.5,s*0.5); trail.rotation.z=-0.14; g.add(trail);
  }
  g.traverse(o=>{ if(o.isMesh){ o.castShadow=true; o.receiveShadow=true; } });
  return g;
}
function makePlaneMesh(){
  const g=new THREE.Group();
  const mat=new THREE.MeshStandardMaterial({color:0x2e3238,roughness:0.42,metalness:0.55,flatShading:true});
  const dark=new THREE.MeshStandardMaterial({color:0x1e2126,roughness:0.5,metalness:0.5,flatShading:true});
  // blended flying wing: a wide swept delta with a low centre body
  const wing=new THREE.Mesh(new THREE.ConeGeometry(7.2,9.5,3),mat);
  wing.rotation.x=Math.PI/2; wing.rotation.z=-Math.PI/2;
  wing.scale.set(1,1,0.16); g.add(wing);
  const body=new THREE.Mesh(new THREE.BoxGeometry(4.6,0.95,2.1),mat);
  body.position.set(-0.6,0.2,0); g.add(body);
  const cockpit=new THREE.Mesh(new THREE.SphereGeometry(0.72,10,7),dark);
  cockpit.scale.set(1.5,0.5,0.85); cockpit.position.set(1.5,0.5,0); g.add(cockpit);
  for(const s of [-1,1]){                       // buried exhausts
    const ex=new THREE.Mesh(new THREE.BoxGeometry(1.5,0.4,0.85),dark);
    ex.position.set(-2.6,0.35,s*1.15); g.add(ex);
  }
  g.traverse(o=>{ if(o.isMesh) o.castShadow=true; });
  g.scale.setScalar(1.25);
  return g;
}
function tracer(a,b){
  const g=new THREE.BufferGeometry().setFromPoints([a,b]);
  const l=new THREE.Line(g,new THREE.LineBasicMaterial({color:0xf0dc96,transparent:true,opacity:0.9}));
  scene.add(l); B.tracers.push({mesh:l,life:0.25});
}
function endAction(){ B.state='resolve'; B.st=0; B.charging=false; B.power=0;
  trajPts.visible=false; impactRing.visible=false; aimDot.visible=false; strikeMarker.visible=false;
  $('crosshair').classList.remove('hot'); buildTray(); }

/* ================= AI ================= */
function simShot(from,dir,speed,windAcc,bounceOpts){
  const p=from.clone(), v=dir.clone().multiplyScalar(speed);
  const dt=PHYS_DT; let fuse=bounceOpts?bounceOpts.fuse:null;
  for(let s=0;s<620;s++){
    if(windAcc) v.x+=windAcc*dt;
    v.y-=GRAV*dt;
    p.addScaledVector(v,dt);
    if(Math.abs(p.x)>TW/2+30||Math.abs(p.z)>TD/2+30||p.y<-25) return null;
    if(p.y<waterLevel&&heightAt(p.x,p.z)<waterLevel) return {pos:p.clone(),water:true};
    const g=heightAt(p.x,p.z);
    if(p.y<=g){
      if(bounceOpts){ p.y=g+0.05; v.reflect(normalAt(p.x,p.z)).multiplyScalar(0.42);
        if(v.length()<2) return {pos:p.clone()}; }
      else return {pos:p.clone()};
    }
    else if(blockAt(p,0.12)){ if(!bounceOpts) return {pos:p.clone()};
      v.multiplyScalar(-0.4); }
    if(fuse!=null){ fuse-=dt; if(fuse<=0) return {pos:p.clone()}; }
  }
  return {pos:p.clone()};
}
/* Where should this hog reposition to before shooting? Samples directions around
   the hog and scores them on high ground, sane engagement range, cover and — once
   the swill is rising — getting out of the flood. Returns null to hold position. */
/* Is this emplacement already manned? Nothing else tracks that — the player
   just sets h.emplacement — so ask the hogs. */
function empManned(e){ return B.hogs.some(x=>!x.dead&&x.emplacement===e); }
/* Walk to the nearest piece of hardware worth crewing. Returns a move order the
   turn driver follows instead of a tactical reposition. */
function planAIBoard(h){
  if(h.tank||h.boat||h.ship||h.emplacement) return null;
  const foes=foesOf(h.team);
  if(!foes.length||!h.grounded) return null;
  const keen=difficulty==='hard'?0.92:difficulty==='easy'?0.35:0.7;
  if(Math.random()>keen) return null;
  const flooding=B.sudden&&heightAt(h.position.x,h.position.z)<waterLevel+7;
  const near=foes.slice().sort((a,b)=>
    h.position.distanceTo(a.position)-h.position.distanceTo(b.position))[0];
  const REACH=26;                      // about what a hog crosses in one turn
  const cand=[];
  const add=(o,worth,range)=>{
    const d=Math.hypot(o.x-h.position.x,o.z-h.position.z);
    if(d>REACH) return;
    // no point walking to a gun that cannot reach anybody
    cand.push({o,range,sc:worth-d*0.8+Math.random()*4,d});
  };
  for(const t of tanks) if(!t.rider&&!t.dead) add(t,34,BOARD_RANGE);
  for(const e of emplacements) if(e.shots>0&&!empManned(e))
    add(e,(e.type==='arty'?24:17)+(Math.hypot(e.x-near.position.x,e.z-near.position.z)<110?6:-12),6);
  // boats are worth a walk only when the water is the problem
  for(const b of boats) if(!b.rider) add(b,flooding?30:2,BOARD_RANGE);
  const best=cand.sort((a,b)=>b.sc-a.sc)[0];
  if(!best||best.sc<=0) return null;
  return {o:best.o,range:best.range*0.85,time:Math.min(3.5,best.d/9+0.6)};
}
function planAIMove(h){
  const foes=foesOf(h.team);
  if(!foes.length||!h.grounded) return null;
  const moveChance=difficulty==='easy'?0.35:difficulty==='hard'?0.85:0.6;
  const flooding=B.sudden&&heightAt(h.position.x,h.position.z)<waterLevel+7;
  if(!flooding&&Math.random()>moveChance) return null;
  const nearest=foes.slice().sort((a,b)=>
    h.position.distanceTo(a.position)-h.position.distanceTo(b.position))[0];
  const here=h.position, curH=heightAt(here.x,here.z);
  const curD=Math.hypot(here.x-nearest.position.x,here.z-nearest.position.z);
  let best=null;
  for(let i=0;i<12;i++){
    const a=i/12*Math.PI*2+Math.random()*0.2;
    const dx=Math.cos(a), dz=Math.sin(a);
    const step=7+Math.random()*5;
    const nx=clamp(here.x+dx*step,-TW/2+5,TW/2-5);
    const nz=clamp(here.z+dz*step,-TD/2+5,TD/2-5);
    const nh=heightAt(nx,nz);
    if(nh<waterLevel+2.4&&!h.boat&&!h.ship) continue;                // don't wade in
    if(Math.abs(nh-curH)>(h.tank?1.6:6)) continue;                   // tanks can't take the banks
    if(blockAt(new THREE.Vector3(nx,nh+1.2,nz),1.3)) continue;       // walled off
    const d=Math.hypot(nx-nearest.position.x,nz-nearest.position.z);
    // score the CHANGE, not the absolute distance — otherwise every option looks
    // bad from long range and the hog just stands there
    let sc=(nh-curH)*(flooding?5.5:1.6);                             // seek high ground
    if(curD>70)      sc+=(curD-d)*0.55;                              // close the range
    else if(curD<22) sc+=(d-curD)*0.6;                               // break contact
    else             sc+=4-Math.abs(d-45)*0.06;                      // hold the sweet spot
    sc+=Math.random()*2.5;
    if(!best||sc>best.sc) best={sc,dx,dz};
  }
  if(!best||(best.sc<=0&&!flooding)) return null;
  return {dx:best.dx,dz:best.dz,time:0.7+Math.random()*0.9};
}
/* Nudge a direction by the difficulty's aim error. */
function jitter(dir,err){
  const d=dir.clone();
  d.applyAxisAngle(new THREE.Vector3(0,1,0),(Math.random()-0.5)*err*1.4);
  d.y+=(Math.random()-0.5)*err*0.6;
  return d.normalize();
}
/* The trajectory search, lifted out of planAI so a crewed gun can use it too. */
function solveArc(from,tpos,az,w,friends){
  let best=null;
  for(let el=0.12;el<=1.32;el+=(B.cfg.elStep||0.10)){
    for(const sp of [18,24,30,36,42,48]){
      const dir=new THREE.Vector3(Math.cos(az)*Math.cos(el),Math.sin(el),Math.sin(az)*Math.cos(el));
      const res=simShot(from,dir,sp,w.wind?B.wind:0,w.kind==='bounce'?{fuse:w.fuse}:null);
      if(!res) continue;
      let sc=res.pos.distanceTo(tpos)+(res.water?60:0);
      for(const fr of friends){ if(res.pos.distanceTo(fr.position)<10) sc+=200; }
      if(!best||sc<best.score) best={score:sc,w,dir,sp};
    }
  }
  if(!best) return null;
  const err=B.cfg.aiErr;
  best.dir=jitter(best.dir,err);
  best.sp=clamp(best.sp+(Math.random()-0.5)*err*14,12,50);
  return best;
}
/* Somewhere high, dry, and a sensible distance from the enemy. */
function pickTeleSpot(h,foes){
  let best=null;
  for(let i=0;i<48;i++){
    const x=(Math.random()-0.5)*(TW-24), z=(Math.random()-0.5)*(TD-24);
    const y=heightAt(x,z);
    if(y<waterLevel+4) continue;
    if(blockAt(new THREE.Vector3(x,y+1.2,z),1.3)) continue;
    const d=Math.min(...foes.map(f=>Math.hypot(x-f.position.x,z-f.position.z)));
    const sc=y*1.4-Math.abs(d-34)*0.5;
    if(!best||sc>best.sc) best={sc,v:new THREE.Vector3(x,y,z)};
  }
  return best?best.v:null;
}
function planAI(h){
  const foes=foesOf(h.team), friends=aliveHogs(h.team);
  if(!foes.length) return null;
  const am=B.ammo[h.team];
  const crew=crewedWith(h);
  if(!crew&&h.hp<32&&am.medikit>0&&Math.random()<0.5)
    return {w:W('medikit'),dir:new THREE.Vector3(1,0,0)};
  const target=foes.slice().sort((a,b)=>(a.hp*1.5+h.position.distanceTo(a.position)*0.35)-(b.hp*1.5+h.position.distanceTo(b.position)*0.35))[0];
  const from=muzzle(h);
  const tpos=target.position.clone().setY(target.position.y+1);
  const az=Math.atan2(tpos.z-from.z,tpos.x-from.x);
  const range=from.distanceTo(tpos);
  // does the hog have a clean line to the target? (terrain AND buildings)
  const losDir=tpos.clone().sub(from).normalize();
  let clearLOS=true;
  {
    const p=from.clone();
    for(let s=0;s<700;s++){
      p.addScaledVector(losDir,0.7);
      if(p.distanceTo(tpos)<1.4) break;
      if(p.y<heightAt(p.x,p.z)||blockAt(p,0.1)){ clearLOS=false; break; }
      if(Math.abs(p.x)>TW/2+40||Math.abs(p.z)>TD/2+40){ clearLOS=false; break; }
    }
  }
  /* Crewing a tank, a gun pit or the destroyer replaces the whole kit with that
     one weapon, so there is nothing to choose — only an arc to solve. */
  if(crew){
    const cw=WEAPONS.find(w=>w.crewOnly===crew);
    if(!cw) return {w:W('rifle'),dir:losDir};
    if(cw.kind==='burst') return {w:cw,dir:jitter(losDir,B.cfg.aiErr*0.6)};
    const sol=solveArc(from,tpos,az,cw,friends);
    if(sol) return sol;
    return {w:cw,dir:new THREE.Vector3(Math.cos(az)*0.8,0.6,Math.sin(az)*0.8).normalize(),sp:30};
  }
  // MEDIC: the field hospital is worth more than any shot once the squad is cut up
  if(h.cls==='Medic'&&am.hospital>0&&
     friends.filter(f=>f.hp<f.maxhp*0.62).length>=2&&Math.random()<0.75)
    return {w:W('hospital'),dir:new THREE.Vector3(1,0,0)};
  // SPY: slip away from rising water or a losing position
  if(h.cls==='Recon'&&am.tele>0&&
     ((B.sudden&&heightAt(h.position.x,h.position.z)<waterLevel+5)||h.hp<38)&&Math.random()<0.7){
    const spot=pickTeleSpot(h,foes);
    if(spot) return {w:W('tele'),dir:losDir,aimAt:spot};
  }
  // ENGINEER: throw up hard cover when caught in the open and hurt
  if(h.cls==='Engineer'&&am.girder>0&&clearLOS&&h.hp<h.maxhp*0.55&&range<70&&Math.random()<0.5){
    const g=h.position.clone().addScaledVector(
      new THREE.Vector3(tpos.x-h.position.x,0,tpos.z-h.position.z).normalize(),4.2);
    g.y=heightAt(g.x,g.z);
    return {w:W('girder'),dir:losDir,aimAt:g};
  }
  // direct-fire choices, closest bracket first
  if(h.boat&&clearLOS&&range<90&&Math.random()<0.7) return {w:W('boatgun'),dir:jitter(losDir,B.cfg.aiErr*0.6)};
  if(clearLOS&&am.flame>0&&range<22&&Math.random()<0.8) return {w:W('flame'),dir:losDir};
  if(clearLOS&&am.mg>0&&range<80&&Math.random()<0.6)   return {w:W('mg'),dir:losDir};

  let best={score:1e9};
  const types=[W('bazooka')];
  if(am.grenade>0) types.push(W('grenade'));
  if(am.arty>0) types.push(W('arty'));      // the field gun lobs like a heavy bazooka
  if(h.cls==='Assault'&&am.sowzooka>0) types.push(W('sowzooka'));   // the class special
  for(const w of types){
    for(let el=0.15;el<=1.35;el+=(B.cfg.elStep||0.10)){   // coarser search on easier settings
      for(const sp of [16,22,28,34,40,46]){
        const dir=new THREE.Vector3(Math.cos(az)*Math.cos(el),Math.sin(el),Math.sin(az)*Math.cos(el));
        const res=simShot(from,dir,sp,w.wind?B.wind:0,w.kind==='bounce'?{fuse:w.fuse}:null);
        if(!res) continue;
        let sc=res.pos.distanceTo(tpos)+(res.water?60:0);
        for(const fr of friends){ if(res.pos.distanceTo(fr.position)<10) sc+=200; }
        if(sc<best.score) best={score:sc,w,dir,sp};
      }
    }
  }
  // sniper if clear LOS
  if(clearLOS&&am.sniper>0&&Math.random()<(B.cfg.sniperChance!=null?B.cfg.sniperChance:0.4))
    return {w:W('sniper'),dir:losDir};
  // Call in bombers on the target's actual position. Previously this only passed
  // a direction and fire() raycast along it — from high ground that ray hit the
  // AI's own hillside a metre away, so it bombed itself.
  if(am.strike>0&&(best.score>13||!clearLOS)&&Math.random()<0.75)
    return {w:W('strike'),dir:target.position.clone().sub(from).normalize(),
            aimAt:target.position.clone()};
  if(best.score>=1e9) return {w:W('bazooka'),dir:new THREE.Vector3(Math.cos(az)*0.8,0.6,Math.sin(az)*0.8).normalize(),sp:26};
  const err=B.cfg.aiErr;
  const e1=(Math.random()-0.5)*err*1.4, e2=(Math.random()-0.5)*err*1.4;
  best.dir.applyAxisAngle(new THREE.Vector3(0,1,0),e1);
  best.dir.y+=e2*0.5; best.dir.normalize();
  best.sp=clamp(best.sp+(Math.random()-0.5)*err*14,12,50);
  return best;
}

/* ================= DOM: tags, bubbles, banner, HUD ================= */
/* Markers over usable hardware. Without these you'd have to stumble across a
   tank by accident, which is exactly how they went unused. */
let assetTags=[];
function clearAssetTags(){ for(const a of assetTags) a.el.remove(); assetTags=[]; }
function buildAssetTags(){
  clearAssetTags();
  const holder=$('tags'); if(!holder) return;
  const add=(obj,label,cls,lift)=>{
    const el=document.createElement('div');
    el.className='atag '+cls; el.textContent=label;
    holder.appendChild(el);
    assetTags.push({el,obj,lift});
  };
  for(const t of tanks) add(t,'▮ ARMOUR','a-tank',5.2);
  for(const b of boats) add(b,'⛵ RHIB','a-boat',3.6);
  for(const s of ships) add(s,'⚓ CARRIER','a-ship',12);
  for(const e of emplacements) add(e,e.type==='arty'?'✚ GUN':'✚ MG NEST','a-gun',3.4);
}
function updateAssetTags(){
  if(!assetTags.length) return;
  const w=stage.clientWidth, hh=stage.clientHeight;
  const mine=B&&B.state==='action'&&!isAI(B.team);
  for(const a of assetTags){
    const o=a.obj;
    const used=o.dead||o.rider||o.crew||(o.shots!==undefined&&o.shots<=0);
    if(used||!mine){ a.el.style.display='none'; continue; }
    const gy=(o.y!==undefined?o.y:heightAt(o.x,o.z));
    V.set(o.x,gy+a.lift,o.z); V.project(camera);
    if(V.z>1){ a.el.style.display='none'; continue; }
    a.el.style.display='block';
    a.el.style.left=((V.x+1)/2*w)+'px';
    a.el.style.top=((1-V.y)/2*hh)+'px';
  }
}
function makeTag(m,team){
  const d=document.createElement('div');
  d.className='tag'+(team!==0?' foe':'');
  d.style.setProperty('--tt',TEAM_TINT[team%TEAM_TINT.length]);
  d.style.setProperty('--tn',TEAM_NAME_TINT[team%TEAM_NAME_TINT.length]);
  d.innerHTML='<span class="nm">'+m.name+'</span><div class="hb"><i></i></div>';
  $('tags').appendChild(d);
  return d;
}
const V=new THREE.Vector3();
function updateTags(){
  const w=stage.clientWidth,hh=stage.clientHeight;
  for(const h of B.hogs){
    if(h.dead){ h.tag.style.display='none'; continue; }
    V.copy(h.position); V.y+=3.4; V.project(camera);
    if(V.z>1){ h.tag.style.display='none'; continue; }
    h.tag.style.display='block';
    h.tag.style.left=((V.x+1)/2*w)+'px';
    h.tag.style.top=((1-V.y)/2*hh)+'px';
    h.tag.querySelector('.hb i').style.width=(h.hp/h.maxhp*100)+'%';
    h.tag.classList.toggle('act',h===activeHog()&&B.state==='action');
  }
}
function bubble(h,text){
  speak(text);
  const d=document.createElement('div');
  d.className='bub'; d.textContent=text;
  $('tags').appendChild(d);
  const upd=()=>{ if(!B||h.mesh.parent===null&&h.dead){ }
    V.copy(h.position); V.y+=4.6; V.project(camera);
    d.style.left=((V.x+1)/2*stage.clientWidth)+'px';
    d.style.top=((1-V.y)/2*stage.clientHeight)+'px';
    d.style.display=V.z>1?'none':'block'; };
  upd();
  const iv=setInterval(upd,50);
  setTimeout(()=>{ clearInterval(iv); d.remove(); },2600);
}
function floatText(pos,txt,color){
  const d=document.createElement('div');
  d.className='ft'; d.textContent=txt; d.style.color=color;
  $('tags').appendChild(d);
  const start=pos.clone(); let t=0;
  const iv=setInterval(()=>{ t+=0.05;
    V.copy(start); V.y+=3+t*2.4; V.project(camera);
    d.style.left=((V.x+1)/2*stage.clientWidth)+'px';
    d.style.top=((1-V.y)/2*stage.clientHeight)+'px';
    d.style.opacity=String(1-t*0.8);
  },50);
  setTimeout(()=>{ clearInterval(iv); d.remove(); },1200);
}
let bannerTO=null;
function banner(text,sub){
  $('bannerText').textContent=text;
  $('bannerSub').textContent=sub||'';
  $('banner').classList.remove('hidden');
  clearTimeout(bannerTO);
  bannerTO=setTimeout(()=>$('banner').classList.add('hidden'),1700);
}
function buildTray(){
  const tray=$('tray'); tray.innerHTML='';
  if(!B) return;
  const myTurn=B.state==='action'&&!isAI(B.team);
  const act=activeHog();
  WEAPONS.filter(w=>canUse(w,act)).forEach(w=>{
    const a=B.ammo[B.team][w.id];
    const b=document.createElement('button');
    b.className='wpn'+(String(B.sel)===w.key?' sel':'');
    b.disabled=!myTurn||(a!==Infinity&&a<=0);
    b.innerHTML='<div class="k">'+w.key+'</div><div class="n">'+w.name+'</div><div class="a">'+(a===Infinity?'&infin;':a+' left')+'</div>';
    b.onclick=()=>selectWeapon(w.key);
    tray.appendChild(b);
  });
}
/* One strength box per side, split down the two edges of the screen so six of
   them still fit without covering the battlefield. */
function buildTeamBoxes(){
  const L=$('tbL'), R=$('tbR');
  if(!L||!R) return;
  L.innerHTML=''; R.innerHTML='';
  for(let t=0;t<nTeams();t++){
    const d=document.createElement('div');
    d.className='teambox'+(nTeams()>2?' slim':'');
    d.id='tb'+t;
    d.style.borderColor=TEAM_TINT[t%TEAM_TINT.length];
    d.innerHTML='<div class="tn"><span></span><span class="cnt"></span></div>'+
                '<div class="hpbar"><i></i></div>';
    d.querySelector('.tn span').textContent=NATIONS[B.cfg.nats[t]].team;
    const bar=d.querySelector('.hpbar i');
    bar.style.background=TEAM_TINT[t%TEAM_TINT.length];
    bar.style.boxShadow='0 0 8px '+TEAM_TINT[t%TEAM_TINT.length]+'99';
    (t%2===0?L:R).appendChild(d);
  }
}
function updateHUD(){
  if(!B) return;
  for(let t=0;t<nTeams();t++){
    const el=$('tb'+t); if(!el) continue;
    const list=B.hogs.filter(h=>h.team===t);
    const hp=list.reduce((s,h)=>s+h.hp,0), mx=list.reduce((s,h)=>s+h.maxhp,0)||1;
    el.querySelector('.hpbar i').style.width=(hp/mx*100)+'%';
    el.querySelector('.cnt').textContent=list.filter(h=>!h.dead).length+'/'+list.length;
    el.classList.toggle('turn',B.team===t&&!B.over);
    if(netOn()) el.classList.toggle('mine',t===NETG.mySlot);
  }
  $('timer').textContent=Math.max(0,Math.ceil(B.timer));
  const rr=$('roundrow');
  if(rr){
    if(B.sudden){ rr.textContent='SUDDEN DEATH'; rr.classList.add('danger'); }
    else {
      const left=SUDDEN_DEATH_ROUND-B.round;
      rr.textContent='ROUND '+B.round+(left<=3?' — SWILL IN '+left:'');
      rr.classList.toggle('danger',left<=3);
    }
  }
}

/* ================= INPUT ================= */
const keys={};
let dragging=false,lastMX=0,lastMY=0,mouseHeld=false,ltHeld=false;
/* ---- look sensitivity ----
   Zoomed optics magnify your aim error as much as the target: at the sniper's
   15° FOV the same mouse movement sweeps 3.7× more angle than at the default
   55°. Scaling by the FOV ratio keeps the on-screen feel constant however far
   you are zoomed in, and SENS lets you tune the overall speed. */
const BASE_FOV=55;
const SENS_LEVELS=['low','normal','high'];
const SENS_MUL={low:0.6, normal:1, high:1.6};
let lookSens='normal';
try{ const s=localStorage.getItem('hogs2sens'); if(SENS_MUL[s]) lookSens=s; }catch(e){}
function lookScale(){ return (camera.fov/BASE_FOV)*SENS_MUL[lookSens]; }
function setSens(s){
  lookSens=SENS_MUL[s]?s:'normal';
  try{ localStorage.setItem('hogs2sens',lookSens); }catch(e){}
  document.querySelectorAll('#sensRow .sensbtn').forEach(b=>
    b.classList.toggle('sel',b.dataset.sens===lookSens));
}
const mouseNDC=new THREE.Vector2(0,0);
renderer.domElement.addEventListener('mousemove',e=>{
  const r=renderer.domElement.getBoundingClientRect();
  mouseNDC.x=((e.clientX-r.left)/r.width)*2-1;
  mouseNDC.y=-((e.clientY-r.top)/r.height)*2+1;
});
renderer.domElement.addEventListener('mousedown',e=>{
  if(e.button===0) mouseHeld=true;
  dragging=true; lastMX=e.clientX; lastMY=e.clientY;
});
addEventListener('mouseup',e=>{ if(!e||e.button===0) mouseHeld=false; dragging=false; });
addEventListener('blur',()=>{ mouseHeld=false; dragging=false; });
addEventListener('mousemove',e=>{
  if(!dragging) return;
  cam.yaw+=(e.clientX-lastMX)*0.005*lookScale();
  cam.pitch+=(e.clientY-lastMY)*0.004*lookScale();
  lastMX=e.clientX; lastMY=e.clientY;
});
renderer.domElement.addEventListener('wheel',e=>{ e.preventDefault(); cam.dist+=e.deltaY*0.03; },{passive:false});
/* ---- rebindable keys ---- */
const DEFAULT_BINDS={forward:'w',back:'s',left:'a',right:'d',jump:'q',board:'e',
  fire:' ',angleUp:'arrowup',angleDown:'arrowdown',manual:'h',voice:'m',fullscreen:'f'};
const BIND_LABELS={forward:'Move forward',back:'Move back',left:'Move left',right:'Move right',
  jump:'Hop',board:'Board / leave boat',fire:'Charge & fire',
  angleUp:'Raise launch angle',angleDown:'Lower launch angle',
  manual:'Field manual',voice:'Toggle voice-over',fullscreen:'Fullscreen'};
let binds={...DEFAULT_BINDS};
try{ const s=JSON.parse(localStorage.getItem('hogs2keys')||'null'); if(s) binds={...DEFAULT_BINDS,...s}; }catch(e){}
function saveBinds(){ try{ localStorage.setItem('hogs2keys',JSON.stringify(binds)); }catch(e){} }
function keyLabel(k){ return k===' '?'SPACE':k.startsWith('arrow')?k.slice(5).toUpperCase()+' ARROW':k.toUpperCase(); }
function down(action){ return !!keys[binds[action]]; }
let listeningFor=null;   // set while the player is rebinding a key

function toggleFullscreen(){
  const el=document.documentElement;
  if(!document.fullscreenElement){
    const r=el.requestFullscreen||el.webkitRequestFullscreen;
    if(r) r.call(el).catch(()=>{});
  } else {
    const x=document.exitFullscreen||document.webkitExitFullscreen;
    if(x) x.call(document);
  }
}
function onFullscreenChange(){
  const on=!!(document.fullscreenElement||document.webkitFullscreenElement);
  document.body.classList.toggle('fs',on);       // CSS lets the stage fill the screen
  const b=$('fsbtn'); if(b) b.textContent=on?'Exit Fullscreen':'Fullscreen';
  // let the layout settle before measuring, then again after the transition
  setTimeout(resize,50); setTimeout(resize,350);
}
document.addEventListener('fullscreenchange',onFullscreenChange);
document.addEventListener('webkitfullscreenchange',onFullscreenChange);

addEventListener('keydown',e=>{
  const k=e.key.toLowerCase();
  if(listeningFor){                      // capture the next key for rebinding
    e.preventDefault();
    if(k!=='escape'){ binds[listeningFor]=k; saveBinds(); }
    listeningFor=null; buildBindList(); return;
  }
  if([' ','arrowup','arrowdown','arrowleft','arrowright'].includes(k)) e.preventDefault();
  keys[k]=true;
  if(k===binds.fire&&!e.repeat) startCharge();
  // number row plus the extra slots: - artillery/bomber, = class special, [ boat gun
  if(screenState==='battle'&&B&&B.state==='action'&&!isAI(B.team)&&/^[0-9\-=[\]]$/.test(e.key)) selectWeapon(e.key);
  if(k==='n'&&screenState==='battle'&&B&&B.state==='action'&&!isAI(B.team)) toggleNapalm();
  if(k===binds.voice) toggleVoice();
  if(k===binds.manual) $('help').classList.toggle('hidden');
  if(k===binds.fullscreen) toggleFullscreen();
});
addEventListener('keyup',e=>{ const k=e.key.toLowerCase(); keys[k]=false; if(k===binds.fire) releaseCharge(); });

/* ================= TOUCH ================= */
const touch={up:false,down:false,left:false,right:false,aimUp:false,aimDown:false};
/* A desktop with a touchscreen is still a desktop. The old test ORed together
   "any touch capability at all" — but 'ontouchstart' in window and
   navigator.maxTouchPoints>0 are both true on ordinary Windows laptops, which is
   how the on-screen pad ended up on a work PC. Ask instead about the PRIMARY
   pointer and whether hovering is even possible: a phone has a coarse pointer
   and cannot hover; a laptop with a trackpad reports a fine pointer even when
   the screen also happens to be touch-sensitive. */
function looksLikeTouchDevice(){
  return matchMedia('(pointer:coarse)').matches && matchMedia('(hover:none)').matches;
}
const TOUCH_MODES=['auto','on','off'];
let touchPref=(()=>{ try{ const v=localStorage.getItem('hogs2touch');
  return TOUCH_MODES.includes(v)?v:'auto'; }catch(e){ return 'auto'; } })();
let isTouch=touchPref==='on'||(touchPref==='auto'&&looksLikeTouchDevice());
let lastTouchAt=0;
function touchLabel(){
  const b=$('touchbtn'); if(!b) return;
  b.textContent='Touch: '+(touchPref==='auto'?(isTouch?'AUTO (ON)':'AUTO (OFF)'):touchPref.toUpperCase());
}
function cycleTouch(){
  touchPref=TOUCH_MODES[(TOUCH_MODES.indexOf(touchPref)+1)%TOUCH_MODES.length];
  try{ localStorage.setItem('hogs2touch',touchPref); }catch(e){}
  applyTouchPref();
}
function applyTouchPref(){
  const want=touchPref==='on'||(touchPref==='auto'&&looksLikeTouchDevice());
  isTouch=!want;            // force setTouchMode to actually apply
  setTouchMode(want);
  touchLabel();
}
/* And if that guess is still wrong either way, the first real input corrects it,
   so nobody is stuck with the wrong controls. */
function setTouchMode(on){
  if(on===isTouch) return;
  isTouch=on;
  const pad=$('touchpad');
  if(pad) pad.classList.toggle('hidden',!on);
  document.body.classList.toggle('touch',on);
  touchLabel();
}
function bindTouchBtn(id,onDown,onUp){
  const el=$(id); if(!el) return;
  const start=e=>{ e.preventDefault(); el.classList.add('act'); onDown&&onDown(); };
  const end=e=>{ e.preventDefault(); el.classList.remove('act'); onUp&&onUp(); };
  el.addEventListener('pointerdown',start);
  el.addEventListener('pointerup',end);
  el.addEventListener('pointercancel',end);
  el.addEventListener('pointerleave',end);
}
function initTouch(){
  $('touchpad').classList.toggle('hidden',!isTouch);
  document.body.classList.toggle('touch',isTouch);
  touchLabel();
  // a genuine finger turns the pad on; a mouse or a key turns it off. The
  // timestamp guard is because phones fire a synthetic mousemove after a tap,
  // which would otherwise hide the controls the moment they were used.
  addEventListener('touchstart',()=>{ lastTouchAt=performance.now(); if(touchPref==='auto') setTouchMode(true); },{passive:true});
  addEventListener('pointerdown',e=>{
    if(e.pointerType==='touch'){ lastTouchAt=performance.now(); setTouchMode(true); }
  },{passive:true});
  addEventListener('mousemove',e=>{
    if((e.movementX||e.movementY)&&performance.now()-lastTouchAt>900&&touchPref==='auto') setTouchMode(false);
  },{passive:true});
  addEventListener('keydown',()=>{ if(touchPref==='auto') setTouchMode(false); });
  bindTouchBtn('tUp',   ()=>touch.up=true,    ()=>touch.up=false);
  bindTouchBtn('tDown', ()=>touch.down=true,  ()=>touch.down=false);
  bindTouchBtn('tLeft', ()=>touch.left=true,  ()=>touch.left=false);
  bindTouchBtn('tRight',()=>touch.right=true, ()=>touch.right=false);
  bindTouchBtn('tAimUp',   ()=>touch.aimUp=true,   ()=>touch.aimUp=false);
  bindTouchBtn('tAimDown', ()=>touch.aimDown=true, ()=>touch.aimDown=false);
  // HOP doubles as the boat control when there's a landing craft to hand
  bindTouchBtn('tJump', ()=>{
    const h=activeHog();
    if(!h||!B||B.state!=='action'||isAI(B.team)) return;
    if(!useNearby(h)) jumpHog(h);      // nothing to crew here? then just hop
  });
  bindTouchBtn('tFire', startCharge, releaseCharge);
  bindTouchBtn('tWpnPrev',()=>cycleWeapon(-1));
  bindTouchBtn('tWpnNext',()=>cycleWeapon(1));
}
// one-finger drag on the canvas orbits the camera; two fingers pinch to zoom
let tPrev=null, pinchPrev=0;
renderer.domElement.addEventListener('touchstart',e=>{
  if(e.touches.length===1) tPrev={x:e.touches[0].clientX,y:e.touches[0].clientY};
  else if(e.touches.length===2)
    pinchPrev=Math.hypot(e.touches[0].clientX-e.touches[1].clientX,e.touches[0].clientY-e.touches[1].clientY);
},{passive:true});
renderer.domElement.addEventListener('touchmove',e=>{
  e.preventDefault();
  if(e.touches.length===1&&tPrev){
    cam.yaw+=(e.touches[0].clientX-tPrev.x)*0.006*lookScale();
    cam.pitch+=(e.touches[0].clientY-tPrev.y)*0.005*lookScale();
    tPrev={x:e.touches[0].clientX,y:e.touches[0].clientY};
  } else if(e.touches.length===2){
    const d=Math.hypot(e.touches[0].clientX-e.touches[1].clientX,e.touches[0].clientY-e.touches[1].clientY);
    if(pinchPrev) cam.dist+=(pinchPrev-d)*0.09;
    pinchPrev=d;
  }
},{passive:false});
renderer.domElement.addEventListener('touchend',()=>{ tPrev=null; pinchPrev=0; },{passive:true});

/* ================= TUTORIAL ================= */
const TUTORIAL=[
  {t:'Your squad',      b:'The bobbing arrow marks the hog whose turn it is. You control one hog per turn.'},
  {t:'Look around',     b:isTouch?'Drag anywhere on the battlefield to swing the camera. Pinch to zoom.':'Drag with the mouse to swing the camera. Your shells fly in the direction you are facing.'},
  {t:'Set your angle',  b:isTouch?'Use AIM ▲ / ▼ to raise or lower the launch angle. The dotted arc shows the flight path.':'Press the UP and DOWN arrows to raise or lower the launch angle. The dotted arc shows the flight path.'},
  {t:'The impact ring', b:'The pulsing ring marks exactly where the shot will land — wind and bounces included. Line it up on an enemy.'},
  {t:'Fire!',           b:isTouch?'Hold FIRE to build power and release to shoot. Longer hold, longer shot.':'Hold SPACE to build power and release to shoot. Longer hold, longer shot.'},
  {t:'Mind the swill',  b:'After round '+SUDDEN_DEATH_ROUND+' the swill starts rising and drowns the low ground. Do not dawdle.'},
];
let tutStep=0;
function tutorialSeen(){ try{ return localStorage.getItem('hogs2tut')==='1'; }catch(e){ return false; } }
function markTutorialSeen(){ try{ localStorage.setItem('hogs2tut','1'); }catch(e){} }
function showTutorial(step){
  tutStep=step;
  if(step>=TUTORIAL.length){ closeTutorial(); return; }
  const s=TUTORIAL[step];
  $('tutTitle').textContent=s.t;
  $('tutBody').textContent=s.b;
  $('tutStep').textContent='Tip '+(step+1)+' of '+TUTORIAL.length;
  $('tutNext').textContent=step===TUTORIAL.length-1?'Got it':'Next';
  $('tutorial').classList.remove('hidden');
}
function closeTutorial(){ $('tutorial').classList.add('hidden'); markTutorialSeen(); }

/* ================= KEY REBINDING UI ================= */
function buildBindList(){
  const el=$('bindlist'); if(!el) return;
  el.innerHTML='';
  for(const action of Object.keys(DEFAULT_BINDS)){
    const row=document.createElement('div'); row.className='bindrow';
    const lbl=document.createElement('span'); lbl.textContent=BIND_LABELS[action];
    const btn=document.createElement('button'); btn.className='bindkey';
    btn.textContent=listeningFor===action?'press a key…':keyLabel(binds[action]);
    if(listeningFor===action) btn.classList.add('listening');
    btn.onclick=()=>{ listeningFor=action; buildBindList(); };
    row.appendChild(lbl); row.appendChild(btn);
    el.appendChild(row);
  }
}
function resetBinds(){ binds={...DEFAULT_BINDS}; saveBinds(); buildBindList(); }
function startCharge(){
  if(!B||B.state!=='action'||isAI(B.team)) return;
  const w=currentWeapon(), h=activeHog();
  if(!h) return;
  if(w.kind==='heal'){ fire(h,w,aimDir(),0); return; }
  // everything that is aimed down the crosshair rather than lobbed
  if(['ray','strike','burst','flame','arty'].includes(w.kind)){ fire(h,w,crosshairDir(h),0); return; }
  B.charging=true;
}
function releaseCharge(){
  if(!B||!B.charging||B.state!=='action') return;
  const h=activeHog(); if(!h) return;
  fire(h,currentWeapon(),aimDirBallistic(),12+B.power*3.5);
}
function selectWeapon(n){
  if(!B||B.state!=='action'||isAI(B.team)) return;
  const act=activeHog();
  const w=WEAPONS.filter(x=>canUse(x,act)).find(x=>x.key===String(n));
  if(!w) return;
  const a=B.ammo[B.team][w.id];
  if(a!==Infinity&&a<=0) return;
  B.sel=n; buildTray();
}
function toggleVoice(){ voiceOn=!voiceOn; $('voicebtn').textContent='Voice: '+(voiceOn?'ON':'OFF');
  if(!voiceOn){ try{speechSynthesis.cancel();}catch(e){} } }

/* ================= GAMEPAD (Steam Controller 2 via Steam Input, Xbox, PS, etc.) ================= */
let gpPrev={}, gpActive=false, gpHintOn=false, menuFocus=0;
let hintIsBomber=null, defaultHint='';
addEventListener('gamepadconnected',e=>{
  gpActive=true;
  if(B) banner('CONTROLLER CONNECTED','READY FOR BATTLE');
});
function cycleWeapon(dir){
  if(!B) return;
  // walk by array index, but store the weapon's KEY — keys are '1'..'9','0','-'
  let i=WEAPONS.findIndex(w=>w.key===String(B.sel));
  if(i<0) i=0;
  for(let n=0;n<WEAPONS.length;n++){
    i=(i+dir+WEAPONS.length)%WEAPONS.length;
    const w=WEAPONS[i], a=B.ammo[B.team][w.id];
    if(a===Infinity||a>0){ B.sel=w.key; buildTray(); sfx('beep'); return; }
  }
}
function menuFocusables(){
  const ov=['help','endscreen','briefing','natsel','menu'].map($).find(e=>!e.classList.contains('hidden'));
  if(!ov) return [];
  return [...ov.querySelectorAll('button.stamp, .nation')].filter(e=>!e.disabled&&e.offsetParent&&!e.classList.contains('hidden'));
}
function menuMove(d){
  const f=menuFocusables(); if(!f.length) return;
  menuFocus=(menuFocus+d+f.length)%f.length;
  f.forEach((e,i)=>e.classList.toggle('gfocus',i===menuFocus));
}
function menuActivate(){
  const f=menuFocusables(); if(!f.length) return;
  f[Math.min(menuFocus,f.length-1)].click();
  menuFocus=0;
  setTimeout(()=>{ menuFocusables().forEach((e,i)=>e.classList.toggle('gfocus',i===0)); },80);
}
function handleControllerAiming(h, w){
  const pads=navigator.getGamepads?navigator.getGamepads():[];
  const pad=pads[0]||null;
  if(!pad) return { isZooming:false, stickY:0 };
  const ltValue=pad.buttons[6] ? pad.buttons[6].value : 0;
  const isZooming=ltValue>0.1||mouseHeld;      // LT or left mouse = aim down sights
  const stickY=pad.axes[3]||0;
  return { isZooming, stickY };
}
function pollGamepad(dt){
  const pads=navigator.getGamepads?navigator.getGamepads():[];
  let gp=null; for(const p of pads){ if(p&&p.connected){ gp=p; break; } }
  if(!gp) return;
  const btn=i=>!!(gp.buttons[i]&&(gp.buttons[i].pressed||gp.buttons[i].value>0.5));
  const was=i=>!!gpPrev[i];
  const dz=v=>Math.abs(v)>0.18?v:0;
  ltHeld=!!(gp.buttons[6]&&gp.buttons[6].value>0.1);   // left trigger = aim down sights
  const lx=dz(gp.axes[0]||0), ly=dz(gp.axes[1]||0);
  const rx=dz(gp.axes[2]||0), ry=dz(gp.axes[3]||0);
  if(lx||ly||rx||ry||gp.buttons.some(b=>b&&b.pressed)) gpActive=true;
  if(gpActive&&!gpHintOn){ gpHintOn=true;
    defaultHint='<b>RT</b> charge &amp; fire &nbsp;·&nbsp; <b>D-pad &uarr;&darr;</b> angle &nbsp;·&nbsp; <b>LB/RB</b> weapon &nbsp;·&nbsp; <b>sticks</b> move / aim &nbsp;·&nbsp; <b>A</b> hop';
    hintIsBomber=null; }
  if(inBombView()&&B.bombCursor){
    // right stick walks the bombsight cursor over the map instead of orbiting
    B.bombCursor.x+=rx*dt*55;
    B.bombCursor.z+=ry*dt*55;
  } else { const ls=lookScale(); cam.yaw+=rx*dt*2.7*ls; cam.pitch+=ry*dt*1.9*ls; }
  const inBattleAction=screenState==='battle'&&B&&B.state==='action'&&!isAI(B.team);
  if(inBattleAction){
    const h=activeHog();
    if(h&&(lx||ly)){
      const fw=camAzimuth(), rtv={x:-fw.z,z:fw.x};
      const mx=fw.x*(-ly)+rtv.x*lx, mz=fw.z*(-ly)+rtv.z*lx;
      const l=Math.hypot(mx,mz);
      // drives the tank or boat if crewing one, otherwise walks
      if(l>0.05) moveActive(h,mx/l,mz/l,dt*Math.min(1,l*1.4));
    }
    if(btn(12)) B.aimPitch=clamp(B.aimPitch+dt*1.1,0.06,1.5);
    if(btn(13)) B.aimPitch=clamp(B.aimPitch-dt*1.1,0.06,1.5);
    if(btn(14)) cam.dist-=dt*26;
    if(btn(15)) cam.dist+=dt*26;
    if(btn(4)&&!was(4)) cycleWeapon(-1);
    if(btn(5)&&!was(5)) cycleWeapon(1);
    if(h&&btn(0)&&!was(0)&&!h.boat&&!h.tank) jumpHog(h);
    // B: board / leave a tank, boat or emplaced gun
    if(h&&btn(1)&&!was(1)) useNearby(h);
    if(btn(7)&&!was(7)) startCharge();
    if(!btn(7)&&was(7)) releaseCharge();
  } else if(screenState!=='battle'||!B||B.over){
    if((btn(12)&&!was(12))||(btn(14)&&!was(14))||(ly<-0.5&&!gpPrev.lyUp)||(lx<-0.5&&!gpPrev.lxL)) menuMove(-1);
    if((btn(13)&&!was(13))||(btn(15)&&!was(15))||(ly>0.5&&!gpPrev.lyDn)||(lx>0.5&&!gpPrev.lxR)) menuMove(1);
    if(btn(0)&&!was(0)) menuActivate();
    if(btn(1)&&!was(1)) $('help').classList.add('hidden');
  }
  const np={};
  for(let i=0;i<gp.buttons.length;i++) np[i]=btn(i);
  np.lyUp=ly<-0.5; np.lyDn=ly>0.5; np.lxL=lx<-0.5; np.lxR=lx>0.5;
  gpPrev=np;
}

/* trajectory preview */
const trajGeo=new THREE.BufferGeometry();
trajGeo.setAttribute('position',new THREE.BufferAttribute(new Float32Array(96*3),3));
const trajPts=new THREE.Points(trajGeo,new THREE.PointsMaterial({color:0xffd76a,size:0.85,transparent:true,opacity:1,sizeAttenuation:true}));
trajPts.visible=false; scene.add(trajPts);
// impact ring: shows exactly where the shot will land (incl. wind, bounces, fuse)
const impactRing=new THREE.Group();
const ringM=new THREE.Mesh(new THREE.RingGeometry(1.15,1.7,28),
  new THREE.MeshBasicMaterial({color:0xe0663a,transparent:true,opacity:0.95,side:THREE.DoubleSide,depthWrite:false}));
const ringDot=new THREE.Mesh(new THREE.CircleGeometry(0.35,14),
  new THREE.MeshBasicMaterial({color:0xffd76a,transparent:true,opacity:0.95,side:THREE.DoubleSide,depthWrite:false}));
impactRing.add(ringM); impactRing.add(ringDot);
impactRing.visible=false; impactRing.renderOrder=5; scene.add(impactRing);
/* Bomber target marker. The ring marks the aim point, the run group shows the
   heading the aircraft will fly and a pip for every bomb in the stick, so the
   preview is exactly what the run will do. Heading is rotated by the player. */
const strikeMarker=new THREE.Group();
const runGroup=new THREE.Group();
{
  const red=0xe0663a, gold=0xffd76a;
  const flat=(c,o)=>new THREE.MeshBasicMaterial({color:c,transparent:true,opacity:o,side:THREE.DoubleSide,depthWrite:false});
  strikeMarker.add(new THREE.Mesh(new THREE.RingGeometry(3.4,4.3,34),flat(red,0.95)));
  strikeMarker.add(new THREE.Mesh(new THREE.CircleGeometry(0.7,16),flat(gold,0.95)));
  for(let i=0;i<4;i++){
    const t=new THREE.Mesh(new THREE.PlaneGeometry(0.42,2.1),flat(red,0.9));
    t.position.set(Math.cos(i*Math.PI/2)*5.4,Math.sin(i*Math.PI/2)*5.4,0);
    t.rotation.z=i*Math.PI/2;
    strikeMarker.add(t);
  }
  // run-in axis, arrow head, and one pip per bomb (spacing matches the drop code)
  runGroup.add(new THREE.Mesh(new THREE.PlaneGeometry(30,0.9),flat(gold,0.35)));
  const head=new THREE.Mesh(new THREE.CircleGeometry(1.5,3),flat(gold,0.85));
  head.position.set(15.5,0,0); head.rotation.z=-Math.PI/2;
  runGroup.add(head);
  runGroup.userData.pips=[];
  for(let k=0;k<8;k++){
    const pip=new THREE.Mesh(new THREE.RingGeometry(0.75,1.15,14),flat(gold,0.8));
    runGroup.add(pip); runGroup.userData.pips.push(pip);
  }
  strikeMarker.add(runGroup);
}
strikeMarker.visible=false; strikeMarker.renderOrder=5; scene.add(strikeMarker);
function updateStrikeMarker(){
  const h=activeHog(), w=currentWeapon();
  if(!h||B.state!=='action'||isAI(B.team)||w.kind!=='strike'){ strikeMarker.visible=false; return; }
  // In the bombsight the cursor follows the mouse across the map; on a pad the
  // right stick nudges it. Either way it is a world point, not a screen-centre ray.
  let t=null;
  if(inBombView()){
    if(!B.bombCursor){
      const foes=foesOf(B.team);
      const c=foes.length
        ? foes.reduce((v,f)=>v.add(f.position),new THREE.Vector3()).multiplyScalar(1/foes.length)
        : h.position.clone();
      B.bombCursor=c.clone();
    }
    if(!gpActive){
      const m=groundUnderMouse();
      if(m) B.bombCursor.copy(m);
    }
    B.bombCursor.x=clamp(B.bombCursor.x,-TW/2+4,TW/2-4);
    B.bombCursor.z=clamp(B.bombCursor.z,-TD/2+4,TD/2-4);
    t=B.bombCursor.clone();
  } else {
    t=rayGround(camera.position.clone(),aimDir());
  }
  if(!t){ strikeMarker.visible=false; return; }
  B.strikeTarget=t.clone();                       // fire() uses this exact point
  strikeMarker.position.set(t.x,heightAt(t.x,t.z)+0.22,t.z);
  strikeMarker.quaternion.setFromUnitVectors(UP,normalAt(t.x,t.z));
  runGroup.rotation.z=-B.strikeHeading+Math.PI/2;
  // pips sit where each bomb in the stick will land
  const nb=w.bombs||3, pips=runGroup.userData.pips;
  pips.forEach((p,k)=>{
    p.visible=k<nb;
    if(k<nb) p.position.set((k-(nb-1)/2)*4,0,0);
  });
  const pulse=1+Math.sin(performance.now()*0.007)*0.05;
  // the map view is a long way up, so fatten the reticle to stay readable
  strikeMarker.scale.setScalar(pulse*(inBombView()?2.1:1));
  strikeMarker.visible=true;
}
// aim dot for hitscan weapons
const aimDot=new THREE.Mesh(new THREE.SphereGeometry(0.4,10,8),
  new THREE.MeshBasicMaterial({color:0xe0663a,depthTest:false,transparent:true,opacity:0.95}));
aimDot.renderOrder=6; aimDot.visible=false; scene.add(aimDot);
const UP=new THREE.Vector3(0,0,1);
function updateTraj(){
  const h=activeHog(), w=currentWeapon();
  if(!h||B.state!=='action'||!BALLISTIC_KINDS.includes(w.kind)){
    trajPts.visible=false; impactRing.visible=false; return; }
  const dir=aimDirBallistic(), speed=12+(B.charging?B.power:5)*3.5;
  trajPts.material.opacity=B.charging?1:0.55;
  const from=muzzle(h).addScaledVector(dir,1.4);
  const p=from.clone(), v=dir.clone().multiplyScalar(speed);
  const attr=trajGeo.attributes.position; let n=0;
  // true impact point via the same sim the shell uses (wind, bounces, fuse)
  const res=simShot(from.clone(),dir.clone(),speed,w.wind?B.wind:0,
    (w.kind==='bounce'||w.kind==='minetoss')?{fuse:w.kind==='bounce'?w.fuse:null}:null);
  const dt=PHYS_DT;                       // must match the live projectile step
  for(let s=0;s<560&&n<95;s++){
    if(w.wind) v.x+=B.wind*dt;
    v.y-=GRAV*dt;
    p.addScaledVector(v,dt);
    if(s%5===0){ attr.setXYZ(n++,p.x,p.y,p.z); }
    if(p.y<heightAt(p.x,p.z)||p.y<waterLevel-1||blockAt(p,0.1)) break;
  }
  // pin the final dot to the real impact so the arc ends exactly on the ring —
  // otherwise the last drawn dot falls short and you aim long
  if(res&&!res.water) attr.setXYZ(n++,res.pos.x,res.pos.y,res.pos.z);
  trajGeo.setDrawRange(0,n); attr.needsUpdate=true;
  trajPts.visible=true;
  if(res){
    const gx=res.pos.x, gz=res.pos.z;
    const gy=res.water?waterLevel:heightAt(gx,gz);
    impactRing.position.set(gx,gy+0.18,gz);
    impactRing.quaternion.setFromUnitVectors(UP,res.water?new THREE.Vector3(0,1,0):normalAt(gx,gz));
    const pulse=1+Math.sin(performance.now()*0.008)*0.14;
    impactRing.scale.setScalar(pulse*(B.charging?1.15:1));
    ringM.material.color.setHex(res.water?0x5b90a8:0xe0663a);
    impactRing.visible=true;
  } else impactRing.visible=false;
}
function updateAimDot(){
  const h=activeHog(), wk=currentWeapon().kind;
  const on=h&&B.state==='action'&&!isAI(B.team)&&CROSSHAIR_KINDS.includes(wk);
  if(!on){ aimDot.visible=false; $('crosshair').classList.remove('hot'); return; }
  const p=camera.position.clone(), d=aimDir();
  let hitHogFlag=false, hitPos=null;
  for(let s=0;s<520;s++){
    p.addScaledVector(d,0.7);
    let done=false;
    for(const hh of B.hogs){ if(hh.dead||hh===h) continue;
      if(p.distanceTo(hh.position.clone().setY(hh.position.y+1))<1.6){ hitHogFlag=true; hitPos=p.clone(); done=true; break; } }
    if(done) break;
    if(p.y<heightAt(p.x,p.z)||blockAt(p,0.1)){ hitPos=p.clone(); break; }
    if(Math.abs(p.x)>TW/2+60||Math.abs(p.z)>TD/2+60||p.y<-20) break;
  }
  if(hitPos){ aimDot.position.copy(hitPos); aimDot.visible=true;
    aimDot.material.color.setHex(hitHogFlag?0xff4030:0xffd76a);
    aimDot.scale.setScalar(hitHogFlag?1.5+Math.sin(performance.now()*0.012)*0.3:1); }
  else aimDot.visible=false;
  $('crosshair').classList.toggle('hot',hitHogFlag);
}

/* ================= UPDATE LOOP ================= */
const clock=new THREE.Clock();
function update(){
  const dt=Math.min(clock.getDelta(),1/25);
  pollGamepad(dt);
  for(const c of clouds.children){ c.position.x+=c.userData.s*dt*(B?1+B.wind*0.15:1); if(c.position.x>340) c.position.x=-340; }
  water.position.y=waterLevel+Math.sin(performance.now()*0.0012)*0.07;
  animateWater(performance.now()*0.001);
  if(screenState!=='battle'||!B){
    if(!gpActive) cam.yaw+=dt*0.05;
    cam.follow=null;
    cam.dist+=(100-cam.dist)*dt*2; cam.pitch+=(0.55-cam.pitch)*dt*2;
    cam.target.lerp(new THREE.Vector3(0,4,0),Math.min(1,dt*2));
    updateCamera(dt); composer.render(); return; }

  hogAcc+=dt;
  let hogGuard=0;
  while(hogAcc>=PHYS_DT&&hogGuard++<8){
    hogAcc-=PHYS_DT;
    for(const h of B.hogs) hogPhysics(h,PHYS_DT);
  }
  updateBoats(dt); updateTanks(dt); updateShips(dt); updateFires(dt);
  // mines
  for(const m of B.mines){
    if(m.boomed) continue;
    if(m.arm>0){ m.arm-=dt; continue; }
    if(m.fuse!=null){
      m.fuse-=dt;
      m.mesh.material.emissive=new THREE.Color(Math.floor(m.fuse*8)%2?0xff3020:0x000000);
      if(m.fuse<=0){ m.boomed=true; scene.remove(m.mesh); boom(m.mesh.position,6.6,45,null,'mine'); }
      continue;
    }
    for(const h of B.hogs){ if(h.dead||h.cls==='Spy') continue;
      if(m.mesh.position.distanceTo(h.position)<3.4){ m.fuse=0.7; sfx('beep'); break; } }
  }
  B.mines=B.mines.filter(m=>!m.boomed);
  // planes
  for(let i=B.planes.length-1;i>=0;i--){
    const pl=B.planes[i];
    pl.mesh.position.addScaledVector(pl.az,46*dt);
    if(!pl.dropped){
      // Release early enough that the bomb line straddles the target: solve the
      // fall time from the drop height, then lead by how far the bombs drift
      // forward during it. Without this the whole stick lands well past the mark.
      const BOMB_VX=14, BOMB_VY=-2;
      const dropY=pl.mesh.position.y-1.5;
      const drop=Math.max(1,dropY-heightAt(pl.target.x,pl.target.z));
      const fall=(-BOMB_VY+Math.sqrt(BOMB_VY*BOMB_VY+2*GRAV*drop))/GRAV;
      const lead=BOMB_VX*fall;
      const along=pl.mesh.position.clone().sub(pl.target); along.y=0;
      if(along.dot(pl.az)>-lead){
        pl.dropped=true;
        const nb=pl.bombs||3;
        for(let k=0;k<nb;k++){
          // spaced symmetrically about the aim point so the stick walks across it
          spawnProj('bomb',pl.mesh.position.clone().addScaledVector(pl.az,(k-(nb-1)/2)*4).setY(dropY),
            pl.az.clone().multiplyScalar(BOMB_VX).setY(BOMB_VY),
            {owner:pl.owner,windAcc:0,bounce:false,fuse:null,
             r:pl.napalm?(pl.r||5.6)*0.75:(pl.r||5.6),
             dmg:pl.napalm?Math.round((pl.dmg||32)*0.55):(pl.dmg||32),
             napalm:!!pl.napalm});
        }
        cam.follow=B.projs[B.projs.length-1].mesh;
      }
    }
    if(Math.abs(pl.mesh.position.x)>TW/2+160||Math.abs(pl.mesh.position.z)>TD/2+160){ scene.remove(pl.mesh); B.planes.splice(i,1); }
  }
  // Projectiles run on a FIXED timestep. Integrating them at the frame rate made
  // the real flight differ from the previewed arc (and made range depend on fps),
  // which is why long shots overshot the impact ring.
  projAcc+=dt;
  let physGuard=0;
  while(projAcc>=PHYS_DT&&physGuard++<8){
    projAcc-=PHYS_DT;
    for(let i=B.projs.length-1;i>=0;i--){
      const p=B.projs[i], ev=stepProjPhysics(p,PHYS_DT);
      if(!ev) continue;
      scene.remove(p.mesh); B.projs.splice(i,1);
      // if we were watching this shell, hand the camera to the next one still in
      // the air so a salvo is followed all the way down instead of only the first
      if(cam.follow===p.mesh){
        const next=B.projs.find(q=>q!==p);
        cam.follow=next?next.mesh:null;
      }
      if(ev.t==='explode'){
        boom(p.position,p.r,p.dmg,p.owner,p.type);
        if(p.napalm){ spawnFire(p.position.x,p.position.z,p.r*1.5,2); sfx('flame'); }
        if(p.cluster){ for(let k=0;k<4;k++){
          spawnProj('bomblet',p.position.clone().add(new THREE.Vector3(0,0.6,0)),
            new THREE.Vector3((Math.random()-0.5)*9,7+Math.random()*5,(Math.random()-0.5)*9),
            {owner:p.owner,windAcc:0,bounce:false,fuse:null,r:4,dmg:18}); } }
      } else if(ev.t==='splash'){ sfx('splash');
        spawnParticles(p.position.clone().setY(waterLevel),10,0x7f9bb0,5);
      } else if(ev.t==='rest'){
        const m=makeShellMesh('mine'); m.position.copy(p.position).y+=0.1; scene.add(m);
        B.mines.push({mesh:m,arm:1.4,fuse:null,boomed:false});
      }
    }
  }
  if(window.activeExplosions){
    for(let i=window.activeExplosions.length-1;i>=0;i--){
      const exp=window.activeExplosions[i];
      exp.life-=0.03;
      exp.mesh.scale.addScalar(0.2);
      exp.mesh.material.opacity=exp.life;
      exp.mesh.material.color.lerp(new THREE.Color(0x222222),0.1);
      exp.light.intensity=exp.life*15;
      if(exp.life<=0){
        scene.remove(exp.mesh); scene.remove(exp.light);
        exp.mesh.geometry.dispose(); exp.mesh.material.dispose();
        window.activeExplosions.splice(i,1);
      }
    }
  }
  // particles
  for(let i=B.parts.length-1;i>=0;i--){
    const p=B.parts[i]; p.life-=dt;
    if(p.ring){ p.mesh.scale.multiplyScalar(1+dt*11); p.mesh.material.opacity=Math.max(0,p.life*1.7); }
    else if(p.smoke){ p.mesh.position.addScaledVector(p.vel,dt); p.vel.y+=dt*1.1;
      p.mesh.scale.multiplyScalar(1+dt*1.5); p.mesh.material.opacity=Math.max(0,p.life*0.4); }
    else { p.vel.y-=GRAV*0.7*dt; p.mesh.position.addScaledVector(p.vel,dt);
      p.mesh.material.opacity=Math.min(1,p.life); }
    if(p.life<=0){ scene.remove(p.mesh); B.parts.splice(i,1); }
  }
  updateDebris(dt);
  for(let i=B.tracers.length-1;i>=0;i--){
    const t=B.tracers[i]; t.life-=dt; t.mesh.material.opacity=t.life*4;
    if(t.life<=0){ scene.remove(t.mesh); B.tracers.splice(i,1); }
  }

  const h=activeHog();
  switch(B.state){
    case 'start':
      B.st+=dt;
      if(B.st>1.2){ B.state='action'; B.st=0; buildTray(); }
      break;
    case 'action': {
      if(!h||h.dead){ endAction(); break; }
      if(B.paused) break;                       // waiting on the hot-seat handover
      if(NETG.paused) break;                    // waiting on a player to come back
      B.timer-=dt;
      // only whoever's turn it is decides that time is up — otherwise clock
      // drift between machines would end the turn at different moments
      if(B.timer<=0&&iControl(B.team)){
        banner('TIME UP!',''); netSendEndTurn(B.team); endAction(); break;
      }
      if(B.timer<=0&&!iControl(B.team)) B.timer=0;
      // in a networked game a remote player's turn plays out from their
      // messages; we render it but take no input for it
      if(netOn()&&!iControl(B.team)){ break; }
      if(isAI(B.team)){
        B.st+=dt;
        // 1. decide whether to reposition, 2. walk, 3. aim, 4. fire
        if(B.aiMove===undefined&&B.st>0.45){
          B.aiBoard=planAIBoard(h);             // hardware first, tactics second
          B.aiMove=B.aiBoard?null:planAIMove(h);
          B.aiMoveEnd=0.45+(B.aiBoard?B.aiBoard.time:(B.aiMove?B.aiMove.time:0));
        }
        if(B.aiBoard&&B.st<B.aiMoveEnd){
          const o=B.aiBoard.o;
          const dx=o.x-h.position.x, dz=o.z-h.position.z, d=Math.hypot(dx,dz)||1;
          if(d<=B.aiBoard.range){ aiBoard(h,o); B.aiBoard=null; B.aiMoveEnd=B.st; }
          else walkHog(h,dx/d,dz/d,dt);
        } else if(B.aiMove&&B.st<B.aiMoveEnd){
          // moveActive, not walkHog — this is what lets the AI drive what it crews
          moveActive(h,B.aiMove.dx,B.aiMove.dz,dt);
        } else if(B.aiMoveEnd!==undefined){
          const fireAt=B.aiMoveEnd+0.85;
          if(!B.aiPlan&&B.st>B.aiMoveEnd+0.25)
            B.aiPlan=planAI(h)||{w:W('rifle'),dir:new THREE.Vector3(1,0.3,0).normalize()};
          if(B.aiPlan&&B.st>fireAt){
            const pl=B.aiPlan;
            if(pl.w.kind==='heal') fire(h,pl.w,new THREE.Vector3(1,0,0),0);
            else if(CROSSHAIR_KINDS.includes(pl.w.kind)){
              B.aiAimAt=pl.aimAt||null;         // aim at the plan's point, not the camera's
              fire(h,pl.w,pl.dir,0);
            }
            else fire(h,pl.w,pl.dir,pl.sp||26);
            B.aiPlan=null;
          }
        }
      } else {
        const w=currentWeapon();
        const input=handleControllerAiming(h,w);
        const canZoom=(w.id==='rifle'||w.id==='sniper');
        const DEFAULT_FOV=55;
        const ZOOM_FOV=w.id==='sniper'?15:30;
        const scope=$('scope');
        if(canZoom&&input.isZooming){
          if(camera.fov>ZOOM_FOV){ camera.fov-=(camera.fov-ZOOM_FOV)*0.18; camera.updateProjectionMatrix(); }
          if(Math.abs(input.stickY)>0.1) B.aimPitch=clamp(B.aimPitch-input.stickY*0.008*SENS_MUL[lookSens],0.06,1.5);
        } else {
          if(camera.fov<DEFAULT_FOV){ camera.fov+=(DEFAULT_FOV-camera.fov)*0.18; if(camera.fov>DEFAULT_FOV) camera.fov=DEFAULT_FOV; camera.updateProjectionMatrix(); }
          if(Math.abs(input.stickY)>0.1) B.aimPitch=clamp(B.aimPitch-input.stickY*0.03*SENS_MUL[lookSens],0.06,1.5);
        }
        scope.classList.toggle('hidden',!(canZoom&&input.isZooming&&Math.abs(camera.fov-ZOOM_FOV)<2));
        B.aimPitch=clamp(B.aimPitch,0.06,1.5);
        // camera-relative movement
        let mx=0,mz=0;
        const fw=new THREE.Vector3(-Math.cos(cam.yaw),0,-Math.sin(cam.yaw));
        const rt=new THREE.Vector3(-fw.z,0,fw.x);
        if(down('forward')||touch.up)   { mx+=fw.x; mz+=fw.z; }
        if(down('back')||touch.down)    { mx-=fw.x; mz-=fw.z; }
        if(down('left')||touch.left)    { mx-=rt.x; mz-=rt.z; }
        if(down('right')||touch.right)  { mx+=rt.x; mz+=rt.z; }
        if(mx||mz){ const l=Math.hypot(mx,mz); moveActive(h,mx/l,mz/l,dt); }
        else if(BALLISTIC_KINDS.includes(w.kind)){
          const fw=camAzimuth(); h.mesh.rotation.y=-Math.atan2(fw.z,fw.x); }
        if(down('jump')&&!h.boat){ jumpHog(h); keys[binds.jump]=false; }
        if(down('board')){ keys[binds.board]=false; useNearby(h); }
        if(w.kind==='strike'){
          // for the bomber the same controls swing the aircraft's run heading
          if(B.strikeHeading==null){ const a=camAzimuth(); B.strikeHeading=Math.atan2(a.z,a.x); }
          if(down('angleUp')||touch.aimUp)     B.strikeHeading-=dt*1.6;
          if(down('angleDown')||touch.aimDown) B.strikeHeading+=dt*1.6;
        } else {
          if(down('angleUp')||touch.aimUp) B.aimPitch=clamp(B.aimPitch+dt*1.1,0.06,1.5);
          if(down('angleDown')||touch.aimDown) B.aimPitch=clamp(B.aimPitch-dt*1.1,0.06,1.5);
        }
        if(B.charging){ B.power+=dt*10; if(B.power>=MAX_POWER){ B.power=MAX_POWER; releaseCharge(); } }
        $('powerfill').style.width=(B.power/MAX_POWER*100)+'%';
        $('powerbar').classList.toggle('hidden',!B.charging);
        $('anglechip').textContent = w.kind==='strike'
          ? 'RUN '+((Math.round(B.strikeHeading*180/Math.PI)%360+360)%360).toString().padStart(3,'0')+'°'
          : Math.round(B.aimPitch*180/Math.PI)+'°';
        updateTraj(); updateAimDot(); updateStrikeMarker();
      }
      break; }
    case 'resolve': {
      B.st+=dt;
      $('powerbar').classList.add('hidden');
      const busy=B.projs.length>0||B.planes.length>0||B.mines.some(m=>m.fuse!=null&&!m.boomed)||
        B.hogs.some(x=>!x.dead&&!x.boat&&!x.tank&&!x.ship&&!x.grounded);
      // hard backstop: never let the turn hang, whatever gets stuck
      if(!busy&&B.st>0.6||B.st>12){
        // score the turn's shot now that everything it set off has finished
        if(B.stats&&B.shotTeam!=null){
          if(B.shotHitFoe) ST(B.shotTeam).hits++;
          ST(B.shotTeam).turns++;
          B.shotTeam=null;
        }
        if(!B.shotHurt&&h&&!h.dead&&Math.random()<0.5) bubble(h,pick(Q.miss));
        const left=livingTeams();
        if(left.length<=1) endBattle(left.length===1?left[0]:-1);
        else { B.state='end'; B.st=0; }
      }
      break; }
    case 'end':
      B.st+=dt;
      if(B.st>0.7) beginTurn(false);
      break;
  }
  const myAction=B.state==='action'&&!isAI(B.team);
  const wk=currentWeapon().kind;
  // the scope/zoom is only ever valid while YOU are aiming — the enemy's turn,
  // the resolve phase and the end screen must always drop back out of it
  if(!myAction){
    $('scope').classList.add('hidden');
    if(camera.fov<55){
      camera.fov+=(55-camera.fov)*0.2;
      if(camera.fov>54.9) camera.fov=55;
      camera.updateProjectionMatrix();
    }
  }
  $('crosshair').classList.toggle('hidden',!(myAction&&CROSSHAIR_KINDS.includes(wk)));
  $('hint').classList.toggle('hidden',!myAction);
  if(myAction){
    const nearBoat=h&&!h.boat&&!h.tank&&boatAt(h.position,BOARD_RANGE);
    const nearTank=h&&!h.boat&&!h.tank&&tankAt(h.position,BOARD_RANGE);
    const nearEmp=h&&!h.boat&&!h.tank&&!h.emplacement&&emplacementAt(h.position,6.5);
    const mode= h&&h.ship?'ship'
              : h&&h.tank?'tank'
              : h&&h.boat?(shipAt(h.position,18)?'alongside':'sail')
              : h&&h.emplacement?'gun'
              : nearTank?'boardTank' : nearBoat?'board' : nearEmp?'manGun'
              : wk==='strike'?'bomb' : 'base';
    if(mode!==hintIsBomber){
      hintIsBomber=mode;
      const key=gpActive?'B':keyLabel(binds.board);
      $('hint').innerHTML =
        mode==='ship'      ? '<b>WASD</b> steer the carrier &nbsp;·&nbsp; <b>'+(gpActive?'RT':'SPACE')+'</b> launch the strike &nbsp;·&nbsp; <b>'+key+'</b> back to your RHIB'
      : mode==='alongside' ? '<b>'+key+'</b> climb aboard the carrier &nbsp;·&nbsp; <b>WASD</b> to pull away'
      : mode==='tank'      ? '<b>WASD</b> drive &nbsp;·&nbsp; <b>'+(gpActive?'RT':'SPACE')+'</b> fire the main gun &nbsp;·&nbsp; <b>'+key+'</b> bail out'
      : mode==='boardTank' ? '<b>'+key+'</b> mount up'
      : mode==='gun'       ? '<b>'+(gpActive?'RT':'SPACE')+'</b> fire the emplaced gun &nbsp;·&nbsp; <b>'+key+'</b> stand down'
      : mode==='manGun'    ? '<b>'+key+'</b> man the gun'
      : mode==='sail'  ? '<b>WASD</b> steer the RHIB &nbsp;·&nbsp; <b>'+key+'</b> go ashore'
      : mode==='board' ? '<b>'+key+'</b> board the RHIB'
      : mode==='bomb'  ? '<b>BOMBSIGHT</b> &nbsp;·&nbsp; '+(gpActive?'<b>right stick</b> move the target':'<b>move the mouse</b> to place the target')+' &nbsp;·&nbsp; <b>'+(gpActive?'D-pad ↑↓':'↑↓')+'</b> swing the run &nbsp;·&nbsp; <b>'+(gpActive?'RT':'SPACE')+'</b> call it in'
      : defaultHint;
    }
  }
  $('anglechip').classList.toggle('hidden',!(myAction&&(BALLISTIC_KINDS.includes(wk)||wk==='strike')));
  if(h&&!h.dead&&(B.state==='action'||B.state==='start')){
    marker.visible=true;
    marker.position.set(h.position.x,h.position.y+5+Math.sin(performance.now()*0.005)*0.4,h.position.z);
    marker.rotation.y+=dt*2;
  } else marker.visible=false;
  if(B.state==='action'&&h&&!isAI(B.team)) cam.follow=h.mesh;
  updateHUD(); updateTags(); updateAssetTags(); updateCamera(dt);
  composer.render();
}

/* ================= BATTLE END / CAMPAIGN ================= */
/* The scoreboard. One column per side in a skirmish; the career totals when a
   campaign is finished. Same table either way so there is one thing to read. */
const STAT_ROWS=[
  ['Shots fired',   s=>s.shots],
  ['Accuracy',      s=>pct(s.hits,s.shots)],
  ['Kills',         s=>s.kills],
  ['Losses',        s=>s.losses],
  ['K/D ratio',     s=>kd(s.kills,s.losses)],
  ['Damage dealt',  s=>Math.round(s.dmg)],
  ['Damage taken',  s=>Math.round(s.taken)],
  ['Longest kill',  s=>s.best?s.best+'m':'—'],
  ['Drowned',       s=>s.drowned],
  ['Own goals',     s=>s.tkKills],
  ['Lost to mishaps',s=>s.mishap],
  ['Friendly fire', s=>Math.round(s.tk)],
  ['Vehicles killed',s=>s.vehicles],
  ['Favourite weapon',s=>favWeapon(s)],
];
function statTable(cols){
  // cols: [{label, tint, stats}]
  let h='<table class="stats"><tr><th></th>';
  for(const c of cols) h+='<th style="color:'+(c.tint||'inherit')+'">'+c.label+'</th>';
  h+='</tr>';
  for(const [name,fn] of STAT_ROWS){
    h+='<tr><td>'+name+'</td>';
    for(const c of cols) h+='<td>'+fn(c.stats)+'</td>';
    h+='</tr>';
  }
  return h+'</table>';
}
function battleStatsHTML(){
  if(!B||!B.stats) return '';
  const cols=B.cfg.nats.map((nat,i)=>({
    label:NATIONS[nat].team, tint:TEAM_TINT[i%TEAM_TINT.length], stats:B.stats[i]}));
  return '<div class="statwrap"><div class="stathead">Battle Report</div>'+statTable(cols)+'</div>';
}
function careerStatsHTML(){
  const c=campaign&&campaign.career;
  if(!c) return '';
  const extra='<div class="small" style="margin-top:6px;opacity:.75">'+
    (c.battles||0)+' battles · '+(c.won||0)+' won · '+
    pct(c.won||0,c.battles||0)+' win rate · '+(c.rounds||0)+' rounds fought</div>';
  return '<div class="statwrap"><div class="stathead">Service Record</div>'+
    statTable([{label:NATIONS[campaign.natIdx].team,tint:TEAM_TINT[0],stats:c}])+extra+'</div>';
}
function endBattle(winner){
  if(B.over) return;
  B.over=true; B.state='done';
  const isCamp=B.cfg.campaign, playerWon=winner===0;
  $('hud').classList.add('hidden'); $('tray').classList.add('hidden');
  $('crosshair').classList.add('hidden'); $('powerbar').classList.add('hidden');
  const title=$('endTitle'), text=$('endText'), sq=$('endSquad'), btnNext=$('btnNext');
  sq.innerHTML='';
  $('btnArmEnd').classList.add('hidden');
  const endedB=B;
  setTimeout(()=>{
    // don't pop an old battle's result over a new one the player already started
    if(!B||B!==endedB){ return; }
    if(!B.cfg.ai.some(Boolean)||(B.cfg.humans||0)>1){
      const n=winner>=0?NATIONS[B.cfg.nats[winner]]:null;
      title.textContent=winner===-1?'Mutual Destruction':n.team+' win!';
      text.textContent=winner===-1?"Nobody's left standing. Well fought, idiots."
        :(B.cfg.nats.length>2?'Last squad standing out of '+B.cfg.nats.length+'. Rematch?'
                             :'The other lot have been comprehensively porked. Rematch?');
      btnNext.textContent='Rematch';
    } else if(winner===-1){
      if(isCamp) bankCareer(false);
      title.textContent='Mutual Destruction';
      text.textContent="Everybody's bacon. The swill remains unclaimed. HQ is not amused.";
      btnNext.textContent=isCamp?'Retry Region':'Rematch';
    } else if(playerWon){
      title.textContent='Victory!';
      speak('Victory! Medals and swill all round!');
      if(isCamp) bankCareer(true);
      if(isCamp){
        campaign.mission++;
        const survivors=B.hogs.filter(x=>x.team===0&&!x.dead).map(x=>x.ref);
        campaign.squad.forEach(m=>{
          const row=document.createElement('div');
          if(survivors.includes(m)){
            // Pace both rewards across all 25 regions. Promoting every win burned
            // through all six ranks by region 6, and +10 health a win ran to +250
            // by the end — far past the enemy's capped +60.
            m.wins=(m.wins||0)+1;
            const wasRank=m.rank;
            m.rank=Math.min(Math.floor(m.wins/4),RANKS.length-1);
            m.maxhp=Math.min(m.maxhp+4,170+20*(m.up||0));
            row.innerHTML='<b>'+m.name+'</b> <span class="cls">'+
              (m.rank>wasRank?'promoted to '+RANKS[m.rank]:RANKS[m.rank]+' · '+m.maxhp+' HP')+'</span>'; }
          else row.innerHTML='<b style="text-decoration:line-through">'+m.name+'</b> <span class="cls">replaced by fresh recruit</span>';
          sq.appendChild(row);
        });
        campaign.squad=campaign.squad.map(m=>survivors.includes(m)?m:
          {name:pick(NATIONS[campaign.natIdx].names),cls:m.cls,rank:0,maxhp:100,up:0,wins:0});
        // pay out swill marks for the battle
        const e=B.earned||{kills:0,dmg:0};
        const purse=e.kills*BOUNTY.kill+Math.floor(e.dmg/BOUNTY.dmgPer)
                   +BOUNTY.victory+survivors.length*BOUNTY.survivor;
        campaign.coins=(campaign.coins||0)+purse;
        const pay=document.createElement('div');
        pay.style.gridColumn='1 / -1';
        pay.innerHTML='<span class="cls">Swill marks earned</span><br>'+
          e.kills+' kills ('+(e.kills*BOUNTY.kill)+') &middot; damage ('+Math.floor(e.dmg/BOUNTY.dmgPer)+
          ') &middot; victory ('+BOUNTY.victory+') &middot; '+survivors.length+' survivors ('+
          (survivors.length*BOUNTY.survivor)+')<br><b>+'+purse+' &nbsp;→&nbsp; purse '+campaign.coins+'</b>';
        sq.appendChild(pay);
        save();
        if(campaign.mission>=REGIONS.length){
          title.textContent='HAMLANTIS IS OURS!';
          text.textContent='All 25 regions conquered! The swill flows like... well, swill. Your hogs retire to a lifetime of luxury wallowing. The '+NATIONS[campaign.natIdx].team+' salute you!';
          btnNext.textContent='New Campaign'; clearSave(); campaign=null;
        } else {
          text.textContent='The region is ours, and the swill with it! But '+(REGIONS.length-campaign.mission)+' region'+(REGIONS.length-campaign.mission>1?'s':'')+' still stand between us and total swill supremacy.';
          btnNext.textContent='Next Region';
          $('btnArmEnd').classList.remove('hidden');   // spend the purse before moving on
        }
      } else {
        text.textContent=B.cfg.nats.length>2
          ?'Last squad standing out of '+B.cfg.nats.length+'. The rest are crackling.'
          :'The enemy squad has been comprehensively porked. Jolly good show.';
        btnNext.textContent='Another Skirmish';
      }
    } else {
      title.textContent='Defeat...';
      speak('Defeat! You horrible lot!');
      // in a free-for-all it matters who actually took it, not just that you didn't
      const vic=(!isCamp&&winner>=0&&B.cfg.nats.length>2)?NATIONS[B.cfg.nats[winner]].team:null;
      text.textContent=isCamp
        ?'Your squad has been turned into a mixed grill. HQ has scraped together replacements — now get back out there and WIN!'
        :(vic?'Your squad has been turned into a mixed grill. '+vic+' took the field.'
             :'Your squad has been turned into a mixed grill. The enemy celebrates with extra swill.');
      btnNext.textContent=isCamp?'Retry Region':'Rematch';
      if(isCamp){ bankCareer(false); save(); }
    }
    const sb=$('endStats');
    if(sb){
      // a finished campaign gets the whole service record; everything else the battle
      const done=isCamp&&campaign&&campaign.mission>=REGIONS.length;
      sb.innerHTML=battleStatsHTML()+(isCamp?careerStatsHTML():'');
      sb.classList.toggle('wide',B.cfg.nats.length>3||done);
    }
    $('endscreen').classList.remove('hidden');
    screenState='end';
  },1100);
}
function launchCampaignMission(){
  const enemyPool=NATIONS.map((_,i)=>i).filter(i=>i!==campaign.natIdx);
  const enemyIdx=enemyPool[(campaign.mission*2+3)%enemyPool.length];
  const reg=REGIONS[campaign.mission];
  $('briefRegion').textContent=reg.name;
  $('briefSub').textContent='ISLAND '+reg.island.toUpperCase()+' — REGION '+(campaign.mission+1)+' OF '+REGIONS.length+' — VS '+NATIONS[enemyIdx].team;
  $('briefText').textContent='"'+reg.brief+'" — Gen. Hoggins\n\nCampaign ladder: six islands, twenty-five regions, and a full war that escalates from beach landings to air power, tank warfare, and a fortress island finale.';
  $('btnArmBrief').textContent='Armoury ('+coins()+' ⛃)';
  showOnly('briefing');
  speak(reg.brief);
  $('btnAttack').onclick=()=>{
    showOnly(null);
    startBattle({ nats:[campaign.natIdx,enemyIdx], ai:[false,true], campaign:true, theme:reg.theme,
      squads:[campaign.squad, makeSquad(enemyIdx)],
      // scaled across all 25 regions (was tuned for 5): accuracy tightens slowly and
      // the enemy HP bonus is capped so late regions are hard, not arithmetic-proof
      aiErr:Math.max(0.05,(0.30-campaign.mission*0.010))*DIFFS[difficulty].errMul,
      elStep:DIFFS[difficulty].elStep, sniperChance:DIFFS[difficulty].sniperChance,
      // the enemy now also carries upgrade tiers, so the flat bonus is trimmed
      hpBonus:Math.min(42,Math.round(campaign.mission*1.8)),
      foeUp:Math.min(3,Math.floor(campaign.mission/7)),
      foeW:Math.min(3,Math.floor((campaign.mission-2)/7)) });
  };
}

/* ================= ARMOURY ================= */
function coins(){ return (campaign&&campaign.coins)||0; }
function spend(n){ campaign.coins=coins()-n; save(); }
function buyHog(i){
  const m=campaign.squad[i], up=m.up||0;
  if(up>=MAX_TIER) return;
  const cost=HOG_UP_COST[up];
  if(coins()<cost) return;
  spend(cost);
  m.up=up+1; m.maxhp+=20;                 // each tier is worth 20 more health
  sfx('beep'); buildArmoury();
}
function buyElite(i){
  const m=campaign.squad[i];
  if(m.elite||coins()<ELITE_COST) return;
  spend(ELITE_COST);
  m.elite=true; m.maxhp+=30;
  sfx('beep'); buildArmoury();
}
function buyWeapon(id){
  if(!campaign.wUp) campaign.wUp={};
  const up=wLevel(id);
  if(up>=MAX_TIER) return;
  const cost=WPN_UP_COST[up];
  if(coins()<cost) return;
  spend(cost);
  campaign.wUp[id]=up+1;
  sfx('beep'); buildArmoury();
}
function tierPips(up){
  let s='';
  for(let i=0;i<MAX_TIER;i++) s+='<i class="pip'+(i<up?' on':'')+'"></i>';
  return s;
}
function buildArmoury(){
  if(!campaign) return;
  $('armCoins').textContent=coins();
  const hogWrap=$('armHogs'); hogWrap.innerHTML='';
  campaign.squad.forEach((m,i)=>{
    const up=m.up||0, maxed=up>=MAX_TIER, cost=maxed?0:HOG_UP_COST[up];
    const next=maxed?'Fully kitted out':HOG_TIERS[up].name+' — '+HOG_TIERS[up].blurb;
    const row=document.createElement('div');
    row.className='upRow'+(m.elite?' elite':'');
    const title=m.elite?ELITE_TITLE[m.cls]:m.cls;
    row.innerHTML=
      '<div class="upName"><b>'+m.name+'</b> <span class="cls">'+title+'</span>'+
        (m.elite?' <span class="sfTag">S.F.</span>':'')+
        '<div class="small">'+m.maxhp+' HP · pace ×'+hogSpeedMul(up).toFixed(2)+'</div></div>'+
      '<div class="upTier">'+tierPips(up)+'<div class="small">'+next+'</div></div>'+
      '<button class="buy'+(maxed||coins()<cost?' off':'')+'">'+(maxed?'MAX':cost+' ⛃')+'</button>';
    row.querySelector('button').onclick=()=>buyHog(i);
    hogWrap.appendChild(row);
    // special forces promotion sits under the hog it applies to
    const sf=document.createElement('div');
    sf.className='upRow sfRow';
    sf.innerHTML=
      '<div class="upName"><span class="cls">Special Forces</span>'+
        '<div class="small">'+ELITE_TITLE[m.cls]+'</div></div>'+
      '<div class="upTier"><div class="small">'+ELITE_PERK[m.cls]+'</div></div>'+
      '<button class="buy sf'+(m.elite||coins()<ELITE_COST?' off':'')+'">'+
        (m.elite?'ENLISTED':ELITE_COST+' ⛃')+'</button>';
    sf.querySelector('button').onclick=()=>buyElite(i);
    hogWrap.appendChild(sf);
  });
  const wWrap=$('armWpns'); wWrap.innerHTML='';
  WEAPONS.forEach(w=>{
    const up=wLevel(w.id), maxed=up>=MAX_TIER, cost=maxed?0:WPN_UP_COST[up];
    const next=maxed?'Fully honed':WPN_TIERS[up].name+' — '+WPN_TIERS[up].blurb;
    const row=document.createElement('div');
    row.className='upRow';
    row.innerHTML=
      '<div class="upName"><b>'+w.name+'</b>'+
        '<div class="small">'+(w.dmg?'dmg '+Math.round(w.dmg*(1+0.15*up)):'support')+
        (w.r?' · blast '+(w.r*(1+0.08*up)).toFixed(1):'')+'</div></div>'+
      '<div class="upTier">'+tierPips(up)+'<div class="small">'+next+'</div></div>'+
      '<button class="buy'+(maxed||coins()<cost?' off':'')+'">'+(maxed?'MAX':cost+' ⛃')+'</button>';
    row.querySelector('button').onclick=()=>buyWeapon(w.id);
    wWrap.appendChild(row);
  });
}
function openArmoury(from){
  if(!campaign) return;
  armouryReturn=from;
  buildArmoury();
  ['menu','natsel','briefing','endscreen','help'].forEach(x=>$(x).classList.add('hidden'));
  $('armoury').classList.remove('hidden');
  screenState='armoury';
}
let armouryReturn='briefing';
function closeArmoury(){
  $('armoury').classList.add('hidden');
  if(armouryReturn==='briefing'){ $('briefing').classList.remove('hidden'); screenState='briefing'; }
  else { $('endscreen').classList.remove('hidden'); screenState='end'; }
}

/* ================= MENUS ================= */
function showOnly(id){
  ['menu','natsel','briefing','endscreen','help','armoury'].forEach(x=>$(x).classList.add('hidden'));
  if(id){ $(id).classList.remove('hidden'); screenState=id==='briefing'?'briefing':id; }
}
let selNat=0, previewedSquad=null;
/* ---------------- the skirmish roster ----------------
   Player 1 is always you and always human. Slots 2..6 each pick a nation and
   whether a person or the computer runs them, which is what turns this from a
   two-sided game into something a family can sit round. */
let roster=[{nat:0,human:true},{nat:1,human:false}];
function freeNation(taken){
  const pool=NATIONS.map((_,i)=>i).filter(i=>!taken.includes(i));
  return pool.length?pick(pool):0;
}
function setPlayerCount(k){
  k=clamp(k,2,Math.min(6,NATIONS.length));
  while(roster.length>k) roster.pop();
  while(roster.length<k) roster.push({nat:freeNation(roster.map(r=>r.nat)),human:false});
  buildRoster();
}
function buildRoster(){
  const box=$('roster'); if(!box) return;
  roster[0].nat=selNat;
  // two squads can't both fly the same flag, so shove any clash onto a free one
  for(let i=1;i<roster.length;i++){
    const taken=roster.slice(0,i).map(r=>r.nat);
    if(taken.includes(roster[i].nat)) roster[i].nat=freeNation(taken);
  }
  box.innerHTML='';
  roster.forEach((r,i)=>{
    const nat=NATIONS[r.nat];
    const row=document.createElement('div');
    row.className='prow';
    row.style.borderLeftColor=TEAM_TINT[i%TEAM_TINT.length];
    row.innerHTML='<span class="pno">P'+(i+1)+'</span>'+
      '<button class="pbtn pnat"'+(i===0?' disabled':'')+'>'+nat.team+'</button>'+
      '<button class="pbtn pwho'+(r.human?' human':'')+'"'+(i===0?' disabled':'')+'>'+
      (r.human?'Human':'CPU')+'</button>';
    if(i>0){
      row.querySelector('.pnat').onclick=()=>{
        const taken=roster.filter((_,k)=>k!==i).map(x=>x.nat);
        let k=r.nat;
        for(let s=0;s<NATIONS.length;s++){ k=(k+1)%NATIONS.length; if(!taken.includes(k)) break; }
        r.nat=k; buildRoster();
      };
      row.querySelector('.pwho').onclick=()=>{ r.human=!r.human; buildRoster(); };
    }
    box.appendChild(row);
  });
  const cnt=$('pcount');
  if(cnt) [...cnt.children].forEach(b=>b.classList.toggle('sel',+b.dataset.p===roster.length));
  const hs=$('hotnote');
  if(hs){
    const humans=roster.filter(r=>r.human).length;
    hs.textContent=humans>1
      ? humans+' players share this machine — pass it on when prompted.'
      : 'Add a second Human to play hot-seat with someone else.';
  }
}
function skirmishCfg(){
  const D=DIFFS[difficulty];
  roster[0].nat=selNat; roster[0].human=true;
  return { nats:roster.map(r=>r.nat), ai:roster.map(r=>!r.human), campaign:false,
    humans:roster.filter(r=>r.human).length,
    theme:pick(['beach','green','rock','snow','desert']),
    squads:roster.map((r,i)=>i===0?previewedSquad:makeSquad(r.nat)),
    aiErr:0.22*D.errMul, elStep:D.elStep, sniperChance:D.sniperChance, hpBonus:0 };
}
function buildNations(){
  const g=$('natgrid'); g.innerHTML='';
  NATIONS.forEach((n,i)=>{
    const d=document.createElement('div');
    d.className='nation'+(i===selNat?' sel':'');
    d.innerHTML='<div class="flag" style="background:linear-gradient(90deg,'+n.flag[0]+' 33%,'+n.flag[1]+' 33% 66%,'+n.flag[2]+' 66%)"></div>'+
      '<div class="tname">'+n.team+'</div><div class="cname">'+n.name+'</div>'+
      '<div class="perk">'+n.perk+'</div>';
    d.onclick=()=>{ selNat=i; buildNations(); previewSquad(); buildRoster(); };
    g.appendChild(d);
  });
}
function previewSquad(){
  previewedSquad=makeSquad(selNat);
  const p=$('squadPreview'); p.innerHTML='';
  const nat=NATIONS[selNat];
  const head=document.createElement('div');
  head.innerHTML='<b>'+nat.team+'</b><br><span class="small">Nation perk: '+nat.perk+'</span>';
  p.appendChild(head);
  previewedSquad.forEach(m=>{
    const d=document.createElement('div');
    const cls=CLASSES.find(c=>c.id===m.cls);
    d.innerHTML='<b>'+m.name+'</b> <span class="cls">'+m.cls+'</span><br><span class="small">'+cls.blurb+'</span><br><span class="small">Officer branch: '+cls.officer+'</span>';
    p.appendChild(d);
  });
}
$('btnCampaign').onclick=()=>{ pendingMode='campaign'; $('modeRow').classList.add('hidden'); showOnly('natsel'); buildNations(); previewSquad(); };
$('btnSkirmish').onclick=()=>{ pendingMode='skirmish'; $('modeRow').classList.remove('hidden');
  showOnly('natsel'); buildNations(); previewSquad(); buildRoster(); };
$('btnContinue').onclick=()=>{ campaign=loadSave(); if(campaign) launchCampaignMission(); };
$('btnHow').onclick=()=>$('help').classList.remove('hidden');
$('btnHostGame').onclick=()=>{ pendingMode='skirmish'; startHosting(); };
$('btnJoinGame').onclick=()=>{ $('joinbox').classList.remove('hidden'); $('joinCode').value=''; $('joinCode').focus(); };
$('btnJoinGo').onclick=()=>{ const c=NET.normaliseCode($('joinCode').value);
  $('joinbox').classList.add('hidden'); startJoining(c); };
$('btnJoinCancel').onclick=()=>$('joinbox').classList.add('hidden');
$('joinCode').addEventListener('keydown',e=>{ if(e.key==='Enter') $('btnJoinGo').click(); });
$('btnLobbyLeave').onclick=()=>{ netLeave(); showOnly('menu'); };
$('btnCopyCode').onclick=()=>{
  try{ navigator.clipboard.writeText(NETG.code||''); netStatus('Room code copied','ok');
       setTimeout(()=>netStatus(''),1800); }catch(e){}
};
$('btnCpuCover').onclick=()=>hostCpuCover();
$('btnLobbyStart').onclick=()=>{
  if(!NETG.isHost) return;
  // anybody who never turned up plays as a CPU squad
  NETG.players.forEach(p=>{ if(!p.connected) p.cpu=true; });
  const seed=newSeed();
  setSeed(seed);
  const squads=NETG.players.map(p=>makeSquad(p.nat));
  const D=DIFFS[difficulty];
  const cfg={ nats:NETG.players.map(p=>p.nat),
    ai:NETG.players.map(p=>!!p.cpu||!p.connected),
    campaign:false, humans:NETG.players.filter(p=>p.connected&&!p.cpu).length,
    online:true, seed,
    theme:['beach','green','rock','snow','desert'][Math.floor(rnd()*5)],
    squads, aiErr:0.22*D.errMul, elStep:D.elStep,
    sniperChance:D.sniperChance, hpBonus:0 };
  NETG.link.send({t:'start', cfg});
  showOnly(null);
  startBattle(cfg);
};
{
  const lc=$('lobbyCount');
  if(lc) [...lc.children].forEach(b=>{ b.onclick=()=>setPlayerSeats(+b.dataset.p); });
}
$('btnRecord').onclick=()=>{
  const c=loadSave();
  const box=$('recordBody');
  box.innerHTML=(c&&c.career)
    ?(()=>{ const keep=campaign; campaign=c; const h=careerStatsHTML(); campaign=keep; return h; })()
    :'<p class="flavor">No service record yet. Finish a campaign battle and HQ will start keeping score.</p>';
  $('record').classList.remove('hidden');
};
$('btnCloseRecord').onclick=()=>$('record').classList.add('hidden');
$('btnCloseHelp').onclick=()=>$('help').classList.add('hidden');
$('helpbtn').onclick=()=>$('help').classList.toggle('hidden');
$('btnBack1').onclick=()=>showOnly('menu');
$('btnAbort').onclick=()=>showOnly('menu');
$('btnDeploy').onclick=()=>{
  if(pendingMode==='campaign'){
    campaign={natIdx:selNat, mission:0, squad:previewedSquad, coins:0, wUp:{}};
    save(); launchCampaignMission();
  } else {
    showOnly(null);
    startBattle(skirmishCfg());
  }
};
$('btnNext').onclick=()=>{
  $('endscreen').classList.add('hidden');
  if(B&&B.cfg.campaign&&campaign) launchCampaignMission();
  else if(B&&!B.cfg.campaign){
    const cfg=B.cfg; showOnly(null);
    startBattle({...cfg, theme:pick(['beach','green','rock','snow','desert']),
      squads:cfg.nats.map(i=>makeSquad(i))});
  } else { disposeBattle(); showOnly('menu'); refreshContinue(); refreshRecordBtn(); refreshRecordBtn(); }
};
$('btnHome').onclick=()=>{ $('endscreen').classList.add('hidden'); disposeBattle();
  $('hud').classList.add('hidden'); $('tray').classList.add('hidden');
  showOnly('menu'); refreshContinue(); refreshRecordBtn(); refreshRecordBtn(); };
{
  const pc=$('pcount');
  if(pc) [...pc.children].forEach(b=>{ b.onclick=()=>setPlayerCount(+b.dataset.p); });
  const pg=$('btnPassGo');
  if(pg) pg.onclick=()=>{ $('passover').classList.add('hidden'); if(B) B.paused=false; };
}
$('voicebtn').onclick=toggleVoice;
$('sfxbtn').onclick=toggleSfx;
$('gfxbtn').onclick=cycleGfx;
$('fsbtn').onclick=toggleFullscreen;
$('touchbtn').onclick=cycleTouch;
$('btnArmBrief').onclick=()=>openArmoury('briefing');
$('btnArmEnd').onclick=()=>openArmoury('end');
$('btnArmClose').onclick=closeArmoury;
$('btnResetKeys').onclick=resetBinds;
$('btnTutorial').onclick=()=>{ $('help').classList.add('hidden'); showTutorial(0); };
$('tutNext').onclick=()=>showTutorial(tutStep+1);
$('tutSkip').onclick=closeTutorial;
document.querySelectorAll('#diffRow .diffbtn').forEach(b=>
  b.onclick=()=>setDifficulty(b.dataset.diff));
document.querySelectorAll('#sensRow .sensbtn').forEach(b=>
  b.onclick=()=>setSens(b.dataset.sens));
function refreshRecordBtn(){
  const b=$('btnRecord'); if(!b) return;
  const c=loadSave();
  b.classList.toggle('hidden',!(c&&c.career&&c.career.battles));
}
function refreshContinue(){
  const s=loadSave();
  $('btnContinue').classList.toggle('hidden',!s);
  if(s) $('btnContinue').textContent='Continue — Region '+(s.mission+1);
}

/* ================= BOOT ================= */

/* ================= ONLINE PLAY =================

   The host's machine is the hub: guests connect to it and nobody else. That
   gives us a single authority for the things that must be decided once — the
   map seed, who moves first, and what the CPU squads do.

   Everything else stays in step because the simulation is deterministic. We
   send *what a player did*, not *what happened*: a position and a shot. Both
   ends then run identical code over an identical seeded random stream and
   arrive at the same craters, the same damage, the same everything. That keeps
   the traffic to a few hundred bytes a turn instead of a state dump.

   The one thing that is NOT deterministic is the AI, which deliberately uses
   unsynced randomness. Only the host thinks for the CPU squads; it broadcasts
   their moves like any other player's. */

const NETG={ link:null, active:false, isHost:false, mySlot:0, code:null,
             players:[], paused:false, pauseMsg:'', applying:false,
             lastMoveSent:0, pendingStart:null, myToken:null };

function netOn(){ return NETG.active&&NETG.link; }

/* ---- keeping tabs on who is actually still there ---- */
const PING_EVERY=2000, GONE_AFTER=7000;
let netTimer=null;
function startHeartbeat(){
  stopHeartbeat();
  netTimer=setInterval(()=>{
    if(!netOn()) return;
    const now=Date.now();
    if(NETG.isHost){
      NETG.link.send({t:'ping'});
      // anybody who has gone quiet has gone
      NETG.players.forEach((p,slot)=>{
        if(!p.connected||slot===NETG.mySlot) return;
        if(p.lastSeen&&now-p.lastSeen>GONE_AFTER){
          p.connected=false; p.conn=null;
          lobbyRows(); netBroadcastLobby();
          if(B&&!B.over&&!NETG.paused) hostPause(slot);
        }
      });
    } else {
      NETG.link.send({t:'ping'});
      // the host going quiet is fatal — there is nobody else to ask
      if(NETG.lastHostSeen&&now-NETG.lastHostSeen>GONE_AFTER*2){
        netStatus('Lost contact with the host.','bad');
        NETG.paused=true;
        showPauseCard('Lost contact with the host. Waiting for them to come back…',false);
      }
    }
  },PING_EVERY);
}
function stopHeartbeat(){ if(netTimer){ clearInterval(netTimer); netTimer=null; } }
/* A fingerprint of everything that has to agree. Cheap enough to run every other
   turn: a sample of the ground, plus where everyone is and how hurt they are. */
function stateHash(){
  if(!B) return 0;
  let h=2166136261>>>0;
  const p=v=>{ const q=Math.round(v*100)|0; h^=q; h=Math.imul(h,16777619)>>>0; };
  for(let z=-TD/2;z<=TD/2;z+=11) for(let x=-TW/2;x<=TW/2;x+=11) p(heightAt(x,z));
  for(const g of B.hogs){ p(g.position.x); p(g.position.y); p(g.position.z); p(g.hp); p(g.dead?1:0); }
  p(waterLevel); p(B.team); p(B.turns);
  return h>>>0;
}
function alertBox(title,body){
  const ov=$('netalert'); if(!ov){ return; }
  $('alertTitle').textContent=title; $('alertBody').textContent=body;
  ov.classList.remove('hidden');
}
/* Is this side of the battle mine to drive? */
function iControl(team){
  if(!netOn()) return true;                    // offline: hot-seat rules apply
  if(isAI(team)) return NETG.isHost;           // the host thinks for the CPU
  return team===NETG.mySlot;
}
function netStatus(msg,cls){
  const el=$('netstatus'); if(!el) return;
  if(!msg){ el.classList.add('hidden'); return; }
  el.textContent=msg; el.className=cls||'';
  el.classList.remove('hidden');
}

/* ---------------- lobby ---------------- */
function lobbyRows(){
  const box=$('lobbyList'); if(!box) return;
  box.innerHTML='';
  NETG.players.forEach((p,i)=>{
    const row=document.createElement('div');
    row.className='prow';
    row.style.borderLeftColor=TEAM_TINT[i%TEAM_TINT.length];
    const who=p.cpu?'CPU':(p.connected?(p.you?'You':'Player'):'…waiting');
    row.innerHTML='<span class="pno">P'+(i+1)+'</span>'+
      '<button class="pbtn pnat"'+(NETG.isHost?'':' disabled')+'>'+NATIONS[p.nat].team+'</button>'+
      '<button class="pbtn pwho'+((p.connected&&!p.cpu)?' human':'')+'" disabled>'+who+'</button>';
    if(NETG.isHost){
      row.querySelector('.pnat').onclick=()=>{
        const taken=NETG.players.filter((_,k)=>k!==i).map(x=>x.nat);
        let k=p.nat;
        for(let s=0;s<NATIONS.length;s++){ k=(k+1)%NATIONS.length; if(!taken.includes(k)) break; }
        p.nat=k; lobbyRows(); netBroadcastLobby();
      };
    }
    box.appendChild(row);
  });
  const w=$('lobbyWait');
  if(w){
    const seated=NETG.players.filter(p=>p.connected||p.cpu).length;
    w.textContent=NETG.isHost
      ? seated+' of '+NETG.players.length+' seats filled. Empty seats play as CPU.'
      : 'Waiting for the host to start…';
  }
  const go=$('btnLobbyStart');
  if(go) go.classList.toggle('hidden',!NETG.isHost);
}
function netBroadcastLobby(){
  if(!NETG.isHost||!NETG.link) return;
  NETG.link.send({t:'lobby', players:NETG.players.map(p=>({nat:p.nat,connected:p.connected,cpu:p.cpu}))});
}
function setPlayerSeats(k){
  k=clamp(k,2,Math.min(6,NATIONS.length));
  const taken=()=>NETG.players.map(p=>p.nat);
  while(NETG.players.length>k) NETG.players.pop();
  while(NETG.players.length<k){
    const pool=NATIONS.map((_,i)=>i).filter(i=>!taken().includes(i));
    NETG.players.push({nat:pool.length?pool[0]:0,connected:false,cpu:false,conn:null,token:null});
  }
  const cnt=$('lobbyCount');
  if(cnt) [...cnt.children].forEach(b=>b.classList.toggle('sel',+b.dataset.p===NETG.players.length));
  lobbyRows(); netBroadcastLobby();
}

async function startHosting(){
  netStatus('Opening a room…');
  try{
    const link=await NET.host();
    NETG.link=link; NETG.active=true; NETG.isHost=true; NETG.mySlot=0; NETG.code=link.code;
    NETG.players=[];
    setPlayerSeats(4);
    NETG.players[0].connected=true; NETG.players[0].you=true;
    $('roomCode').textContent=link.code;
    lobbyRows(); netStatus('');
    showOnly('lobby');

    // Connecting claims nothing. We wait to hear who they are — see hostSeat().
    link.on('peerjoined',id=>{});
    link.on('peerleft',id=>{
      const slot=NETG.players.findIndex(p=>p.conn===id);
      if(slot<0) return;
      NETG.players[slot].connected=false; NETG.players[slot].conn=null;
      lobbyRows(); netBroadcastLobby();
      if(B&&!B.over) hostPause(slot);
    });
    link.on('message',(msg,who)=>hostHandle(msg,who));
    startHeartbeat();
    link.on('neterror',err=>netStatus('Connection trouble: '+(err&&err.type||err),'bad'));
  }catch(e){
    netStatus(e.message,'bad');
    showOnly('menu');
    alertBox('Could not open a room', e.message);
  }
}

async function startJoining(code){
  netStatus('Looking for room '+code+'…');
  try{
    const link=await NET.join(code);
    NETG.link=link; NETG.active=true; NETG.isHost=false; NETG.code=link.code;
    link.on('message',msg=>guestHandle(msg));
    NETG.lastHostSeen=Date.now();
    startHeartbeat();
    link.on('peerleft',()=>{ netStatus('Lost the host. The game cannot continue.','bad'); });
    link.on('neterror',err=>netStatus('Connection trouble','bad'));
    // if we have played in this room before, ask for our old seat back
    const saved=netRemembered(link.code);
    link.send(saved?{t:'rejoin', token:saved.token}:{t:'hello'});
    netStatus('');
    showOnly('lobby');
    $('roomCode').textContent=link.code;
    lobbyRows();
  }catch(e){
    netStatus(e.message,'bad');
    showOnly('menu');
    alertBox('Could not join', e.message);
  }
}
function netRemember(code,slot,token){
  try{ localStorage.setItem('hogs3net',JSON.stringify({code,slot,token})); }catch(e){}
}
function netRemembered(code){
  try{ const v=JSON.parse(localStorage.getItem('hogs3net')||'null');
    return (v&&v.code===code)?v:null; }catch(e){ return null; }
}

/* Put somebody in a seat and tell them about it. Used for both a first-time
   'hello' and a 'rejoin', so the two paths cannot drift apart. */
function hostSeat(slot,who){
  const p=NETG.players[slot];
  p.connected=true; p.conn=who; p.cpu=false; p.lastSeen=Date.now();
  p.token=p.token||('tk'+Math.random().toString(36).slice(2,10));
  if(B&&!B.over) B.cfg.ai[slot]=false;       // take the squad back off the computer
  NETG.link.send({t:'welcome', slot, token:p.token,
    players:NETG.players.map(x=>({nat:x.nat,connected:x.connected,cpu:x.cpu}))},who);
  lobbyRows(); netBroadcastLobby();
  if(B&&!B.over) hostSendSnapshot(who,slot);
  return p;
}

/* ---------------- host: message handling ---------------- */
function hostHandle(msg,who){
  const slot=NETG.players.findIndex(p=>p.conn===who);
  if(slot>=0) NETG.players[slot].lastSeen=Date.now();
  if(msg.t==='ping') return;
  // anything other than an introduction from an unseated connection is noise
  if(slot<0&&msg.t!=='hello'&&msg.t!=='rejoin') return;
  if(msg.t==='hash'){
    /* Drift is expected occasionally — a tab left in the background falls behind
       and cannot always catch up. Rather than argue about who is right, the host
       simply posts the truth back and the guest adopts it. */
    if(!B||B.over) return;
    if(msg.turns===B.turns&&msg.h!==stateHash()){
      NETG.desyncs=(NETG.desyncs||0)+1;
      hostSendSnapshot(who,slot);
    }
    return;
  }
  if(msg.t==='rejoin'){
    // a returning player reclaims their seat, even from the CPU
    const old=NETG.players.findIndex(p=>p.token===msg.token);
    if(old>=0){
      const p=hostSeat(old,who);
      if(B&&!B.over&&NETG.pausedSlot===old) hostResume();
      banner('PLAYER RETURNED',NATIONS[p.nat].team+' is back');
    } else {
      // we do not know that token — treat them as a newcomer
      const free=NETG.players.findIndex(p=>!p.connected&&!p.cpu);
      if(free<0){ NETG.link.send({t:'full'},who); return; }
      hostSeat(free,who);
    }
    return;
  }
  if(msg.t==='hello'){
    const free=NETG.players.findIndex(p=>!p.connected&&!p.cpu);
    if(free<0){ NETG.link.send({t:'full'},who); return; }
    hostSeat(free,who);
    return;
  }
  if(slot<0) return;
  if(msg.t==='act'||msg.t==='endturn'||msg.t==='move'){
    // only accept a move from whoever's turn it actually is
    if(!B||B.over||msg.team!==slot||B.team!==slot) return;
    NETG.link.sendExcept(msg,who);          // relay to the other guests
    applyRemote(msg);
  }
}

/* ---------------- guest: message handling ---------------- */
function guestHandle(msg){
  NETG.lastHostSeen=Date.now();
  if(msg.t==='ping') return;
  switch(msg.t){
    case 'welcome':
      NETG.mySlot=msg.slot; NETG.myToken=msg.token;
      netRemember(NETG.code,msg.slot,msg.token);
      NETG.players=msg.players.map(p=>({...p}));
      if(NETG.players[msg.slot]) NETG.players[msg.slot].you=true;
      lobbyRows();
      break;
    case 'full':
      netStatus('That game is full.','bad');
      alertBox('Game full','All six seats are taken.');
      netLeave();
      break;
    case 'lobby':
      NETG.players=msg.players.map((p,i)=>({...p,you:i===NETG.mySlot}));
      lobbyRows();
      break;
    case 'start':
      showOnly(null);
      startBattle(msg.cfg);
      break;
    case 'snapshot':
      applySnapshot(msg);
      break;
    case 'hashreq':
      NETG.link.send({t:'hash', turns:B?B.turns:-1, h:stateHash()});
      break;
    case 'pause':
      NETG.paused=true; NETG.pauseMsg=msg.msg;
      showPauseCard(msg.msg,false);
      break;
    case 'resume':
      NETG.paused=false; hidePauseCard();
      break;
    case 'act': case 'endturn': case 'move':
      applyRemote(msg);
      break;
  }
}

/* ---------------- pause, CPU cover, resume ---------------- */
function hostPause(slot){
  if(!B||B.over) return;
  NETG.paused=true;
  const who=NATIONS[NETG.players[slot].nat].team;
  NETG.pauseMsg=who+' has dropped out.';
  NETG.pausedSlot=slot;
  NETG.link.send({t:'pause', msg:NETG.pauseMsg});
  showPauseCard(NETG.pauseMsg,true);
}
function hostResume(){
  NETG.paused=false; NETG.pausedSlot=null;
  if(NETG.link) NETG.link.send({t:'resume'});
  hidePauseCard();
}
/* Hand the missing player's squad to the computer and carry on. If they come
   back, they take it straight off the CPU again. */
function hostCpuCover(){
  const slot=NETG.pausedSlot;
  if(slot==null||!B) return;
  NETG.players[slot].cpu=true;
  B.cfg.ai[slot]=true;
  netBroadcastLobby();
  hostResume();
  banner('CPU TAKING OVER',NATIONS[NETG.players[slot].nat].team+' is now computer-controlled');
}
function showPauseCard(msg,hostControls){
  const ov=$('netpause'); if(!ov) return;
  $('pauseMsg').textContent=msg;
  $('btnCpuCover').classList.toggle('hidden',!hostControls);
  $('pauseHint').textContent=hostControls
    ? 'The game is paused until they rejoin with the room code — or let the computer take their squad and carry on.'
    : 'The game is paused until they rejoin.';
  ov.classList.remove('hidden');
}
function hidePauseCard(){ const ov=$('netpause'); if(ov) ov.classList.add('hidden'); }

function netLeave(){
  stopHeartbeat();
  if(NETG.link) NETG.link.close();
  NETG.link=null; NETG.active=false; NETG.isHost=false; NETG.paused=false;
  NETG.players=[]; NETG.code=null;
  hidePauseCard(); netStatus('');
}

/* ---------------- sending what we did ---------------- */
function netSendAct(h,w,dir,speed){
  if(!netOn()||NETG.applying) return;
  NETG.link.send({t:'act', team:h.team,
    x:h.position.x, y:h.position.y, z:h.position.z,
    wid:w.id, dx:dir.x, dy:dir.y, dz:dir.z, sp:speed||0,
    aim:B.aiAimAt?[B.aiAimAt.x,B.aiAimAt.y,B.aiAimAt.z]:
        (B.strikeTarget?[B.strikeTarget.x,B.strikeTarget.y,B.strikeTarget.z]:null),
    head:B.strikeHeading, nap:!!B.napalm});
}
/* A light position feed so the others can watch you walk about. The shot itself
   carries the position that counts, so a dropped update costs nothing. */
function netSendMove(h){
  if(!netOn()||NETG.applying) return;
  const now=performance.now();
  if(now-NETG.lastMoveSent<100) return;
  NETG.lastMoveSent=now;
  NETG.link.send({t:'move', team:h.team, x:h.position.x, y:h.position.y, z:h.position.z});
}
function netSendEndTurn(team){
  if(!netOn()||NETG.applying) return;
  NETG.link.send({t:'endturn', team});
}

/* ---------------- applying what somebody else did ---------------- */
function applyRemote(msg){
  if(!B||B.over) return;
  NETG.applying=true;
  try{
    if(msg.t==='move'){
      const h=activeHog();
      if(h&&h.team===msg.team){ h.position.set(msg.x,msg.y,msg.z); h.grounded=true; }
    } else if(msg.t==='act'){
      const h=activeHog();
      if(!h||h.team!==msg.team) return;
      h.position.set(msg.x,msg.y,msg.z); h.grounded=true;
      B.napalm=!!msg.nap;
      B.strikeHeading=(msg.head==null?null:msg.head);
      B.aiAimAt=msg.aim?new THREE.Vector3(msg.aim[0],msg.aim[1],msg.aim[2]):null;
      const w=WEAPONS.find(x=>x.id===msg.wid);
      if(w) fire(h,w,new THREE.Vector3(msg.dx,msg.dy,msg.dz),msg.sp);
    } else if(msg.t==='endturn'){
      if(B.state==='action'&&B.team===msg.team) endAction();
    }
  } finally { NETG.applying=false; }
}

/* ---------------- catching a player up ---------------- */
function liveBlockIds(){
  const live=[];
  for(const bd of buildings) for(const b of (bd.blocks||[]))
    if(b.mesh&&b.mesh.userData.bid!==undefined) live.push(b.mesh.userData.bid);
  return live;
}
function packAmmo(all){
  return all.map(a=>{ const o={}; for(const k in a) o[k]=(a[k]===Infinity?null:a[k]); return o; });
}
function unpackAmmo(all){
  return all.map(a=>{ const o={}; for(const k in a) o[k]=(a[k]===null?Infinity:a[k]); return o; });
}
function buildSnapshot(){
  return { t:'snapshot',
    cfg:{...B.cfg, squads:B.cfg.squads},
    craters:craterLog,               // replayed onto a map rebuilt from the seed
    live:liveBlockIds(),             // everything still standing
    water:waterLevel,
    battle:{team:B.team, idx:B.idx.slice(), round:B.round, turns:B.turns,
            sudden:B.sudden, wind:B.wind, ammo:packAmmo(B.ammo), stats:B.stats, rng:rngState},
    hogs:B.hogs.map(h=>({team:h.team,x:h.position.x,y:h.position.y,z:h.position.z,
                          hp:h.hp,dead:h.dead})),
    gone:buildings.map(bd=>(bd.blocks||[]).length),
    tanks:tanks.map(t=>({x:t.x,z:t.z,yaw:t.yaw,hp:t.hp,dead:t.dead})),
    boats:boats.map(b=>({x:b.x,z:b.z,yaw:b.yaw})),
    emps:emplacements.map(e=>({shots:e.shots})) };
}
function hostSendSnapshot(to,slot){
  if(!B||B.over||!NETG.link) return;
  NETG.link.send(buildSnapshot(),to);
}
/* Rebuild the battle from the seed, then overwrite everything that has since
   changed. Regenerating from the seed is what makes this small — we only have
   to ship the differences, not the whole world. */
function applySnapshot(s){
  showOnly(null);
  startBattle({...s.cfg});             // identical battlefield, straight from the seed
  // dig every crater that has been blown since, in the order they happened
  if(s.craters&&s.craters.length){
    for(const c of s.craters) crater(c[0],c[1],c[2],c[3]);
    craterLog=s.craters.slice();       // so we can pass it on ourselves
  }
  // and knock out the blocks that are no longer standing
  if(s.live){
    const alive=new Set(s.live);
    for(const bd of buildings){
      if(!bd.blocks) continue;
      for(let i=bd.blocks.length-1;i>=0;i--){
        const b=bd.blocks[i];
        const id=b.mesh&&b.mesh.userData.bid;
        if(id!==undefined&&!alive.has(id)){
          if(b.mesh) scene.remove(b.mesh);
          bd.blocks.splice(i,1);
        }
      }
    }
  }
  waterLevel=s.water;
  B.team=s.battle.team; B.idx=s.battle.idx.slice(); B.round=s.battle.round;
  B.turns=s.battle.turns; B.sudden=s.battle.sudden; B.wind=s.battle.wind;
  B.ammo=unpackAmmo(s.battle.ammo); B.stats=s.battle.stats;
  setSeed(s.battle.rng);
  s.hogs.forEach((hs,i)=>{
    const h=B.hogs[i]; if(!h) return;
    h.position.set(hs.x,hs.y,hs.z); h.hp=hs.hp;
    if(hs.dead&&!h.dead){ h.dead=true; scene.remove(h.mesh); h.tag.style.display='none'; }
  });
  s.tanks.forEach((ts,i)=>{ const t=tanks[i]; if(!t) return;
    t.x=ts.x; t.z=ts.z; t.yaw=ts.yaw; t.hp=ts.hp;
    if(ts.dead&&!t.dead){ t.dead=true; scene.remove(t.mesh); } });
  s.boats.forEach((bs,i)=>{ const b=boats[i]; if(!b) return; b.x=bs.x; b.z=bs.z; b.yaw=bs.yaw; });
  s.emps.forEach((es,i)=>{ if(emplacements[i]) emplacements[i].shots=es.shots; });
  buildTeamBoxes(); buildTray(); updateHUD();
  banner('BACK IN','Caught up with the battle');
}

window.HOW2={ get B(){return B;}, get screen(){return screenState;}, get campaign(){return campaign;},
  hog:()=>activeHog(), boom, endAction, fire, WEAPONS, heightAt, aimDir,
  impactRing, aimDot, trajPts, get buildings(){return buildings;}, get debris(){return debris;}, get props(){return props;},
  get hazards(){return hazards;}, get loose(){return loose;}, get scene(){return scene;},
  get waterLevel(){return waterLevel;}, beginTurn, showTutorial, binds, hitscan,
  get touch(){return touch;}, get isTouch(){return isTouch;}, setTouchMode, looksLikeTouchDevice,
  cycleTouch, get touchPref(){return touchPref;},
  strikeMarker, cycleWeapon,
  camState:cam, genTerrain, planAIMove, planAI, planAIBoard, aiBoard, solveArc, simShot, PHYS_DT, stepProjPhysics,
  openArmoury, buildArmoury, buyHog, buyWeapon, get coins(){return coins();},
  buildTray, currentWeapon, canUse,
  get boats(){return boats;}, boardBoat, disembark, driveBoat, isNavigable, landNear,
  get tanks(){return tanks;}, get emplacements(){return emplacements;}, get ships(){return ships;},
  boardShip, leaveShip, shipAt, driveShip, shipFits, toggleNapalm, get fires(){return B&&B.fires;},
  boardTank, leaveTank, driveTank, tankAt, emplacementAt, damageTank,
  findSpawn, walkHog, BOARD_RANGE, surfaceY, hogPhysics, blockAt, floodTank, drown,
  setSeed, rnd, newSeed, get rngState(){return rngState;}, NET,
  NETG, startHosting, startJoining, netLeave, iControl, applyRemote, buildSnapshot, stateHash, hostSeat,
  get craterLog(){return craterLog;}, liveBlockIds,
  startHeartbeat, stopHeartbeat,
  applySnapshot, hostCpuCover, setPlayerSeats, netSendAct, netSendEndTurn,
  blankStats, mergeStats, battleStatsHTML, careerStatsHTML, bankCareer, ST,
  setWater:(y)=>{ waterLevel=y; }, WATER_Y,
  nTeams, foesOf, livingTeams, setPlayerCount, skirmishCfg, get roster(){return roster;},
  buildRoster, TEAM_TINT,
  startBattle, makeSquad, endBattle, disposeBattle,
  fov:()=>camera.fov, setFov:f=>{camera.fov=f;camera.updateProjectionMatrix();},
  lookScale, setSens, get sens(){return lookSens;},
  get gfx(){return gfx;}, get difficulty(){return difficulty;}, setDifficulty, cycleGfx,
  vec:(x,y,z)=>new THREE.Vector3(x,y,z) };
defaultHint=$('hint').innerHTML;
initVoice();
applyGfx();
gfxLabel();
setDifficulty(difficulty);
setSens(lookSens);
initTouch();
buildBindList();
$('fsbtn').textContent=document.fullscreenElement?'Exit Fullscreen':'Fullscreen';
$('sfxbtn').textContent='Sound: '+(sfxOn?'ON':'OFF');
genTerrain('green');
refreshContinue(); refreshRecordBtn(); refreshRecordBtn();
resize();
/* An exception thrown inside the animation loop kills it permanently — the game
   freezes with no message, which reads as a crash. Catch it, keep rendering, and
   put the reason on screen so it can actually be diagnosed. */
let loopErrShown=false;
window.HOW2.lastError=null;
renderer.setAnimationLoop(()=>{
  try{ update(); }
  catch(err){
    window.HOW2.lastError=err;
    if(!loopErrShown){
      loopErrShown=true;
      console.error('Hogs of War 2 — error in update():',err);
      const el=$('crashnote');
      if(el){
        el.textContent='Hiccup: '+((err&&err.message)||err)+' — the game kept running; please report this.';
        el.classList.remove('hidden');
        setTimeout(()=>el.classList.add('hidden'),9000);
      }
    }
  }
});
