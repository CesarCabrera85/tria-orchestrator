import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/store.mjs';
import { Engine } from '../src/engine.mjs';
import { defaultSettings, parseObject, textFromEvent } from '../src/agents.mjs';
import { checked, runProcess, shellCommand } from '../src/process.mjs';
import { createServer } from '../src/server.mjs';
import { validateTeam } from '../src/providers.mjs';

test('Gemini and Kimi share the plan, own tasks and review alongside Codex/Claude (fixture agents)',async()=>{
 const f=await fixture(),calls=[],cfg=defaultSettings();cfg.team=['codex','claude','gemini','kimi'];f.store.write('settings.json',cfg);
 const base=fakeAgent(calls);const engine=new Engine(f.store,{agentCall:async(a,p,o)=>{const result=await base(a,p,o);if(p.includes('acuerda un plan ejecutable')){const plan=JSON.parse(result);plan.tasks[0].owner='gemini';return JSON.stringify(plan)}return result}});
 const r=engine.create({repository:f.repo,goal:'Build greeting with all four'});engine.start(r.id);await engine.jobs.get(r.id).promise;
 const saved=f.store.run(r.id);assert.equal(saved.status,'completed',saved.error);assert.ok(calls.some(c=>c.agent==='gemini'&&c.prompt.includes('IMPLEMENTA la tarea')));assert.ok(calls.some(c=>c.agent==='kimi'&&c.prompt.includes('Revisa de forma independiente')));
 for(const id of cfg.team)assert.equal(saved.steps['final_'+id],true);
 assert.ok(calls.find(c=>c.prompt.includes('acuerda un plan ejecutable')).prompt.includes('kimi [debate]'));
 assert.throws(()=>validateTeam(['codex','deepseek']));assert.throws(()=>validateTeam(['codex','codex']));
});

test('SSH password is session-only, never returned, preserved by empty save and explicitly clearable',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'tria-password-api-')),app=await createServer({dir,port:0});
 const secret='test-only-&-$-secret';
 const put=async cfg=>{const r=await fetch(app.url+'/api/settings',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(cfg)});assert.equal(r.status,200);assert.ok(!(await r.text()).includes(secret))};
 try{let cfg=await(await fetch(app.url+'/api/settings')).json();cfg.ssh.password=secret;await put(cfg);
 assert.equal(app.engine.settings().ssh.password,secret);assert.ok(!readFileSync(join(dir,'settings.json'),'utf8').includes(secret));
 cfg=await(await fetch(app.url+'/api/settings')).json();assert.equal(cfg.ssh.hasPassword,true);assert.equal(cfg.ssh.password,undefined);
 cfg.ssh.password='';await put(cfg);assert.equal(app.engine.settings().ssh.password,secret);
 cfg.ssh.forgetPassword=true;await put(cfg);assert.equal(app.engine.settings().ssh.password,'');
 }finally{await app.close()}
});

async function fixture(){const dir=mkdtempSync(join(tmpdir(),'tria-test-'));const repo=join(dir,'repo');mkdirSync(repo);await checked('git',['init','-b','main'],{cwd:repo});writeFileSync(join(repo,'README.md'),'Implement a greeting.');writeFileSync(join(repo,'check.mjs'),"import assert from 'node:assert/strict';import{readFileSync}from'node:fs';assert.equal(readFileSync('result.txt','utf8'),'hello');");await checked('git',['add','.'],{cwd:repo});await checked('git',['-c','user.name=Test','-c','user.email=test@localhost','commit','-m','fixture'],{cwd:repo});const store=new Store(join(dir,'state'));store.write('settings.json',defaultSettings());return {dir,repo,store};}
function fakeAgent(log,{reviewFailOnce=false,verifyFailOnce=false,onTurn=()=>{}}={}){let reviewed=false;return async(agent,prompt,opts)=>{
 log.push({agent,prompt,cwd:opts.cwd});onTurn(agent,prompt,opts);
 if(prompt.includes('acuerda un plan ejecutable'))return JSON.stringify({summary:'Build greeting',tasks:[{title:'Greeting',owner:'codex',instructions:'Create result.txt',acceptance:'Contains hello'}],verificationCommands:['node check.mjs']});
 if(prompt.includes('IMPLEMENTA la tarea')){writeFileSync(join(opts.cwd,'result.txt'),verifyFailOnce?'wrong':'hello');return JSON.stringify({summary:'File created',blocked:false,evidence:[]})}
 if(prompt.includes('Corrige estos fallos reales')){writeFileSync(join(opts.cwd,'result.txt'),'hello');return JSON.stringify({summary:'Fixed',blocked:false})}
 if(prompt.includes('Revisa de forma independiente')){if(reviewFailOnce&&!reviewed){reviewed=true;return JSON.stringify({approved:false,summary:'Revise implementation',issues:['Missing requirement']})}return JSON.stringify({approved:true,summary:'Reviewed',issues:[]})}
 if(prompt.includes('Audita el resultado'))return JSON.stringify({approved:true,summary:'Goal met',issues:[]});
 return agent+' analysis';
};}

