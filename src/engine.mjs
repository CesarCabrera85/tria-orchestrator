import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { checked, shellCommand, remoteProcess } from './process.mjs';
import { callAgent, parseObject } from './agents.mjs';
import { teamFor, validateTeam } from './providers.mjs';

const activeStates=['running','pausing','deploying','publishing'];
export class Engine {
  constructor(store,{agentCall=callAgent,settingsProvider}={}) {
    this.store=store;this.agentCall=agentCall;this.settingsProvider=settingsProvider;this.jobs=new Map();
    for(const r of store.list())if(activeStates.includes(r.status)){r.status='interrupted';r.error='El servidor se reinició. Revisa la actividad y reanuda explícitamente.';store.save(r);}
  }
  settings(){return this.settingsProvider?this.settingsProvider():this.store.read('settings.json')}
  log(r,type,data={}){return this.store.event(r.id,type,data)}
  persist(r){this.syncMessages(r);this.store.save(r);this.log(r,'state',{status:r.status,phase:r.phase,taskIndex:r.taskIndex})}
  create({repository,goal,verificationCommands=[],maxTasks=12}) {
    if(typeof repository!=='string'||!repository.trim()||repository.startsWith('-'))throw new Error('Falta el repositorio (URL Git o ruta local)');
    if(typeof goal!=='string'||!goal.trim())throw new Error('Describe el objetivo del proyecto');
    if(!Array.isArray(verificationCommands)||verificationCommands.some(c=>typeof c!=='string'))throw new Error('Comandos de verificación inválidos');
    const team=validateTeam(teamFor(this.settings()));
    const id=randomUUID();const r={id,team,repository:repository.trim(),goal:goal.trim(),verificationCommands:verificationCommands.filter(Boolean),maxTasks:Math.min(30,Math.max(1,Number(maxTasks)||12)),status:'created',phase:'prepare',taskIndex:0,repairRound:0,tasks:[],messages:[],transcript:[],steps:{},openclawSession:randomUUID(),createdAt:new Date().toISOString(),branch:`tria/${id.slice(0,8)}`};
    this.store.save(r);this.log(r,'created',{repository:r.repository,goal:r.goal});return r;
  }
  start(id) {
    if(this.jobs.has(id))throw new Error('Esta ejecución ya está activa');
    const r=this.store.run(id);if(['completed','deployed'].includes(r.status))throw new Error('Crea una nueva ejecución para otro objetivo');
    // Freeze connection and policy for the duration of each job.
    const settings=structuredClone(this.settings());r.team=validateTeam(r.team||teamFor(settings));const controller=new AbortController();
    if(r.status==='failed'){r.repairRound=0;r.finalRepairs=0;const t=r.tasks[r.taskIndex];if(t)t.repairs=0;}
    r.status='running';r.error='';this.persist(r);
    const job={controller,promise:null};this.jobs.set(id,job);
    job.promise=this.execute(r,settings,controller.signal).catch(e=>{r.status=controller.signal.aborted?'paused':'failed';r.error=e.message;this.persist(r);this.log(r,'error',{message:e.message});}).finally(()=>this.jobs.delete(id));
    return r;
  }
  pause(id){const j=this.jobs.get(id);if(!j)throw new Error('La ejecución no está activa');j.controller.abort();return {status:'pausing'};}
  async instruct(id,text,now=false){
    const job=this.jobs.get(id);
    if(job?.steering)throw new Error('Ya se está aplicando una orden. Espera a que termine.');
    const r=this.message(id,text);
    if(!now)return {detail:'Orden guardada. Se incorporará al siguiente turno; si está detenido, pulsa Iniciar / Reanudar.'};
    if(['completed','deployed'].includes(r.status))return {detail:'Orden guardada. Esta ejecución ya terminó; crea otra ejecución para ampliar el objetivo.'};
    if(job){job.steering=true;job.controller.abort();await job.promise;}
    this.start(id);
    return {detail:'Orden guardada y ejecución retomada. El nuevo turno recibe tu instrucción.'};
  }
  message(id,text){if(typeof text!=='string'||!text.trim())throw new Error('Mensaje vacío');const r=this.store.run(id);if(this.jobs.get(id)?.maintenance)throw new Error('Espera a que finalice la publicación o el despliegue');r.messages.push({at:new Date().toISOString(),text:text.trim()});this.store.save(r);this.log(r,'user',{text:text.trim()});return r;}
  syncMessages(r){r.messages=this.store.run(r.id).messages;}
  async git(r,args,signal){return checked('git',args,{cwd:r.workspace,signal,env:{...process.env,GIT_TERMINAL_PROMPT:'0',GCM_INTERACTIVE:'never'},onLine:(channel,text)=>this.log(r,'command',{label:'git',channel,text})});}
  async checkpoint(r,label,signal) {
    const branch=(await this.git(r,['branch','--show-current'],signal)).stdout.trim();
    if(branch!==r.branch)throw new Error('La rama de trabajo cambió fuera del orquestador; recupera la rama '+r.branch+' antes de continuar');
    const dirty=await this.git(r,['status','--porcelain'],signal);if(!dirty.stdout.trim())return;
    await this.git(r,['add','-A'],signal);
    await this.git(r,['-c','user.name=Tria Orchestrator','-c','user.email=tria@localhost','commit','-m',label],signal);
  }
  context(r) {
    this.syncMessages(r);
    return `Eres miembro de Tria, equipo ${r.team?.join(' + ')||'Codex + Claude'} con OpenClaw opcional, dirigido por el usuario.\nOBJETIVO: ${r.goal}\nREPOSITORIO: ${r.repository}\nCOPIA DE TRABAJO: ${r.workspace}\nRAMA: ${r.branch}\nLee AGENTS.md, CLAUDE.md, README y los .md pertinentes. Inspecciona código real. No declares algo probado sin ejecutarlo. Implementa resultados funcionales; no sustituyas integraciones por mocks. No hagas push, merge, despliegue ni cambies de rama: los gestiona Tria. No accedas a las credenciales. El usuario decide los permisos en la configuración.\nINSTRUCCIONES DEL USUARIO: ${JSON.stringify(r.messages)}\nPLAN: ${JSON.stringify(r.tasks)}\nCONVERSACIÓN COMPARTIDA (últimos turnos):\n${r.transcript.slice(-10).map(t=>`${t.agent} [${t.phase}]: ${t.text.slice(-16000)}`).join('\n\n')}`;
  }
  async turn(r,settings,signal,agent,instruction,structured=true) {
    let prompt=this.context(r)+'\n\nTU ENCARGO AHORA:\n'+instruction+'\nEsta es una ejecución no interactiva. No termines el turno con trabajos pendientes ni esperes notificaciones después de responder. Ejecuta y espera las pruebas en primer plano, con un tiempo límite. Si no puedes terminar, informa del bloqueo real; no declares éxito ni evidencia pendiente. Reutiliza resultados y cambios existentes sin repetir trabajo ya comprobado.';
    const outputSchema=structured ? (r.phase==='plan' ? {type:'object',properties:{summary:{type:'string'},tasks:{type:'array',items:{type:'object',properties:{title:{type:'string'},owner:{type:'string',enum:r.team},instructions:{type:'string'},acceptance:{type:'string'}},required:['title','owner','instructions','acceptance']}},verificationCommands:{type:'array',items:{type:'string'}}},required:['summary','tasks','verificationCommands']} : ['review','final-review'].includes(r.phase) ? {type:'object',properties:{approved:{type:'boolean'},summary:{type:'string'},issues:{type:'array',items:{type:'string'}}},required:['approved','summary','issues']} : {type:'object',properties:{summary:{type:'string'},blocked:{type:'boolean'},evidence:{type:'array',items:{type:'string'}}},required:['summary','blocked']}) : undefined;
    for(let attempt=0;attempt<2;attempt++) {
      this.log(r,'dispatch',{agent,phase:r.phase,prompt,attempt});
      let outcome='failed';
      try {
        const text=await this.agentCall(agent,prompt,{settings,cwd:r.workspace,signal,sessionId:r.openclawSession,outputSchema,onEvent:data=>this.log(r,'agent_event',data)});
        r.transcript.push({agent,phase:r.phase,text,at:new Date().toISOString()});
        this.syncMessages(r);this.store.save(r);this.log(r,'message',{agent,phase:r.phase,text});
        if(!structured){outcome='completed';return text;}
        try {const result=parseObject(text);outcome='completed';return result;}
        catch(error){
          if(attempt||signal.aborted)throw error;
          outcome='retry';this.log(r,'warning',{agent,message:'Respuesta sin el JSON requerido. Se solicita una corrección, sin dar la tarea por terminada.'});
          prompt+='\n\nTu respuesta anterior no cumplió el formato: '+text.slice(-16000)+'\nComprueba el estado real de lo pendiente, no repitas cambios ya hechos. Termina las comprobaciones o declara blocked:true con el motivo. Devuelve únicamente el JSON solicitado en el encargo original.';
        }
      } finally {this.log(r,'turn_end',{agent,phase:r.phase,outcome});}
    }
  }
  async execute(r,settings,signal) {
    const team=r.team||['codex','claude'],lead=team[0],peer=team[1];
    const reviewerFor=owner=>team[(team.indexOf(owner)+1)%team.length];
    if(!r.workspace) {
      // Clone into a managed directory: never take over the user's working checkout.
      r.workspace=join(this.store.dir,'workspaces',r.id);this.store.save(r);
    }
    if(!r.steps.prepared) {
      mkdirSync(join(this.store.dir,'workspaces'),{recursive:true});
      if(!existsSync(join(r.workspace,'.git'))) {
        if(existsSync(r.repository)){
          const status=await checked('git',['status','--porcelain'],{cwd:resolve(r.repository),signal});
          if(status.stdout.trim())throw new Error('El repositorio local tiene cambios sin commit. Guarda un commit para que Tria pueda clonar exactamente ese estado.');
        }
        await checked('git',['clone','--no-hardlinks','--',r.repository,r.workspace],{signal,env:{...process.env,GIT_TERMINAL_PROMPT:'0',GCM_INTERACTIVE:'never'},onLine:(channel,text)=>this.log(r,'command',{label:'clone',channel,text})});
      }
      const branch=(await this.git(r,['branch','--show-current'],signal)).stdout.trim();
      if(branch!==r.branch)await this.git(r,['checkout','-b',r.branch],signal);
      r.baseCommit=(await this.git(r,['rev-parse','HEAD'],signal)).stdout.trim();
      if(existsSync(r.repository)) {
        try {const remote=(await checked('git',['remote','get-url','origin'],{cwd:resolve(r.repository),signal})).stdout.trim();if(remote)await this.git(r,['remote','set-url','origin',remote],signal);}catch{}
      }
      r.steps.prepared=true;this.persist(r);
    }
    if(settings.openclaw.enabled&&!r.steps.serverContext) {
      r.phase='server-context';this.persist(r);
      await this.turn(r,settings,signal,'openclaw',`Actúas como responsable del servidor donde nació el proyecto. Aporta estado real, arquitectura, rutas y comandos de pruebas/despliegue. Ruta declarada del servidor: ${settings.ssh.repoPath||'no indicada'}. Inspecciona si procede pero no edites ni despliegues aún: Codex y Claude trabajan en otra copia, en ${r.branch}. No cambies modelos ni autenticación. Distingue hechos y pendientes. Responde al equipo en español.`,false);
      r.steps.serverContext=true;this.persist(r);
    }
    if(!r.steps.proposal) {
      r.phase='proposal';this.persist(r);
      await this.turn(r,settings,signal,lead,'Analiza el repositorio sin modificarlo. Propón al equipo un plan concreto para construir el objetivo. Explica decisiones, dependencias, puntos discutibles y cómo verificar funcionalidad. Responde en español.',false);
      r.steps.proposal=true;this.persist(r);
    }
    if(!r.steps.debate) {
      r.phase='debate';this.persist(r);
      for(const agent of team.slice(1)){if(r.steps['debate_'+agent])continue;await this.turn(r,settings,signal,agent,'Revisa las propuestas anteriores contra el repositorio real sin modificarlo. Discute fallos, alternativas y trabajo faltante; propone el reparto entre los miembros del equipo. No apruebes por cortesía. Responde al equipo en español.',false);r.steps['debate_'+agent]=true;this.persist(r);}
      r.steps.debate=true;this.persist(r);
    }
    if(settings.openclaw.enabled&&!r.steps.serverDebate) {
      r.phase='server-debate';this.persist(r);
      await this.turn(r,settings,signal,'openclaw','Participa en el debate: contrasta las propuestas de Codex y Claude con la infraestructura y el proyecto que conoces. Señala incompatibilidades reales de ejecución, dependencias, datos persistentes y criterios necesarios para desplegar. Responde al equipo con decisiones concretas, sin editar ni desplegar todavía.',false);
      r.steps.serverDebate=true;this.persist(r);
    }
    if(!r.steps.planned) {
      r.phase='plan';this.persist(r);
      const p=await this.turn(r,settings,signal,lead,`Resuelve las observaciones de todos los participantes. Sin editar código, acuerda un plan ejecutable de entre 1 y ${r.maxTasks} tareas ordenadas por dependencias. Cada tarea tiene un responsable de esta lista: ${team.join(', ')}; distribuye el trabajo entre los participantes. Devuelve SOLO JSON: {"summary":"...","tasks":[{"title":"...","owner":"${lead}","instructions":"...","acceptance":"..."}],"verificationCommands":["comando real que termina con código 0 solo si pasa"]}. Los comandos se ejecutan en ${process.platform} desde la raíz de esta copia. Incluye pruebas reales/build del proyecto, nunca echo true ni servidores que no terminan.`);
      if(!Array.isArray(p.tasks)||!p.tasks.length||p.tasks.length>r.maxTasks||p.tasks.some(t=>!team.includes(t.owner)||typeof t.title!=='string'||typeof t.instructions!=='string'||typeof t.acceptance!=='string'))throw new Error('Plan inválido: faltan tareas, responsable o criterios de aceptación');
      if(!Array.isArray(p.verificationCommands)||p.verificationCommands.some(c=>typeof c!=='string'||!c.trim()))throw new Error('El plan no contiene comandos de verificación válidos');
      if(!r.verificationCommands.length)r.verificationCommands=p.verificationCommands;
      if(!r.verificationCommands.length)throw new Error('Se necesita al menos una verificación ejecutable para poder completar el trabajo');
      r.tasks=p.tasks.map((t,i)=>({...t,id:i+1,status:'pending'}));r.planSummary=p.summary;r.steps.planned=true;this.log(r,'plan',{tasks:r.tasks,verificationCommands:r.verificationCommands});this.persist(r);
    }
    while(r.taskIndex<r.tasks.length) {
      if(signal.aborted)throw new Error('Ejecución detenida');
      const t=r.tasks[r.taskIndex];r.phase='implementation';t.status='running';this.persist(r);
      if(!t.implemented) {
        await this.turn(r,settings,signal,t.owner,`IMPLEMENTA la tarea ${t.id}: ${t.title}\n${t.instructions}\nAceptación: ${t.acceptance}. Tienes escritura sobre esta copia. Si una ejecución anterior quedó interrumpida, inspecciona sus cambios antes de continuar. Ejecuta las comprobaciones necesarias. Comunica al otro agente qué has hecho, las pruebas y cualquier bloqueo. Devuelve SOLO JSON {"summary":"...","blocked":false,"evidence":["comandos y resultados reales"]}.`)
          .then(result=>{if(result.blocked!==false)throw new Error(result.summary||'El implementador está bloqueado');t.result=result});
        await this.checkpoint(r,`Tria: ${t.title}`,signal);t.implemented=true;this.persist(r);
      }
      if(r.validationMode==='functional-final') {
        t.review={deferred:true,summary:'Implementación terminada; pendiente de prueba funcional final de Luna.'};
        t.status='completed';r.taskIndex++;this.persist(r);continue;
      }
      r.phase='review';this.persist(r);const reviewer=reviewerFor(t.owner);
      const review=await this.turn(r,settings,signal,reviewer,`Revisa de forma independiente la tarea ${t.id}: ${t.title}. Criterio: ${t.acceptance}. Inspecciona el código y ejecuta pruebas si hace falta. No edites. Devuelve SOLO JSON {"approved":true,"summary":"...","issues":["problemas concretos que bloquean aceptación"]}. Si faltan integración o pruebas relevantes, approved debe ser false.`);
      if(review.approved!==true||!Array.isArray(review.issues)||review.issues.length) {
        t.review=review;t.repairs=(t.repairs||0)+1;t.implemented=false;this.persist(r);
        if(t.repairs>settings.maxRepairRounds)throw new Error(`La tarea ${t.id} sigue sin aprobar tras ${t.repairs} revisiones: ${review.summary}`);
        continue;
      }
      t.review=review;t.status='completed';r.taskIndex++;this.persist(r);
    }
    while(!r.steps.verified) {
      r.phase='verification';this.persist(r);r.verification=[];
      for(const command of r.verificationCommands) {
        this.log(r,'command_start',{command});
        const result=await shellCommand(command,{cwd:r.workspace,signal,timeout:settings.turnTimeoutMinutes*60000,onLine:(channel,text)=>this.log(r,'command',{label:command,channel,text})});
        r.verification.push({command,code:result.code,stdout:result.stdout.slice(-16000),stderr:result.stderr.slice(-16000)});this.persist(r);
      }
      if(r.verification.every(v=>v.code===0)) {r.steps.verified=true;this.persist(r);break;}
      if(r.repairRound>=settings.maxRepairRounds)throw new Error('Las verificaciones siguen fallando. Consulta resultados y añade instrucciones para continuar.');
      r.repairRound++;r.phase='repair';this.persist(r);
      const owner=r.validationMode==='functional-final'?'claude':team[r.repairRound%team.length];
      const repair=await this.turn(r,settings,signal,owner,`Corrige estos fallos reales sin desactivar ni debilitar las pruebas: ${JSON.stringify(r.verification)}. Devuelve SOLO JSON {"summary":"...","blocked":false}.`);
      if(repair.blocked!==false)throw new Error(repair.summary||'Reparación bloqueada');
      await this.checkpoint(r,'Tria: repair verification',signal);
    }
    // Final independent reviews are after fixes, never before the tested revision.
    if(!r.verifiedTree){await this.checkpoint(r,'Tria: verification checkpoint',signal);r.verifiedTree=(await this.git(r,['rev-parse','HEAD'],signal)).stdout.trim();this.persist(r);}
    for(const agent of (r.validationMode==='functional-final'?['codex']:team))if(!r.steps[`final_${agent}`]) {
      r.phase='final-review';this.persist(r);
      const finalInstruction=r.validationMode==='functional-final'
        ? `Tu función es PROBAR LA APLICACIÓN FUNCIONANDO, no revisar todo el código ni repetir auditorías por tarea. Actúas como probador funcional con GPT-6-Luna. Arranca la aplicación en un entorno local aislado con datos sintéticos y prueba sus recorridos reales: acceso al panel, consulta de un pedido propio, rechazo de uno ajeno, pedido sin entrega confirmada, información desconocida y derivación a humano. Usa la interfaz y las herramientas de navegador disponibles; comprueba también las respuestas reales de la aplicación y la persistencia. No basta con leer código o dar por buenos los logs de Claude. No modifiques el código: entrega a Claude los fallos reproducibles. No despliegues ni actives WhatsApp, ni envíes mensajes externos. Distingue pruebas locales de una conversación real de WhatsApp, que queda pendiente de conexión y activación autorizadas. Si no puedes ejecutar un recorrido, indícalo como no probado. Verificaciones previas: ${JSON.stringify(r.verification)}. Devuelve SOLO JSON {"approved":true,"summary":"recorridos ejecutados, resultados y limitaciones","issues":[],"evidence":["comandos, URLs locales y resultados observados"]}. approved solo puede ser true cuando hayas probado los recorridos funcionales locales; si fallan o no puedes probarlos, false.`
        : `Audita el resultado completo contra el objetivo del usuario, no solo el plan. No edites. Verificaciones ejecutadas por Tria: ${JSON.stringify(r.verification)}. Devuelve SOLO JSON {"approved":true,"summary":"...","issues":[]}. Si falta funcionalidad, no apruebes.`;
      const v=await this.turn(r,settings,signal,agent,finalInstruction);
      if(r.validationMode==='functional-final'){r.functionalTest=v;this.persist(r);}
      const currentHead=(await this.git(r,['rev-parse','HEAD'],signal)).stdout.trim();
      const currentChanges=(await this.git(r,['status','--porcelain'],signal)).stdout.trim();
      if(currentHead!==r.verifiedTree||currentChanges){r.steps.verified=false;for(const member of team)r.steps['final_'+member]=false;r.verifiedTree=null;this.persist(r);throw new Error('El código cambió durante la auditoría. Reanuda para volver a ejecutar las verificaciones sobre esos cambios.');}
      if(v.approved!==true||!Array.isArray(v.issues)||v.issues.length) {
        if(r.finalRepairs>=settings.maxRepairRounds)throw new Error(`Auditoría final de ${agent}: ${v.summary}`);
        r.finalRepairs=(r.finalRepairs||0)+1;
        r.tasks.push({id:r.tasks.length+1,title:r.validationMode==='functional-final'?'Corregir fallos funcionales encontrados por Luna':`Correcciones de auditoría (${agent})`,owner:r.validationMode==='functional-final'?'claude':reviewerFor(agent),instructions:JSON.stringify(v),acceptance:'Resolver los fallos reproducibles sin eliminar comprobaciones',status:'pending'});
        r.steps.verified=false;for(const member of team)r.steps['final_'+member]=false;r.verifiedTree=null;this.persist(r);return this.execute(r,settings,signal);
      }
      r.steps[`final_${agent}`]=true;this.persist(r);
    }
    await this.checkpoint(r,'Tria: verified result',signal);
    r.commit=(await this.git(r,['rev-parse','HEAD'],signal)).stdout.trim();r.status='completed';r.phase='completed';this.persist(r);
    this.log(r,'completed',{commit:r.commit,branch:r.branch,workspace:r.workspace});
  }
  async maintenance(id,kind,fn) {
    if(this.jobs.has(id))throw new Error('Hay una operación activa');
    const r=this.store.run(id);if(!['completed','deployed'].includes(r.status))throw new Error('Primero debe completarse y verificarse la ejecución');
    const before=r.status,controller=new AbortController();r.status=kind;this.persist(r);
    const job={controller,maintenance:true,promise:null};this.jobs.set(id,job);
    job.promise=(async()=>{try{await fn(r,controller.signal);r.status=kind==='deploying'?'deployed':before;r.error='';this.persist(r);return r}catch(e){r.status=before;r.error=e.message;this.persist(r);this.log(r,'error',{message:e.message});throw e}finally{this.jobs.delete(id)}})();
    return job.promise;
  }
  publish(id){return this.maintenance(id,'publishing',async(r,signal)=>{
    const dirty=(await this.git(r,['status','--porcelain'],signal)).stdout.trim();const head=(await this.git(r,['rev-parse','HEAD'],signal)).stdout.trim();
    const ref=(await this.git(r,['rev-parse',r.branch],signal)).stdout.trim();
    if(dirty||head!==r.commit||ref!==r.commit)throw new Error('La copia cambió tras la verificación. No se publica una revisión diferente.');
    await this.git(r,['push','-u','origin',r.branch],signal);r.publishedCommit=r.commit;this.log(r,'published',{branch:r.branch,commit:r.commit});
  })}
  deploy(id,{command,healthCommand}) {return this.maintenance(id,'deploying',async(r,signal)=>{
    if(r.publishedCommit!==r.commit)throw new Error('Publica primero la rama verificada');
    if(typeof command!=='string'||!command.trim()||typeof healthCommand!=='string'||!healthCommand.trim())throw new Error('Faltan comandos de despliegue y de comprobación');
    const settings=this.settings();if(!settings.ssh.repoPath)throw new Error('Configura la ruta de despliegue del servidor');
    const remote=async(file,args)=>{const v=await remoteProcess(settings.ssh,file,args,{signal,timeout:settings.turnTimeoutMinutes*60000,remoteCwd:settings.ssh.repoPath,onLine:(channel,text)=>this.log(r,'remote',{channel,text})});if(v.code!==0)throw new Error(v.stderr||v.stdout||'Fallo remoto');return v;};
    const dirty=await remote('git',['status','--porcelain']);if(dirty.stdout.trim())throw new Error('El servidor tiene cambios sin commit. OpenClaw debe conservarlos antes del despliegue.');
    r.previousServerCommit=(await remote('git',['rev-parse','HEAD'])).stdout.trim();this.persist(r);
    await remote('git',['fetch','origin',r.branch]);
    const fetched=(await remote('git',['rev-parse','FETCH_HEAD'])).stdout.trim();if(fetched!==r.commit)throw new Error('La revisión del servidor no coincide con la verificada');
    await remote('git',['checkout','--detach',r.commit]);
    await remote('/bin/sh',['-c',command]);await remote('/bin/sh',['-c',healthCommand]);
    r.deployment={commit:r.commit,at:new Date().toISOString(),command,healthCommand};this.log(r,'deployed',r.deployment);
    if(settings.openclaw.enabled) {
      try{await this.turn(r,settings,signal,'openclaw',`El equipo desplegó ${r.commit} en ${settings.ssh.repoPath}. Comando: ${command}. Comprobación que terminó con éxito: ${healthCommand}. Inspecciona el servicio, sin modificarlo, y comunica observaciones al equipo.`,false)}catch(e){this.log(r,'warning',{message:`Despliegue comprobado; informe de OpenClaw pendiente: ${e.message}`})}
    }
  })}
  async stop(){for(const j of this.jobs.values())j.controller.abort();await Promise.allSettled([...this.jobs.values()].map(j=>j.promise));}
}
