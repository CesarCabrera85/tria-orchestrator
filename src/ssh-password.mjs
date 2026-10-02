import ssh2 from 'ssh2';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const fingerprint=key=>'SHA256:'+createHash('sha256').update(key).digest('base64').replace(/=+$/,'');
export function passwordConnectionOptions(ssh,resolved={}) {
  const at=ssh.target.lastIndexOf('@');
  const host=(resolved.hostname||ssh.target.slice(at+1)).replace(/^\[|\]$/g,'');
  const username=at>=0?ssh.target.slice(0,at):resolved.user;
  if(!username)throw new Error('Indica usuario@servidor o un alias SSH con usuario configurado');
  const port=Number(ssh.port||resolved.port||22);
  const address=port===22?host:`[${host}]:${port}`;
  const trusted=[];
  if(ssh.hostFingerprint)trusted.push(ssh.hostFingerprint.trim());
  try {
    const lines=readFileSync(ssh.knownHostsFile||join(homedir(),'.ssh','known_hosts'),'utf8').split(/\r?\n/);
    for(const line of lines){const [names,type,key]=line.trim().split(/\s+/);if(key&&names.split(',').includes(address))trusted.push(fingerprint(Buffer.from(key,'base64')));}
  }catch(e){if(e.code!=='ENOENT')throw e;}
  if(!trusted.length)throw new Error('Falta reconocer la huella del servidor. Introduce su huella SHA256 en Conexiones o conéctate una vez con ssh desde el terminal.');
  return {host,port,username,password:ssh.password,readyTimeout:10000,keepaliveInterval:15000,
    hostVerifier:key=>trusted.includes(fingerprint(key)),
    authHandler:['password'],
  };
}

export function runPasswordSSH(connection,command,{input='',signal,timeout=900000,onLine=()=>{},maxOutput=8*1024*1024}={}) {
  return new Promise((resolve,reject)=>{
    if(signal?.aborted)return reject(new Error('Ejecución detenida'));
    const client=new ssh2.Client();let channel,settled=false;const output={stdout:'',stderr:''},pending={stdout:'',stderr:''};
    const redact=s=>connection.password?String(s).replaceAll(connection.password,'[contraseña oculta]'):String(s);
    const done=(error,result)=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',cancel);client.end();if(error)reject(new Error(redact(error.message)));else resolve(result)};
    const cancel=()=>{try{channel?.signal('TERM')}catch{};client.destroy();done(new Error('Ejecución detenida'))};
    const timer=setTimeout(()=>{try{channel?.signal('TERM')}catch{};client.destroy();done(new Error('Tiempo de ejecución agotado'))},timeout);
    signal?.addEventListener('abort',cancel,{once:true});
    const collect=(name,chunk)=>{output[name]=(output[name]+chunk).slice(-maxOutput);pending[name]+=chunk;const lines=pending[name].split(/\r?\n/);pending[name]=lines.pop();for(const line of lines)if(line)onLine(name,redact(line));};
    client.on('error',e=>done(new Error(e.level==='client-authentication'?'El servidor rechazó el usuario o la contraseña SSH.':e.message)));
    client.on('close',()=>{if(!settled)done(new Error('Se cerró la conexión SSH antes de recibir el resultado'))});
    client.on('ready',()=>client.exec(command,(err,stream)=>{
      if(err)return done(err);channel=stream;
      stream.setEncoding('utf8');stream.stderr.setEncoding('utf8');
      stream.on('data',s=>collect('stdout',s));stream.stderr.on('data',s=>collect('stderr',s));
      stream.on('error',e=>done(e));stream.on('close',(code,exitSignal)=>{for(const name of ['stdout','stderr'])if(pending[name])onLine(name,redact(pending[name]));done(null,{code:code??null,exitSignal,stdout:redact(output.stdout),stderr:redact(output.stderr)})});
      stream.end(input);
    }));
    try{client.connect(connection)}catch(e){done(e)}
  });
}
