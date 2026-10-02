const names={codex:'Codex',claude:'Claude Code',gemini:'Gemini',kimi:'Kimi',openclaw:'OpenClaw'};
export function activityState(run,events) {
  let active=null;const agents={};
  for(const e of events){
    if(e.type==='dispatch'){active={agent:e.agent,at:e.at};agents[e.agent]={...agents[e.agent],at:e.at,detail:'Preparando el turno'};}
    if(e.type==='turn_end'&&active?.agent===e.agent)active=null;
    if(e.type==='agent_event'){
      const v=e.event||{},item=v.item;
      let detail='';
      if(item?.type==='command_execution')detail=(v.type==='item.completed'?'Comando terminado: ':'Ejecutando: ')+item.command;
      if(item?.type==='agent_message')detail=item.text;
      if(v.type==='assistant')detail=(v.message?.content||[]).map(c=>c.type==='tool_use'?'Herramienta: '+c.name+(c.input?.description?' · '+c.input.description:''):c.type==='text'?c.text:'').filter(Boolean).join(' ');
      if(v.type==='stream_event'&&v.event?.type==='content_block_start'&&v.event.content_block?.type==='tool_use')detail='Herramienta: '+v.event.content_block.name;
      agents[e.agent]={...agents[e.agent],at:e.at,...(detail?{detail:detail.slice(0,500)}:{})};
    }
    if(e.type==='message')agents[e.agent]={...agents[e.agent],at:e.at,detail:'Turno entregado'};
  }
  if(run.status!=='running')active=null;
  return {active,agents};
}
export function setupRunActivity(){
  const panel=document.createElement('section');panel.className='panel run-monitor';
  panel.innerHTML='<h3>Actividad del equipo</h3><p class="muted">Trabajan por turnos: uno ejecuta y el otro espera o revisa. Una sesión iniciada no significa que esté trabajando.</p><div class="worker-cards"></div><p class="worker-task"></p>';
  document.querySelector('#run-view .toolbar').after(panel);
  const form=document.querySelector('#message-form');panel.after(form);form.classList.add('panel');
  form.querySelector('input').placeholder='Escribe una orden para el equipo…';
  form.querySelector('button').textContent='Enviar al siguiente turno';
  const now=document.createElement('button');now.type='submit';now.name='applyNow';now.textContent='Aplicar ahora';form.append(now);
  const feedback=document.createElement('p');feedback.id='order-feedback';feedback.setAttribute('role','status');feedback.className='muted';form.after(feedback);
  const help=document.createElement('small');help.className='muted';help.textContent='Aplicar ahora interrumpe y retoma el turno con tu orden. Enviar al siguiente turno deja terminar el trabajo actual.';form.append(help);
  let run,events=[],timer,pending;
  let state={active:null,agents:{}};
  function render(){if(!run)return;const cards=panel.querySelector('.worker-cards');cards.replaceChildren();
    panel.querySelector('p.muted').textContent=run.validationMode==='functional-final'?'Claude desarrolla. Luna probará la aplicación funcionando al terminar; no revisa cada tarea.':'Trabajan por turnos: uno ejecuta y el otro espera o revisa. Una sesión iniciada no significa que esté trabajando.';
    for(const id of run.team||['codex','claude']){
      const card=document.createElement('div'),title=document.createElement('strong'),status=document.createElement('p'),detail=document.createElement('small');
      const active=state.active?.agent===id,a=state.agents[id];card.className='worker-card'+(active?' working':'');title.textContent=names[id]||id;
      status.textContent=active?'● Trabajando':run.status==='running'?'En espera de turno':['failed','paused','interrupted'].includes(run.status)?'Detenido':'Sin turno activo';
      if(run.validationMode==='functional-final'&&id==='codex'){title.textContent='Codex · GPT-6-Luna';if(run.status==='running')status.textContent=active?'● Probando la aplicación':'En espera de la prueba funcional final';}
      detail.textContent=(a?.detail||'Sin actividad registrada')+(a?.at?' · Último evento hace '+Math.max(0,Math.floor((Date.now()-Date.parse(a.at))/1000))+' s':'');
      card.append(title,status,detail);cards.append(card);
    }
    const task=run.tasks?.[run.taskIndex];panel.querySelector('.worker-task').textContent=run.status==='failed'?'Ejecución detenida: '+run.error:task?'Tarea '+task.id+'/'+run.tasks.length+': '+task.title+' · Fase: '+run.phase:'Fase: '+run.phase;
  }
  timer=setInterval(render,1000);
  return {update(r,e){run=r;events=e;if(!pending)pending=setTimeout(()=>{pending=null;state=activityState(run,events);render()},150)},clear(){run=null;},destroy(){clearInterval(timer);clearTimeout(pending)}};
}
