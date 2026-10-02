import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export function discover(name) {
  const home=homedir();
  const candidates= name==='claude' ? [join(home,'.local','bin',process.platform==='win32'?'claude.exe':'claude')] : [];
  if(name==='ssh'&&process.platform==='win32')candidates.push('C:/Program Files/Git/usr/bin/ssh.exe');
  const lookup=spawnSync(process.platform==='win32'?'where.exe':'which',[name],{encoding:'utf8',windowsHide:true});
  candidates.push(...(lookup.stdout||'').trim().split(/\r?\n/).filter(Boolean));
  const native=candidates.find(p=>existsSync(p)&&!/\.(cmd|bat|ps1)$/i.test(p));
  return native || candidates.find(p=>existsSync(p)) || name;
}

export function killTree(child) {
  if(!child?.pid || child.exitCode!==null) return;
  if(process.platform==='win32') spawn('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});
  else { try { process.kill(-child.pid,'SIGTERM'); } catch { child.kill('SIGTERM'); }
    const timer=setTimeout(()=>{try{process.kill(-child.pid,'SIGKILL')}catch{}},1500); timer.unref(); }
}

export function runProcess(file,args=[],{cwd,input='',signal,timeout=900000,onLine=()=>{},env=process.env,maxOutput=8*1024*1024}={}) {
  return new Promise((resolve,reject)=>{
    if(signal?.aborted) return reject(new Error('Ejecución detenida'));
    // npm command shims require a shell on Windows. Prompt text always travels over stdin.
    let program=file, argv=args;
    if(process.platform==='win32'&&/\.(cmd|bat)$/i.test(file)) {
      const b64=Buffer.from(JSON.stringify({file,args}),'utf8').toString('base64');
      const ps=`$x = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${b64}')) | ConvertFrom-Json; & $x.file @($x.args); exit $LASTEXITCODE`;
      program='powershell.exe'; argv=['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(ps,'utf16le').toString('base64')];
    }
    const child=spawn(program,argv,{cwd,env,windowsHide:true,detached:process.platform!=='win32',stdio:['pipe','pipe','pipe']});
    let stdout='',stderr='',failed='',buffers={stdout:'',stderr:''};
    const cancel=()=>{failed='Ejecución detenida';killTree(child)};
    signal?.addEventListener('abort',cancel,{once:true});
    const timer=setTimeout(()=>{failed='Tiempo de ejecución agotado';killTree(child)},timeout);
    for(const channel of ['stdout','stderr']) {
      child[channel].setEncoding('utf8'); child[channel].on('data',chunk=>{
        if(channel==='stdout') stdout=(stdout+chunk).slice(-maxOutput); else stderr=(stderr+chunk).slice(-maxOutput);
        buffers[channel]+=chunk;
        const lines=buffers[channel].split(/\r?\n/); buffers[channel]=lines.pop();
        for(const line of lines) if(line) onLine(channel,line);
        if(buffers[channel].length>262144) {onLine(channel,buffers[channel]);buffers[channel]=''}
      });
    }
    child.stdin.on('error',()=>{}); child.stdin.end(input);
    const cleanup=()=>{clearTimeout(timer);signal?.removeEventListener('abort',cancel)};
    child.on('error',e=>{cleanup();reject(e)});
    child.on('close',(code,exitSignal)=>{cleanup(); for(const k of ['stdout','stderr'])if(buffers[k])onLine(k,buffers[k]);
      if(failed)reject(new Error(failed));else resolve({code,exitSignal,stdout,stderr});
    });
  });
}

export async function checked(file,args,opts) {const r=await runProcess(file,args,opts);if(r.code!==0)throw new Error(`${file} terminó con ${r.code}: ${(r.stderr||r.stdout).slice(-5000)}`);return r;}
export const shellCommand=(command,opts={})=>process.platform==='win32'
  ? runProcess('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-Command',`$ErrorActionPreference='Stop'; ${command}; $triaCommandOk=$?; if ($null -ne $LASTEXITCODE -and $LASTEXITCODE -ne 0) { exit $LASTEXITCODE }; if (-not $triaCommandOk) { exit 1 }`],opts)
  : runProcess('/bin/sh',['-c',command],opts);

export const quotePosix=s=>"'"+String(s).replaceAll("'","'\\''")+"'";
// No provider keys: reuse subscription/OAuth auth stored by the installed CLIs.
export function subscriptionEnv() {const env={...process.env};for(const key of ['OPENAI_API_KEY','CODEX_API_KEY','ANTHROPIC_API_KEY','ANTHROPIC_AUTH_TOKEN','CLAUDECODE'])delete env[key];return env;}

export async function remoteProcess(ssh,file,args,opts={}) {
  if(!ssh?.target || !/^[a-zA-Z0-9_@.:[\]-]+$/.test(ssh.target)||ssh.target.startsWith('-'))throw new Error('Configura un alias SSH o usuario@host válido');
  const helper=`const{spawn}=require('child_process');let s='';process.stdin.setEncoding('utf8');process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{const p=JSON.parse(s);const c=spawn(p.file,p.args,{cwd:p.cwd||undefined,env:process.env,stdio:['pipe','inherit','inherit']});c.stdin.on('error',()=>{});c.stdin.end(p.input||'');const t=setTimeout(()=>{c.kill('SIGTERM');setTimeout(()=>c.kill('SIGKILL'),1500).unref()},p.timeout);c.on('error',e=>{console.error(e.message);process.exitCode=1});c.on('close',n=>{clearTimeout(t);process.exit(n??1)});for(const sig of ['SIGTERM','SIGHUP','SIGINT'])process.on(sig,()=>c.kill('SIGTERM'))});`;
  const argsSsh=['-T','-o','BatchMode=yes','-o','ConnectTimeout=10'];
  if(ssh.port)argsSsh.push('-p',String(ssh.port)); if(ssh.identityFile)argsSsh.push('-i',ssh.identityFile);
  if(ssh.knownHostsFile)argsSsh.push('-o',`UserKnownHostsFile="${ssh.knownHostsFile.replaceAll('\\','/').replaceAll('"','\\"')}"`);
  argsSsh.push(ssh.target,`${quotePosix(ssh.node||'node')} -e ${quotePosix(helper)}`);
  return runProcess(discover('ssh'),argsSsh,{...opts,cwd:undefined,input:JSON.stringify({file,args,cwd:opts.remoteCwd,input:opts.input,timeout:opts.timeout||900000})});
}
