import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { killTree, runProcess, subscriptionEnv } from './process.mjs';

export function authorizationUrl(output) {
  // Wait for the entire URL, including a chunk-split PKCE/state parameter.
  for (const match of output.matchAll(/https:\/\/[^\s\x1b]+(?=\s|\x1b)/g)) {
    try {
      const url = new URL(match[0]);
      if (['claude.com', 'claude.ai'].includes(url.hostname) && url.pathname.endsWith('/oauth/authorize') && url.searchParams.has('state') && url.searchParams.has('code_challenge')) return url.href;
    } catch {}
  }
  return null;
}

// The CLI owns credential storage. Tria only holds the short-lived login process.
export class ClaudeLogin {
  constructor({ spawnProcess = spawn, verify = async command => {
    const result = await runProcess(command, ['auth', 'status'], { timeout: 15000, env: subscriptionEnv() });
    try { return result.code === 0 && JSON.parse(result.stdout).loggedIn === true; } catch { return false; }
  }, timeout = 600000 } = {}) {
    this.spawnProcess = spawnProcess; this.verify = verify; this.timeout = timeout;
  }
  snapshot() {
    const s = this.session;
    return s ? { sessionId: s.id, status: s.status, url: s.url, needsCode: s.status === 'waiting', detail: s.detail }
      : { status: 'idle', detail: 'Vincula tu cuenta de Claude para utilizarla desde Tria.' };
  }
  async start(command) {
    if (this.starting) return this.starting;
    this.starting = this.begin(command).finally(() => { this.starting = null; });
    return this.starting;
  }
  async begin(command) {
    if (this.session && ['starting', 'waiting', 'verifying'].includes(this.session.status)) return this.snapshot();
    if (await this.verify(command)) {
      this.session = { id: randomUUID(), status: 'authenticated', url: null, detail: 'La cuenta de Claude ya está vinculada en este ordenador.' };
      return this.snapshot();
    }
    const s = this.session = { id: randomUUID(), status: 'starting', url: null, detail: 'Preparando el enlace oficial de Claude…' };
    let output = '';
    const finish = (status, detail) => { clearTimeout(s.timer); s.status = status; s.detail = detail; s.url = null; output = ''; };
    try {
      s.child = this.spawnProcess(command, ['auth', 'login', '--claudeai'], {
        cwd: tmpdir(), env: subscriptionEnv(), windowsHide: true,
        detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'],
      });
      s.child.stdin.on('error', () => {});
      for (const stream of [s.child.stdout, s.child.stderr]) {
        stream.setEncoding('utf8');
        stream.on('data', chunk => {
          if (!['starting', 'waiting'].includes(s.status)) return;
          output = (output + chunk).slice(-32768);
          const url = authorizationUrl(output);
          if (url) { s.url = url; s.status = 'waiting'; s.detail = 'Abre Claude, autoriza tu cuenta y pega aquí el código que te muestre.'; }
        });
      }
      s.child.once('error', () => finish('failed', 'No se pudo iniciar Claude. Comprueba la ruta del ejecutable y vuelve a intentarlo.'));
      s.child.once('close', async code => {
        if (!['starting', 'waiting', 'verifying'].includes(s.status)) return;
        s.status = 'verifying'; s.detail = 'Comprobando la sesión de Claude…';
        let valid = false;
        try { valid = code === 0 && await this.verify(command); } catch {}
        if (s.status !== 'verifying') return;
        finish(valid ? 'authenticated' : 'failed', valid ? 'Cuenta de Claude vinculada. Ya puedes utilizarla en Tria.' : 'Claude no confirmó el acceso. Pulsa Iniciar sesión para generar un enlace nuevo.');
      });
      s.timer = setTimeout(() => { finish('expired', 'El enlace ha caducado. Pulsa Iniciar sesión para obtener otro.'); killTree(s.child); }, this.timeout);
      s.timer.unref?.();
    } catch { finish('failed', 'No se pudo iniciar Claude. Comprueba la ruta del ejecutable.'); }
    return this.snapshot();
  }
  submit(sessionId, code) {
    const s = this.session;
    if (!s || s.id !== sessionId || s.status !== 'waiting') throw new Error('Esta sesión ya no admite códigos. Inicia sesión de nuevo.');
    if (typeof code !== 'string' || !code.trim() || code.length > 4096 || /[\r\n\x00]/.test(code)) throw new Error('Pega el código completo que muestra Claude, en una sola línea.');
    s.status = 'verifying'; s.detail = 'Claude está comprobando el código…';
    s.child.stdin.write(code.trim() + '\n');
    return this.snapshot();
  }
  close() {
    const s = this.session;
    if (s) { clearTimeout(s.timer); s.status = 'cancelled'; s.url = null; s.detail = 'Acceso cancelado. Pulsa Iniciar sesión para obtener un enlace nuevo.'; killTree(s.child); }
  }
}
