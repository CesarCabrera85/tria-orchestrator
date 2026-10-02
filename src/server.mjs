import http from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { Store } from './store.mjs';
import { Engine } from './engine.mjs';
import { defaultSettings } from './agents.mjs';
import { runProcess, remoteProcess, subscriptionEnv } from './process.mjs';
import { providerIds, teamFor, validateTeam, loginProvider, probeProvider } from './providers.mjs';
import { ClaudeLogin } from './claude-login.mjs';

const publicDir=fileURLToPath(new URL('../public/',import.meta.url));
function json(res,code,data){res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));}
async function body(req){let s='';for await(const chunk of req){s+=chunk;if(s.length>1024*1024)throw new Error('Petición demasiado grande')}return s?JSON.parse(s):{};}
function same(a,b){const x=Buffer.from(a||''),y=Buffer.from(b||'');return x.length===y.length&&timingSafeEqual(x,y)}

export async function doctor(settings,agents=providerIds) {
  const results=await Promise.all(agents.map(async agent=>{
    const cfg=settings[agent]||defaultSettings()[agent];try{
      const version=await runProcess(cfg.command,['--version'],{timeout:15000,env:subscriptionEnv()});
      if(['gemini','kimi'].includes(agent))return {agent,command:cfg.command,installed:version.code===0,version:version.stdout.trim(),loggedIn:null,detail:'Pulsa Probar cuenta para comprobar una respuesta real.'};
      const auth=await runProcess(cfg.command,agent==='codex'?['login','status']:['auth','status'],{timeout:15000,env:subscriptionEnv()});
      let loggedIn=auth.code===0; if(agent==='claude'){try{loggedIn=JSON.parse(auth.stdout).loggedIn===true}catch{loggedIn=false}}
      return {agent,command:cfg.command,installed:version.code===0,version:version.stdout.trim(),loggedIn,detail:(auth.stderr||auth.stdout).trim()};
    }catch(e){return {agent,command:cfg.command,installed:false,loggedIn:false,detail:e.message}}
  }));return results;
}

