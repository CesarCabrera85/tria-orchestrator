# Validación de Tria 0.1.0

Fecha: 2 de octubre de 2026. Entorno real: Windows, Node.js 24.18.0, npm 11.16.0, Git.

## Implementado y comprobado

- Servidor HTTP, panel web y API local operativos. Panel inspeccionado en navegador real.
- Diez pruebas automatizadas pasan: protocolo de adaptadores mediante procesos CLI de fixture; ciclo completo con Git, revisión, corrección y verificación; pausa/reanudación preservando cambios y mensajes; errores de proveedor; recuperación tras reinicio; debate con OpenClaw; invalidación cuando cambia el código durante la auditoría; rechazo de pruebas fallidas; timeout/cancelación; API, autenticación opcional, comprobación de origen y SSE.
- Git utilizado realmente en las pruebas: creación y clonación de repositorios temporales, ramas, commits y push a un remoto local de prueba; bloqueo de publicación si cambia la revisión verificada.
- Codex CLI 0.159.0-alpha.12.1 está autenticado mediante ChatGPT. Una llamada real a través del adaptador de Tria devolvió `{"connected":true,"provider":"codex-cli"}`. No se configuró una API key.
- Segunda prueba real de Codex: creó `greeting.mjs` y `check.mjs` en un repositorio temporal y ejecutó la prueba. Tria ejecutó de nuevo `node check.mjs` de forma independiente, con salida 0. Se comprobó el código generado, no solo el informe del agente.
- Paquete generado con `npm pack` e instalado con `npm install -g ./tria-orchestrator-0.1.0.tgz`; comandos `tria help` y `tria doctor` ejecutados desde la instalación global. El paquete excluye configuración, claves, historiales y repositorios de trabajo locales.
- Claude Code 2.1.207 fue localizado como ejecutable nativo; su comando `auth status` devolvió `loggedIn: false`. Se abrió su flujo de login de suscripción.
- El servidor del usuario responde a SSH por su IP de LAN y su huella ED25519 coincide con la aportada por el usuario. El nombre mDNS `.local` no se resolvió desde este Windows. Se generó una clave dedicada a Tria; su autorización remota está pendiente.

## No verificado todavía

- Ejecución real conjunta de Codex y Claude: requiere terminar el login de Claude. Las pruebas de fixture verifican el motor, no sustituyen esta prueba con ambos proveedores.
- Consulta real a OpenClaw y despliegue en el servidor: SSH rechaza todavía la clave y faltan los datos reales del proyecto y comandos del servidor. No se ha cambiado ni reiniciado ningún servicio remoto.
- Publicación en el registro npm: no se ha realizado. La distribución inicial utiliza instalación npm desde GitHub o desde el paquete `.tgz`.
- Linux/macOS, instalación como servicio, edición paralela, recuperación automática de despliegues y funcionamiento multiusuario.

## Alcance de las comprobaciones

Los agentes de fixture son deterministas y están exclusivamente en `test/`. La aplicación distribuida no simula respuestas: invoca los ejecutables configurados. Una ejecución solo aparece verificada después de las comprobaciones de proceso y las auditorías previstas; no equivale a una certificación de todos los comportamientos posibles del software construido.

La copia de trabajo por ejecución es independiente del checkout original. Los agentes se turnan para editar esa copia; esta versión no ejecuta editores concurrentes. El historial y estado se guardan localmente; los proveedores continúan procesando los prompts según sus cuentas/configuraciones.