test('real Git + process verification, cross-agent review and persistent results (fixture agents)',async()=>{
 const f=await fixture(),calls=[],engine=new Engine(f.store,{agentCall:fakeAgent(calls,{reviewFailOnce:true,verifyFailOnce:true})});const r=engine.create({repository:f.repo,goal:'Build greeting'});engine.start(r.id);await engine.jobs.get(r.id).promise;
 const result=f.store.run(r.id);assert.equal(result.status,'completed',result.error);assert.equal(result.verification[0].code,0);assert.equal(readFileSync(join(result.workspace,'result.txt'),'utf8'),'hello');assert.equal(result.tasks[0].repairs,1);assert.equal(result.repairRound,1);assert.ok(calls.some(c=>c.agent==='claude'&&c.prompt.includes('Revisa de forma independiente')));assert.ok(calls.some(c=>c.prompt.includes('claude [debate]')));assert.equal((await checked('git',['status','--porcelain'],{cwd:result.workspace})).stdout,'');assert.ok(result.commit);assert.equal(f.store.run(r.id).steps.final_claude,true);
 await engine.publish(r.id);assert.equal(f.store.run(r.id).publishedCommit,result.commit);assert.equal((await checked('git',['rev-parse',result.branch],{cwd:f.repo})).stdout.trim(),result.commit);
 writeFileSync(join(result.workspace,'result.txt'),'post-test mutation');await assert.rejects(engine.publish(r.id),/cambió/);
});

test('pause preserves changes, messages delivered next turn and resume does not re-clone',async()=>{
 const f=await fixture(),calls=[];let entered;const started=new Promise(r=>entered=r);let first=true;
 const fake=fakeAgent(calls);const engine=new Engine(f.store,{agentCall:async(a,p,o)=>{if(p.includes('IMPLEMENTA la tarea')&&first){first=false;writeFileSync(join(o.cwd,'partial.txt'),'keep');entered();await new Promise((resolve,reject)=>o.signal.addEventListener('abort',()=>reject(new Error('stopped')),{once:true}));}return fake(a,p,o);}});
 const r=engine.create({repository:f.repo,goal:'Build greeting'});engine.start(r.id);await started;const job=engine.jobs.get(r.id);engine.message(r.id,'Preserve my feedback');engine.pause(r.id);await job.promise;assert.equal(f.store.run(r.id).status,'paused');assert.equal(f.store.run(r.id).messages[0].text,'Preserve my feedback');engine.start(r.id);await engine.jobs.get(r.id).promise;const result=f.store.run(r.id);assert.equal(result.status,'completed',result.error);assert.equal(readFileSync(join(result.workspace,'partial.txt'),'utf8'),'keep');assert.ok(calls.some(c=>c.prompt.includes('Preserve my feedback')));
});

test('provider failure never becomes completed and restart is explicit',async()=>{const f=await fixture();const engine=new Engine(f.store,{agentCall:async()=>{throw new Error('login required')}});const r=engine.create({repository:f.repo,goal:'Test'});engine.start(r.id);await engine.jobs.get(r.id).promise;assert.equal(f.store.run(r.id).status,'failed');const dirty=f.store.run(r.id);dirty.status='running';f.store.save(dirty);new Engine(f.store);assert.equal(f.store.run(r.id).status,'interrupted');});

test('OpenClaw receives the shared debate and its observations reach the planner (fixture agent)',async()=>{const f=await fixture(),calls=[];const cfg=defaultSettings();cfg.openclaw.enabled=true;f.store.write('settings.json',cfg);const engine=new Engine(f.store,{agentCall:fakeAgent(calls)});const r=engine.create({repository:f.repo,goal:'Build greeting'});engine.start(r.id);await engine.jobs.get(r.id).promise;assert.equal(f.store.run(r.id).status,'completed');const oc=calls.filter(c=>c.agent==='openclaw');assert.equal(oc.length,2);assert.match(oc[1].prompt,/claude \[debate\]/);assert.ok(calls.find(c=>c.prompt.includes('acuerda un plan ejecutable')).prompt.includes('openclaw [server-debate]'));});

