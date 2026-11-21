import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync('POS/js/work-host.js','utf8');
function fixture(confirmed=false,owner=false,extra={}){
 const nodes=new Map(),listeners={},sent=[],frames=[];
 const home={classList:{contains:()=>true}};
 const body={classList:{add(){},remove(){}},appendChild(el){if(el.id)nodes.set(el.id,el);}};
 const create=(tag)=>{const element=({setAttribute(){},appendChild(){},addEventListener(){},remove(){nodes.delete(this.id);},contentWindow:{postMessage(m){sent.push(m);}}});if(tag==='iframe')frames.push(element);return element;};
 const root={document:{body,head:{appendChild(){}},readyState:'complete',createElement:create,getElementById:id=>id==='pageMenu'?home:nodes.get(id),querySelectorAll:()=>[{querySelector:q=>({textContent:q==='.qs-label'?'Ventas hoy':'S/ 100'})}]},location:{origin:'https://pos.test',search:'',hostname:'pos.test'},NA_HOSTED_CONFIG:{environment:'production'},NA_ROLES:{confirmed,role:owner?'owner':'empleado',isOwner:()=>owner,api:async()=>({reply:'real'})},addEventListener:(e,fn)=>listeners[e]=fn,setInterval(){},setTimeout:(fn)=>setTimeout(fn,1),MutationObserver:class{observe(){}},
  NA_ASISTENTE:{engine:{ready:()=>true,owner:()=>owner,prepare:t=>({text:t,context:{products:[{id:'1',nombre:'Arroz',precio:5,stock:3}]},cards:[]}),canExecute:()=>({ok:true}),expiry:()=>Date.now()+300000,
    add:p=>p.id,cancel(){},forget(){},forgetAll(){},state:()=>'pending',execute:async()=>({ok:true,msg:'ok'}),go:()=>({ok:true}),openDocument:async()=>({ok:true}),...(extra.engine||{})}},...(extra.root||{})};
 vm.runInNewContext(source,{window:root,URLSearchParams,Array,Object,String,Error});
 return {root,nodes,listeners,sent,frames};
}
test('WORK must not obscure activation or revoked session before role confirmation',()=>{
 const f=fixture(false,true);assert.equal(f.nodes.has('naWorkOverlay'),false);
});
test('confirmed employee receives no owner dashboard metrics',()=>{
 const f=fixture(true,false);f.listeners.message({origin:'https://pos.test',source:f.frames[0].contentWindow,data:{type:'na-work:metrics'}});
 assert.equal(f.sent.some(m=>m.metrics?.some(r=>r.value==='S/ 100')),false);
});

test('revoking confirmation closes WORK on role update',()=>{
 const f=fixture(true,true);assert.equal(f.nodes.has('naWorkOverlay'),true);
 f.root.NA_ROLES.confirmed=false;f.listeners['na:role']?.();
 assert.equal(f.nodes.has('naWorkOverlay'),false);
});
test('confirmed owner receives canonical metrics via same-origin bridge',()=>{
 const f=fixture(true,true);f.listeners.message({origin:'https://pos.test',source:f.frames[0].contentWindow,data:{type:'na-work:metrics'}});
 assert.equal(f.sent.some(m=>m.metrics?.some(r=>r.value==='S/ 100')),true);
});
test('cross-origin and unrelated frame messages cannot read metrics',()=>{
 const f=fixture(true,true);
 f.listeners.message({origin:'https://evil.test',source:f.frames[0].contentWindow,data:{type:'na-work:metrics'}});
 f.listeners.message({origin:'https://pos.test',source:{},data:{type:'na-work:metrics'}});
 assert.equal(f.sent.length,0);
});
test('second turn returns exact signed server history and new conversation clears it',async()=>{
 const f=fixture(true,true),calls=[];
 const turns=[{role:'user',content:'primero',sig:'signed-fixture',n:1,iat:1},{role:'assistant',content:'respuesta',sig:'signed-fixture',n:1,iat:1}];
 f.root.NA_ROLES.api=async(path,body)=>{calls.push(body);return {reply:'respuesta',turns};};
 const send=data=>f.listeners.message({origin:'https://pos.test',source:f.frames[0].contentWindow,data});
 send({type:'na-work:chat',id:'one',text:'primero'});await new Promise(setImmediate);
 send({type:'na-work:chat',id:'two',text:'continúa'});await new Promise(setImmediate);
 assert.equal(JSON.stringify(calls[1].history),JSON.stringify(turns));
 send({type:'na-work:reset'});send({type:'na-work:chat',id:'three',text:'nuevo'});await new Promise(setImmediate);
 assert.equal(calls[2].history.length,0);
});
test('confirmed identity change discards the previous WORK frame and private conversation',()=>{
 const f=fixture(true,true);assert.equal(f.frames.length,1);
 f.root.NA_ROLES.role='empleado';f.root.NA_ROLES.isOwner=()=>false;
 f.listeners['na:role']();assert.equal(f.frames.length,2);
});

