#!/usr/bin/env node
import { resolve } from 'node:path';
import { homedir } from 'node:os';
import { mkdirSync, openSync, closeSync, unlinkSync, readFileSync } from 'node:fs';
import { createServer, doctor } from '../src/server.mjs';
import { Store } from '../src/store.mjs';
import { defaultSettings } from '../src/agents.mjs';

const args=process.argv.slice(2),command=args[0]||'start';
const option=(name,fallback)=>{const i=args.indexOf('--'+name);if(i<0)return fallback;if(!args[i+1]||args[i+1].startsWith('--'))throw new Error(`Falta --${name}`);return args[i+1]};
const dir=resolve(option('data',process.env.TRIA_HOME||`${homedir()}/.tria`));
if(command==='help'||args.includes('--help')){
 console.log(`Tria 0.1.0 — Codex + Claude Code + OpenClaw\n\ntria start [--port 4310] [--host 127.0.0.1] [--data PATH]\ntria doctor [--data PATH]\ntria handoff\n\nTRIA_TOKEN: token opcional para acceder al panel. TRIA_HOME: directorio de datos.\nLas cuentas de los agentes se autentican en sus CLI. No necesita API keys.`);
}else if(command==='handoff')console.log(readFileSync(new URL('../docs/PARA_OPENCLAW.md',import.meta.url),'utf8'));
else if(command==='doctor'){const store=new Store(dir);console.log(JSON.stringify(await doctor(store.read('settings.json',defaultSettings())),null,2));}
else if(command==='start'){
 mkdirSync(dir,{recursive:true}); const lock=resolve(dir,'server.pid');
 try {
  try{const fd=openSync(lock,'wx');closeSync(fd)}catch(e){if(e.code!=='EEXIST')throw e;const pid=Number(readFileSync(lock,'utf8'));let alive=false;if(pid){try{process.kill(pid,0);alive=true}catch{}}if(alive)throw new Error(`Ya hay una instancia usando ${dir} (PID ${pid})`);unlinkSync(lock);const fd=openSync(lock,'wx');closeSync(fd)}
  const {writeFileSync}=await import('node:fs');writeFileSync(lock,String(process.pid));
  const app=await createServer({dir,host:option('host','127.0.0.1'),port:Number(option('port','4310')),token:process.env.TRIA_TOKEN||''});
  console.log(`Tria disponible en ${app.url}\nDatos: ${dir}\nAutenticación del panel: ${process.env.TRIA_TOKEN?'token configurado':'sin token (configurable con TRIA_TOKEN)'}`);
  let closing=false;const stop=async()=>{if(closing)return;closing=true;await app.close();try{unlinkSync(lock)}catch{}process.exit(0)};
  process.on('SIGINT',stop);process.on('SIGTERM',stop);
 }catch(e){try{if(readFileSync(lock,'utf8')===String(process.pid))unlinkSync(lock)}catch{}console.error(e.message);process.exitCode=1;}
}else{console.error('Comando desconocido. Usa tria help');process.exitCode=1;}
