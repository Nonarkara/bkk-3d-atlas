import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
function harness() {
  const document={hidden:false};
  const ctx=vm.createContext({window:{},document,state:{},console});
  const code=app.slice(app.indexOf('const WALL_BBOX'),app.indexOf('function wallTile('));
  vm.runInContext(code+'\nthis.wallTest={wallAttach,wallDetach,wallPlayers,wallVisible};',ctx);
  return {...ctx.wallTest,document};
}
class Video extends EventTarget {
  constructor(){super();this.dataset={hls:'https://example.test/live.m3u8'};this.badge={textContent:''};this.parentElement={querySelector:()=>this.badge};this.paused=0;}
  canPlayType(){return 'probably';}
  play(){return Promise.resolve();}
  pause(){this.paused++;}
  load(){}
  removeAttribute(){}
}
test('native-video failure frees a slot for a visible waiting camera',()=>{
  const h=harness(),videos=Array.from({length:13},()=>new Video());
  for(const v of videos){h.wallVisible.add(v);h.wallAttach(v);}
  assert.equal(h.wallPlayers.size,12);
  videos[0].dispatchEvent(new Event('error'));
  assert.equal(videos[0].dataset.failed,'1');
  assert.equal(h.wallPlayers.has(videos[0]),false);
  assert.equal(h.wallPlayers.has(videos[12]),true);
  assert.equal(h.wallPlayers.size,12);
});
test('detaching cleans stale media listeners and pauses the video',()=>{
  const h=harness(),v=new Video();h.wallVisible.add(v);h.wallAttach(v);
  h.wallVisible.delete(v);h.wallDetach(v);
  const before=v.badge.textContent;v.dispatchEvent(new Event('playing'));
  assert.equal(v.badge.textContent,before);assert.ok(v.paused>0);
});
test('background document cannot allocate players',()=>{
  const h=harness(),v=new Video();h.document.hidden=true;h.wallVisible.add(v);h.wallAttach(v);
  assert.equal(h.wallPlayers.size,0);
});
test('rejected native playback frees the slot rather than remaining loading',async()=>{
  const h=harness(),v=new Video();v.play=()=>Promise.reject(new Error('blocked'));
  h.wallVisible.add(v);h.wallAttach(v);await Promise.resolve();
  assert.equal(h.wallPlayers.size,0);assert.match(v.badge.textContent,/Playback blocked/);
});
test('an old play rejection cannot poison a newly attached session',async()=>{
  const h=harness(),v=new Video();let reject;
  v.play=()=>new Promise((_r,r)=>{reject=r;});h.wallVisible.add(v);h.wallAttach(v);
  h.wallVisible.delete(v);h.wallDetach(v);v.play=()=>Promise.resolve();
  h.wallVisible.add(v);h.wallAttach(v);reject(new Error('old'));await Promise.resolve();
  assert.equal(h.wallPlayers.has(v),true);assert.equal(v.dataset.failed,undefined);
});
test('close and reopen ignores old catalogue response and disconnects every observer',async()=>{
  const requests=[],observers=[];
  const grid={innerHTML:'',querySelectorAll:()=>[],addEventListener(){}};
  const count={};
  const close={focus(){},addEventListener(type,fn){this[type]=fn;}};
  const root={hidden:true,setAttribute(){},addEventListener(){},querySelector:s=>s.includes('grid')?grid:s.includes('count')?count:close};
  const opener={addEventListener(type,fn){this[type]=fn;}};
  const page={inert:false};
  const ctx=vm.createContext({window:{},state:{},MAHOLAN_CCTV_URL:'x',
    document:{activeElement:{focus(){}},hidden:false,createElement:()=>root,
      getElementById:()=>null,querySelector:()=>page,
      body:{appendChild(){},classList:{add(){},remove(){}}},
      addEventListener(){},querySelectorAll:()=>[opener]},
    IntersectionObserver:class{constructor(){this.disconnected=false;observers.push(this);}observe(){}disconnect(){this.disconnected=true;}},
    fetchLiveCctv:()=>new Promise(resolve=>requests.push(resolve)),fetchJson:async()=>({features:[]})});
  vm.runInContext(app.slice(app.indexOf('const WALL_BBOX'))+'\nwireCameraWall({});',ctx);
  opener.click({preventDefault(){}});assert.equal(page.inert,true);
  close.click();assert.equal(page.inert,false);opener.click({preventDefault(){}});
  requests[1]({features:[]});await new Promise(setImmediate);
  requests[0]({features:[]});await new Promise(setImmediate);
  close.click();assert.equal(observers.length,1);assert.ok(observers.every(o=>o.disconnected));assert.equal(page.inert,false);
});