test('WORK keeps exact invoice token across two follow-ups and clears it on reset and identity change',async()=>{
 const f=fixture(true,true),calls=[];
 const token='opaque.original-signature';
 f.root.NA_ROLES.api=async(path,body)=>{calls.push(body);return {reply:'Ocho líneas',invoice_memory:token};};
 const send=data=>f.listeners.message({origin:'https://pos.test',source:f.frames.at(-1).contentWindow,data});
 for(const [i,text] of ['Revisa la boleta','Cuántos productos hay','Enumera todos los productos'].entries()){
  send({type:'na-work:chat',id:String(i),text});await new Promise(setImmediate);
 }
 assert.equal(calls[0].invoice_memory,undefined);
 assert.equal(calls[1].invoice_memory,token);assert.equal(calls[2].invoice_memory,token);
 send({type:'na-work:reset'});send({type:'na-work:chat',id:'reset',text:'Nuevo'});await new Promise(setImmediate);
 assert.equal(calls[3].invoice_memory,undefined);
 f.root.NA_ROLES.deviceId='another-owner';f.listeners['na:role']();
 send({type:'na-work:chat',id:'other',text:'Hola'});await new Promise(setImmediate);
 assert.equal(calls[4].invoice_memory,undefined);
});


test('new photo replaces memory and null memory is not falsely claimed as retained',async()=>{
 const f=fixture(true,true),calls=[];
 let response={reply:'Lectura',invoice_memory:'old.signed'};
 f.root.NA_ROLES.api=async(path,body)=>{if(body.ping)return {role:'owner',vision:true}; calls.push(body);return response;};
 const send=data=>f.listeners.message({origin:'https://pos.test',source:f.frames.at(-1).contentWindow,data});
 send({type:'na-work:chat',id:'initial',text:'Primera'});await new Promise(setImmediate);
 response={reply:'Otra foto',invoice_memory:null};
 send({type:'na-work:chat',id:'photo',text:'Revisa',image:'data:image/jpeg;base64,YWJj'});await new Promise(setImmediate);
 assert.equal(calls[1].invoice_memory,undefined);assert.ok(calls[1].image);
 assert.ok(f.sent.some(m=>m.id==='photo'&&m.text.includes('No pude conservar')));
 send({type:'na-work:chat',id:'next',text:'Cuántos'});await new Promise(setImmediate);
 assert.equal(calls[2].invoice_memory,undefined);
});

test('an in-flight response after new conversation cannot restore discarded memory',async()=>{
 const f=fixture(true,true),calls=[];let release;
 f.root.NA_ROLES.api=async(path,body)=>{calls.push(body);if(calls.length===1)return new Promise(resolve=>{release=resolve;});return {reply:'nuevo'};};
 const send=data=>f.listeners.message({origin:'https://pos.test',source:f.frames.at(-1).contentWindow,data});
 send({type:'na-work:chat',id:'old',text:'Primero'});await new Promise(setImmediate);
 send({type:'na-work:reset'});release({reply:'respuesta anterior',invoice_memory:'stale.signed'});await new Promise(setImmediate);
 send({type:'na-work:chat',id:'new',text:'Nuevo'});await new Promise(setImmediate);
 assert.equal(calls[1].invoice_memory,undefined);assert.ok(!f.sent.some(m=>m.id==='old'));
});