export async function createServer({dir,host='127.0.0.1',port=4310,token='',agentCall}={}) {
  const store=new Store(dir);if(!store.read('settings.json'))store.write('settings.json',defaultSettings());
  const defaults=defaultSettings(),saved=store.read('settings.json');
  for(const id of providerIds)saved[id]={...defaults[id],...saved[id]};
  saved.team=validateTeam(teamFor(saved));delete saved.ssh.password;store.write('settings.json',saved);
  let sshPassword='';
  const claudeLogin = new ClaudeLogin();
  const publicSettings=()=>{const s=store.read('settings.json');delete s.ssh.password;s.ssh.hasPassword=!!sshPassword;return s;};
  const engine=new Engine(store,{agentCall,settingsProvider:()=>{const s=store.read('settings.json');s.ssh.password=sshPassword;return s}}); const clients=new Set();
  const server=http.createServer(async(req,res)=>{
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
    try {
      const url=new URL(req.url,'http://localhost'),path=url.pathname;
      if(path.startsWith('/api/')) {
        const cookies=Object.fromEntries((req.headers.cookie||'').split(';').map(c=>c.trim().split('=')));
        if(token&&!same(req.headers.authorization?.replace(/^Bearer /,''),token)&&!same(cookies.tria_token,encodeURIComponent(token))) {
          if(path==='/api/login'&&req.method==='POST') {const data=await body(req);if(same(data.token,token)){res.setHeader('Set-Cookie',`tria_token=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/`);return json(res,200,{ok:true})}}
          return json(res,401,{error:'Introduce el token de esta instancia'});
        }
        if(req.headers.origin&&new URL(req.headers.origin).host!==req.headers.host)return json(res,403,{error:'Origen distinto al de esta instancia'});
        if(!['GET','HEAD'].includes(req.method)&&!req.headers['content-type']?.startsWith('application/json'))return json(res,415,{error:'Se requiere application/json'});
        if(path==='/api/settings'&&req.method==='GET')return json(res,200,publicSettings());
        if(path==='/api/settings'&&req.method==='PUT') {
          if(engine.jobs.size)throw new Error('Detén las ejecuciones antes de cambiar conexiones');
          const value=await body(req),prev=engine.settings();
          for(const agent of ['codex','claude'])if(!value[agent]||typeof value[agent].command!=='string'||!value[agent].command.trim()||!['full','workspace'].includes(value[agent].access))throw new Error('Configuración de agentes inválida');
          for(const agent of ['gemini','kimi']){value[agent]={...prev[agent],...value[agent]};if(typeof value[agent].command!=='string'||!value[agent].command.trim())throw new Error('Falta el ejecutable de '+agent);}
          value.team=validateTeam(value.team||prev.team);
          if(!value.ssh||typeof value.ssh.target!=='string'||!value.openclaw||typeof value.openclaw.enabled!=='boolean')throw new Error('Configuración SSH/OpenClaw inválida');
          value.turnTimeoutMinutes=Math.min(180,Math.max(1,Number(value.turnTimeoutMinutes)||20));value.maxRepairRounds=Math.min(10,Math.max(0,Number(value.maxRepairRounds)||0));
          if(value.ssh.password!==undefined&&typeof value.ssh.password!=='string')throw new Error('Contraseña SSH inválida');
          if(value.ssh.forgetPassword)sshPassword='';else if(value.ssh.password)sshPassword=value.ssh.password;
          delete value.ssh.password;delete value.ssh.hasPassword;delete value.ssh.forgetPassword;
          store.write('settings.json',{...prev,...value});return json(res,200,{ok:true,hasPassword:!!sshPassword});
        }
        if(path==='/api/doctor'&&req.method==='GET')return json(res,200,await doctor(engine.settings()));
        if(path==='/api/providers/claude/login'&&req.method==='GET')return json(res,200,claudeLogin.snapshot());
        if(path==='/api/providers/claude/login-cancel'&&req.method==='POST'){claudeLogin.close();return json(res,200,claudeLogin.snapshot());}
        if(path==='/api/providers/claude/login-code'&&req.method==='POST'){
          if(engine.jobs.size)throw new Error('Detén las ejecuciones antes de cambiar cuentas.');
          const data=await body(req);return json(res,200,claudeLogin.submit(data.sessionId,data.code));
        }
        const providerRoute=path.match(/^\/api\/providers\/(codex|claude|gemini|kimi)\/(login|probe)$/);
        if(providerRoute&&req.method==='POST'){
          if(engine.jobs.size)throw new Error('Detén las ejecuciones antes de cambiar o comprobar cuentas.');
          const [,id,action]=providerRoute;
          if(id==='claude'&&action==='login')return json(res,200,await claudeLogin.start(engine.settings().claude.command));
          return json(res,200,await(action==='login'?loginProvider(id,engine.settings()):probeProvider(id,engine.settings())));
        }
        if(path==='/api/ssh/check'&&req.method==='POST') {
          const settings=engine.settings();const r=await remoteProcess(settings.ssh,settings.ssh.node||'node',['-e','console.log(JSON.stringify({hostname:require("os").hostname(),platform:process.platform,node:process.version,cwd:process.cwd()}))'],{timeout:20000,remoteCwd:settings.ssh.repoPath||undefined});
          return json(res,r.code===0?200:400,r.code===0?{ok:true,detail:r.stdout}:{error:r.stderr||r.stdout});
        }
        if(path==='/api/openclaw/handoff'&&req.method==='GET')return json(res,200,{text:readFileSync(new URL('../docs/PARA_OPENCLAW.md',import.meta.url),'utf8')});
        if(path==='/api/runs'&&req.method==='GET')return json(res,200,store.list());
        if(path==='/api/runs'&&req.method==='POST')return json(res,201,engine.create(await body(req)));
        const m=path.match(/^\/api\/runs\/([a-f0-9-]{36})(?:\/(\w+))?$/);
        if(m){const [,id,action]=m;
          if(!action&&req.method==='GET')return json(res,200,store.run(id));
          if(action==='events'&&req.method==='GET')return json(res,200,store.events(id));
          if(action==='stream'&&req.method==='GET') {
            const events=store.events(id);res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache','Connection':'keep-alive','X-Accel-Buffering':'no'});res.write('retry: 1500\n\n');
            const last=req.headers['last-event-id']||url.searchParams.get('after');const index=last?events.findIndex(e=>e.id===last):-1;
            const send=e=>res.write(`id: ${e.id}\ndata: ${JSON.stringify(e)}\n\n`);
            for(const e of events.slice(index+1))send(e);store.on(id,send);clients.add(res);
            const keep=setInterval(()=>res.write(': heartbeat\n\n'),15000);
            req.on('close',()=>{clearInterval(keep);store.off(id,send);clients.delete(res)});return;
          }
          if(req.method==='POST'){
            const data=await body(req);
            if(action==='start'){
              if(!agentCall){const cfg=engine.settings(),team=store.run(id).team||teamFor(cfg),health=await doctor(cfg,team);const missing=health.filter(a=>!a.installed||a.loggedIn===false);if(missing.length)throw new Error('Inicia sesión en los CLI antes de comenzar: '+missing.map(a=>a.agent).join(', '));for(const a of health)if(a.loggedIn===null)await probeProvider(a.agent,cfg);}
              return json(res,202,engine.start(id));
            }
            if(action==='pause')return json(res,202,engine.pause(id));
            if(action==='message')return json(res,200,engine.message(id,data.text));
            if(action==='instruct')return json(res,200,await engine.instruct(id,data.text,data.now===true));
            if(action==='publish')return json(res,200,await engine.publish(id));
            if(action==='deploy')return json(res,200,await engine.deploy(id,data));
          }
        }
        return json(res,404,{error:'Ruta no encontrada'});
      }
      const files={'/':['index.html','text/html'],'/app.js':['app.js','text/javascript'],'/run-activity.js':['run-activity.js','text/javascript'],'/claude-login.js':['claude-login.js','text/javascript'],'/style.css':['style.css','text/css']};
      if(files[path]){const [file,type]=files[path];res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'");res.writeHead(200,{'Content-Type':type+'; charset=utf-8'});return res.end(readFileSync(join(publicDir,file)));}
      res.writeHead(404);res.end('Not found');
    } catch(e){if(!res.headersSent)json(res,400,{error:e.message});else res.end();}
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,host,resolve)});
  return {server,store,engine,url:`http://${host}:${server.address().port}`,close:async()=>{claudeLogin.close();await engine.stop();for(const c of clients)c.end();server.closeIdleConnections();await new Promise(resolve=>server.close(resolve));}};
}
