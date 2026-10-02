import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { callAgent } from './agents.mjs';
import { discover, subscriptionEnv, runProcess } from './process.mjs';

export const providerIds=['codex','claude','gemini','kimi'];
export function teamFor(settings){return settings.team||['codex','claude']}
export function validateTeam(team){if(!Array.isArray(team)||team.length<2||new Set(team).size!==team.length||team.some(p=>!providerIds.includes(p)))throw new Error('Selecciona al menos dos agentes distintos: Codex, Claude, Gemini o Kimi.');return team;}
export function kimiEntry(command){
  if(/\.(mjs|js)$/i.test(command)&&existsSync(command))return command;
  const entry=join(dirname(command),'node_modules','@moonshot-ai','kimi-code','dist','main.mjs');
  if(existsSync(entry))return entry;
  throw new Error('Configura el ejecutable de Kimi Code instalado con npm install -g @moonshot-ai/kimi-code (versión 2.x).');
}
const psQuote=s=>"'"+s.replaceAll("'","''")+"'";
export async function loginProvider(id,settings){
  if(!providerIds.includes(id))throw new Error('Proveedor sin conector de cuenta');
  const command=settings[id]?.command||discover(id);
  const version=await runProcess(command,['--version'],{timeout:15000,env:subscriptionEnv()});
  if(version.code!==0)throw new Error('Primero instala el CLI del proveedor.');
  const args={codex:['login'],claude:['auth','login','--claudeai'],gemini:[],kimi:['login']}[id];
  const instruction=[command,...args].map(psQuote).join(' ');
  if(process.platform!=='win32')return {launched:false,detail:'Ejecuta en una terminal de la máquina donde vive Tria: '+instruction};
  const script=`Set-Location ${psQuote(tmpdir())}; & ${instruction}`;
  const child=spawn('powershell.exe',['-NoLogo','-NoProfile','-NoExit','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{detached:true,windowsHide:false,stdio:'ignore',env:subscriptionEnv()});
  await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject)});child.unref();
  return {launched:true,detail:'Se abrió una terminal de inicio de sesión en este ordenador. Completa la autorización del proveedor y pulsa Probar cuenta.'};
}
export async function probeProvider(id,settings){
  if(!providerIds.includes(id))throw new Error('Proveedor sin conector de cuenta');
  const cwd=mkdtempSync(join(tmpdir(),'tria-account-'));
  try {const response=await callAgent(id,'Responde exactamente TRIA_ACCOUNT_OK. No uses herramientas, no leas ni modifiques archivos.',{settings:{...settings,turnTimeoutMinutes:1},cwd});
    if(!response.includes('TRIA_ACCOUNT_OK'))throw new Error('El proveedor respondió, pero no confirmó la prueba esperada.');
    return {agent:id,loggedIn:true,detail:'Cuenta comprobada con una respuesta real. Esta prueba consume una consulta de tu cuenta.'};
  } finally {rmSync(cwd,{recursive:true,force:true});}
}