test('code changes during final review invalidate prior verification',async()=>{const f=await fixture();const engine=new Engine(f.store,{agentCall:fakeAgent([],{onTurn:(a,p,o)=>{if(p.includes('Audita el resultado'))writeFileSync(join(o.cwd,'result.txt'),'untested change')}})});const r=engine.create({repository:f.repo,goal:'Build greeting'});engine.start(r.id);await engine.jobs.get(r.id).promise;const result=f.store.run(r.id);assert.equal(result.status,'failed');assert.equal(result.steps.verified,false);assert.match(result.error,/cambió durante la auditoría/);await assert.rejects(engine.publish(r.id),/completarse/);});

test('nonzero verification is rejected, repair attempts are bounded',async()=>{const f=await fixture();const settings=defaultSettings();settings.maxRepairRounds=0;f.store.write('settings.json',settings);const engine=new Engine(f.store,{agentCall:fakeAgent([])});const r=engine.create({repository:f.repo,goal:'Test',verificationCommands:['node -e "process.exit(7)"']});engine.start(r.id);await engine.jobs.get(r.id).promise;const result=f.store.run(r.id);assert.equal(result.status,'failed');assert.equal(result.verification[0].code,7);assert.equal(result.steps.final_codex,undefined)});

test('JSON extraction and real provider events',()=>{assert.deepEqual(parseObject('Here:\n```json\n{"summary":"a } brace","ok":true}\n```'),{summary:'a } brace',ok:true});assert.throws(()=>parseObject('not JSON'));assert.equal(textFromEvent('codex',{type:'item.completed',item:{type:'agent_message',text:'done'}}),'done');assert.equal(textFromEvent('claude',{type:'result',structured_output:{approved:true}}),'{"approved":true}');});

test('real subprocess streaming, timeout and cancellation',async()=>{const lines=[];const r=await runProcess(process.execPath,['-e',"console.log('one');console.error('two')"],{onLine:(ch,s)=>lines.push([ch,s])});assert.equal(r.code,0);assert.ok(lines.some(([c,s])=>c==='stderr'&&s==='two'));await assert.rejects(runProcess(process.execPath,['-e','setInterval(()=>{},1000)'],{timeout:100}),/agotado/);const c=new AbortController();setTimeout(()=>c.abort(),100);await assert.rejects(runProcess(process.execPath,['-e','setInterval(()=>{},1000)'],{signal:c.signal}),/detenida/);const failed=await shellCommand('node -e "process.exit(3)"');assert.equal(failed.code,3)});

test('HTTP API, token, origin, SSE persistence and settings',async()=>{const f=await fixture();const app=await createServer({dir:join(f.dir,'http'),port:0,token:'test-token',agentCall:fakeAgent([])});const get=async(path,options={})=>fetch(app.url+path,{...options,headers:{'Content-Type':'application/json','Authorization':'Bearer test-token',...options.headers}});
 try{
  assert.equal((await fetch(app.url+'/')).status,200);assert.equal((await fetch(app.url+'/api/settings')).status,401);const settings=await(await get('/api/settings')).json();assert.ok(settings.codex.command);
  assert.equal((await get('/api/runs',{method:'POST',headers:{Origin:'https://other.test'},body:JSON.stringify({repository:f.repo,goal:'test'})})).status,403);
  const run=await(await get('/api/runs',{method:'POST',body:JSON.stringify({repository:f.repo,goal:'Build greeting'})})).json();
  const controller=new AbortController();const response=await get(`/api/runs/${run.id}/stream`,{signal:controller.signal});const reader=response.body.getReader();const chunk=await reader.read();assert.match(new TextDecoder().decode(chunk.value),/created/);controller.abort();
  assert.equal((await get(`/api/runs/${run.id}/start`,{method:'POST',body:'{}'})).status,202);await app.engine.jobs.get(run.id).promise;
  const completed=await(await get(`/api/runs/${run.id}`)).json();assert.equal(completed.status,'completed',completed.error);const ev=await(await get(`/api/runs/${run.id}/events`)).json();assert.ok(ev.some(e=>e.type==='completed'));assert.ok(ev.some(e=>e.type==='message'&&e.agent==='claude'));
 }finally{await app.close()}
});
