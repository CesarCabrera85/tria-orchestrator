import { runProcess, remoteProcess, discover, subscriptionEnv } from './process.mjs';
import { kimiEntry } from './providers.mjs';
import { fileURLToPath } from 'node:url';

export const defaultSettings=()=>({
  codex:{command:discover('codex'),model:'',access:'full'},
  claude:{command:discover('claude'),model:'',access:'full'},
  gemini:{command:discover('gemini'),model:'',access:'full'},
  kimi:{command:discover('kimi'),model:'',access:'full'},
  team:['codex','claude'],
  openclaw:{enabled:false,command:'openclaw',agent:'main'},
  ssh:{target:'',port:22,node:'node',identityFile:'',knownHostsFile:'',repoPath:''},
  turnTimeoutMinutes:20,maxRepairRounds:2
});

export function parseObject(text) {
  const clean=text.trim().replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,'');
  try{return JSON.parse(clean)}catch{}
  for(let start=clean.indexOf('{');start>=0;start=clean.indexOf('{',start+1)) {
    let depth=0,quoted=false,escape=false;
    for(let i=start;i<clean.length;i++) {const c=clean[i];if(quoted){if(escape)escape=false;else if(c==='\\')escape=true;else if(c==='"')quoted=false;continue}
      if(c==='"')quoted=true;else if(c==='{')depth++;else if(c==='}'&&--depth===0){try{return JSON.parse(clean.slice(start,i+1))}catch{break}}
    }
  } throw new Error('El agente no devolvió el objeto JSON esperado. Consulta su respuesta en la actividad.');
}

export function textFromEvent(agent,event) {
  if(agent==='codex' && event.type==='item.completed' && event.item?.type==='agent_message')return event.item.text||'';
  if(agent==='claude' && event.type==='result')return typeof event.structured_output==='object'?JSON.stringify(event.structured_output):event.result||'';
  if(agent==='kimi' && event.role==='assistant'&&!event.tool_calls?.length)return typeof event.content==='string'?event.content:(event.content||[]).filter(p=>p.type==='text').map(p=>p.text).join('\n');
  return '';
}

export async function callAgent(agent,prompt,{settings,cwd,signal,onEvent=()=>{},sessionId,outputSchema}={}) {
  const cfg=settings[agent]; const timeout=settings.turnTimeoutMinutes*60000;
  let args, final='', protocolError='';
  if(agent==='codex') {
    args=['exec','--json','--color','never','--sandbox',cfg.access==='full'?'danger-full-access':'workspace-write','-'];
    if(cfg.model) args.push('--model',cfg.model);
  } else if(agent==='claude') {
    args=['-p','--output-format','stream-json','--verbose','--include-partial-messages'];
    if(outputSchema)args.push('--json-schema',JSON.stringify(outputSchema));
    if(cfg.access==='full')args.push('--dangerously-skip-permissions');else args.push('--permission-mode','acceptEdits');
    if(cfg.model)args.push('--model',cfg.model);
  } else if(agent==='openclaw') {
    args=['agent','--agent',cfg.agent||'main','--session-id',sessionId,'--json','--message',prompt];
  } else if(agent==='gemini') {
    args=['--prompt','Sigue las instrucciones recibidas por stdin.','--output-format','json','--skip-trust','--approval-mode','yolo'];
    if(cfg.model)args.push('--model',cfg.model);
  } else if(agent==='kimi') {
    args=[fileURLToPath(new URL('./kimi-entry.mjs',import.meta.url)),kimiEntry(cfg.command)];
  } else throw new Error('Agente desconocido');
  const opts={cwd,signal,timeout,input:agent==='openclaw'?'':prompt,env:subscriptionEnv(),onLine:(channel,line)=>{
    let event;try{event=JSON.parse(line)}catch{}
    if(event) {
      const t=textFromEvent(agent,event);if(t)final=t;
      if(event.type==='turn.failed'||(event.type==='result'&&event.is_error))protocolError=event.error?.message||event.result||'El proveedor devolvió un error';
      onEvent({agent,channel,event});
    }else onEvent({agent,channel,text:line});
  }};
  if(agent==='claude')opts.env.CLAUDE_CODE_DISABLE_BACKGROUND_TASKS='1';
  if(agent==='kimi')opts.input=JSON.stringify({prompt,model:cfg.model});
  const result=agent==='openclaw' ? await remoteProcess(settings.ssh,cfg.command,args,opts) : await runProcess(agent==='kimi'?process.execPath:cfg.command,args,opts);
  if(agent==='gemini'&&result.code!==0){try{protocolError=parseObject(result.stdout).error?.message||''}catch{}}
  if(result.code!==0||protocolError)throw new Error(protocolError||`${agent}: ${(result.stderr||result.stdout).slice(-4000)}`);
  if(agent==='openclaw') {
    const v=parseObject(result.stdout);if(v.ok===false)throw new Error(JSON.stringify(v.error));
    final=v.final||v.result?.final||(v.payloads||v.result?.payloads||[]).map(p=>p.text||'').join('\n');
  }
  if(agent==='gemini') {const v=parseObject(result.stdout);if(v.error)throw new Error(v.error.message||JSON.stringify(v.error));final=v.response||'';}
  if(!final.trim())throw new Error(`${agent} terminó sin respuesta final verificable`);
  return final;
}
