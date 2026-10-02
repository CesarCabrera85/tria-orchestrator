export function setupClaudeLogin({api,onAuthenticated}) {
  const panel=document.createElement('section');panel.className='panel';panel.id='claude-login-panel';panel.hidden=true;
  panel.innerHTML=`<h2>Vincular tu cuenta de Claude</h2>
    <p>Claude Code está instalado en tu ordenador. Este paso le permite usar tu cuenta y tu suscripción.</p>
    <p id="claude-login-detail" role="status" aria-live="polite"></p>
    <p><a id="claude-login-link" target="_blank" rel="noopener noreferrer" hidden>1. Abrir Claude y autorizar mi cuenta ↗</a></p>
    <form id="claude-code-form" hidden><label>2. Pega el código que muestra Claude al finalizar<input name="code" type="password" autocomplete="off" spellcheck="false" required placeholder="Código de autorización completo"></label><button class="primary" type="submit">Conectar Claude</button></form>
    <p id="claude-login-help" class="muted">La página oficial ofrece las opciones de acceso de tu cuenta, incluido Google cuando esté disponible. Si muestra un código, vuelve aquí y pégalo. No necesitas abrir PowerShell.</p><button id="claude-login-cancel" type="button">Cancelar este acceso</button>`;
  document.querySelector('#settings-form').before(panel);
  const detail=panel.querySelector('#claude-login-detail'),link=panel.querySelector('a'),form=panel.querySelector('form'),input=form.elements.code;
  let timer,sessionId,lastStatus;
  function show(state,scroll=false) {
    clearTimeout(timer);panel.hidden=state.status==='idle';
    if(sessionId!==state.sessionId)input.value='';
    sessionId=state.sessionId;detail.textContent=state.detail;
    link.hidden=!state.url;if(state.url)link.href=state.url;else link.removeAttribute('href');
    form.hidden=!state.needsCode;form.querySelector('button').disabled=state.status!=='waiting';
    panel.querySelector('#claude-login-help').hidden=!['starting','waiting','verifying'].includes(state.status);
    panel.querySelector('#claude-login-cancel').hidden=!['starting','waiting','verifying'].includes(state.status);
    if(scroll)panel.scrollIntoView({behavior:'smooth',block:'start'});
    if(state.status==='authenticated'&&lastStatus!=='authenticated')Promise.resolve(onAuthenticated()).catch(e=>{detail.textContent+=' '+e.message});
    lastStatus=state.status;
    if(['starting','waiting','verifying'].includes(state.status))timer=setTimeout(poll,1200);
  }
  async function poll(){try{show(await api('/providers/claude/login'))}catch{detail.textContent='No se puede consultar Tria. Reintentando…';timer=setTimeout(poll,3000)}}
  form.onsubmit=async event=>{
    event.preventDefault();form.querySelector('button').disabled=true;
    const code=input.value;input.value='';
    try{show(await api('/providers/claude/login-code','POST',{sessionId,code}))}
    catch(e){detail.textContent=e.message;form.querySelector('button').disabled=false}
  };
  panel.querySelector('#claude-login-cancel').onclick=async()=>{try{show(await api('/providers/claude/login-cancel','POST',{}))}catch(e){detail.textContent=e.message}};
  return {show,restore:poll};
}
