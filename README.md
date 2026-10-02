# Tria

Orquestador local para **Codex CLI, Claude Code, Gemini CLI, Kimi Code y OpenClaw**. Añades un repositorio y un objetivo; los agentes analizan, debaten, se reparten tareas, implementan y revisan el resultado. El panel web muestra conversación, tareas, comandos y comprobaciones en tiempo real.

Tria utiliza los ejecutables y las sesiones existentes. No contiene SDK de inferencia ni solicita API keys. El almacenamiento, los procesos y el panel son locales. Codex y Claude siguen enviando sus consultas a sus respectivos servicios: usar suscripciones no convierte los modelos en modelos offline, ni elimina sus límites de uso.

## Instalar

Requiere **Node.js 22 o superior**, Git y al menos dos CLI compatibles autenticados en el mismo usuario que ejecuta Tria. SSH y Node remoto son necesarios para OpenClaw/despliegues. Los agentes de construcción se ejecutan en la máquina de Tria; pueden coexistir con OpenClaw allí o conectarse a él por SSH.

El paquete todavía no está publicado en el registro npm. Puedes instalarlo con npm directamente desde GitHub:

```sh
npm install -g git+https://github.com/CesarCabrera85/tria-orchestrator.git
tria doctor
tria start
```

O desde un clon local de este repositorio:

```sh
npm install -g .
tria doctor
tria start
```

También puedes generar un paquete y llevarlo a otro ordenador:

```sh
npm pack
npm install -g ./tria-orchestrator-0.2.0.tgz
tria start
```

Abre **http://127.0.0.1:4310**. `tria start --data RUTA` crea una instancia con estado independiente; `--port` permite varias instancias con puertos diferentes. El directorio predeterminado es `~/.tria` y también puede configurarse con `TRIA_HOME`.

Para desarrollo:

```sh
npm install
npm start
npm test
npm run check
```

## Cuentas existentes

```sh
codex login
claude auth login --claudeai
tria doctor
```

Codex utiliza su login de ChatGPT y Claude Code el de su suscripción. Tria no copia cookies ni archivos de autenticación entre equipos. En Windows busca Claude en `~/.local/bin/claude.exe` además del PATH; los ejecutables se pueden elegir en Conexiones. Se eliminan las variables de claves API habituales del entorno de los CLI hijos, pero debes mantener sus configuraciones de proveedor orientadas a tus cuentas. Los cambios de autenticación los gestionan sus CLI.

## Otros proveedores y selección del equipo

En Conexiones selecciona al menos dos miembros: Codex, Claude Code, Gemini o Kimi. Cada ejecución conserva su selección original; cambiarla afecta a proyectos nuevos. Todos los seleccionados pueden debatir, recibir tareas y revisar. El orden del panel determina quién coordina.

- Gemini: instala con `npm install -g @google/gemini-cli`. Pulsa Iniciar sesión y elige **Sign in with Google**. El modo no interactivo reutiliza la sesión local.
- Kimi Code 2.x: instala con `npm install -g @moonshot-ai/kimi-code`. Pulsa Iniciar sesión y autoriza el código en su web. El adaptador usa la instalación npm de Kimi Code; no el antiguo kimi-cli de Python.
- Claude: en **Conexiones → Claude Code → Iniciar sesión**, Tria muestra un enlace oficial de autorización y un campo para pegar el código devuelto por Claude. No hace falta abrir una terminal. Tria comprueba la sesión guardada por el CLI antes de confirmar el acceso. Si ya estaba vinculada, la reutiliza. El enlace caduca a los diez minutos; puedes cancelar y generar otro. Recargar el panel conserva el acceso pendiente mientras Tria siga funcionando.
- Para los demás proveedores, en Windows Iniciar sesión solicita abrir PowerShell en el ordenador que ejecuta Tria. En Unix el panel muestra el comando para esa máquina. Usuario, contraseña y segundo factor se introducen en el sitio oficial. No se trasladan sesiones a otra máquina.
- **Probar cuenta** envía una consulta mínima real y consume uso de la cuenta. El estado instalado no se confunde con conectado. Gemini/Kimi también se comprueban al iniciar una ejecución.
- DeepSeek: se incluye el acceso a su chat, marcado expresamente como **sin conector automático de cuenta**. No participa en tareas. Su acceso programático oficial documenta claves API; no se ha implementado un acceso alternativo mediante contraseñas web.
- Gemini usa aprobación yolo y Kimi modo no interactivo auto, para los trabajos que el usuario inicia. Sus modelos y cuotas dependen de la cuenta autorizada. Mantén la configuración del CLI orientada a OAuth; Tria no solicita claves API.

Referencias: [Cuenta Google y modo headless](https://geminicli.com/docs/get-started/authentication/), [Kimi Code y login](https://moonshotai.github.io/kimi-code/en/reference/kimi-command), [Autenticación DeepSeek](https://api-docs.deepseek.com/api/deepseek-api/).

## Ciclo real de una ejecución

1. Introduce una URL Git o un checkout local limpio y un objetivo. El checkout local debe tener al menos un commit; los archivos sin commit no se incluyen en un clon.
2. Pulsa Iniciar. Se clona el proyecto en el directorio de datos de Tria y se crea `tria/<id>`.
3. Si OpenClaw está activado, aporta estado del servidor. el primer agente seleccionado propone, los demás debaten y OpenClaw revisa implicaciones de infraestructura. El coordinador concreta el plan y asigna tareas entre los miembros seleccionados.
4. Las tareas se implementan **secuencialmente en una copia compartida**, con revisión de otro miembro del equipo. Esta versión no hace edición paralela ni combina varias ramas de agentes.
5. Tria ejecuta los comandos de verificación como procesos reales. Reparte correcciones cuando fallan; las rondas y el tiempo por turno son configurables.
6. Todos los agentes seleccionados auditan el resultado completo después de las pruebas. Solo entonces queda `Verificada`. Esto acredita el proceso y las comprobaciones ejecutadas; no garantiza ausencia de fallos ajenos a esos criterios.
7. Publicar rama envía el commit verificado al remoto existente. No crea una PR ni fusiona `main` automáticamente.
8. Desplegar usa SSH para obtener esa rama, comprueba su SHA, conserva el SHA anterior y hace checkout detached de la revisión exacta. Ejecuta tu comando de despliegue y tu health check. OpenClaw informa después del despliegue si está activado.

Puedes dar nuevas instrucciones al equipo: se incorporan al siguiente turno, sin interrumpir el comando actual. Detener cancela el proceso local y deja el estado recuperable. Reanudar continúa desde el último paso terminado; si una herramienta quedó a medias, se pide al agente inspeccionar los cambios antes de actuar. Un reinicio del servidor marca los trabajos activos como interrumpidos y requiere reanudarlos desde el panel.

## OpenClaw y SSH

La instrucción inicial está en [docs/PARA_OPENCLAW.md](docs/PARA_OPENCLAW.md), en Conexiones y en `tria handoff`. Solicita los datos reales del servidor y conserva la instalación existente.

Configura alias SSH o `usuario@host`, puerto, identidad opcional, ruta absoluta de Node, ejecutable e ID de agente OpenClaw, y ruta del proyecto remoto. Puedes escribir la contraseña del usuario remoto en Conexiones y pulsar **Guardar y comprobar conexión**. Se conserva únicamente en memoria hasta cerrar/reiniciar Tria; no se devuelve al navegador ni se almacena en settings.json. El botón Borrar contraseña elimina esa sesión. También puedes usar una clave SSH autorizada. El host debe estar reconocido en known_hosts o mediante su huella SHA256. La ruta con contraseña usa ssh2; la ruta con clave sigue utilizando OpenSSH.

El puente usa `ssh` + un pequeño proceso Node. No expone el Gateway de OpenClaw a Internet ni necesita un proveedor de IA adicional. Las órdenes de despliegue se ejecutan con `/bin/sh`: el destino de despliegue de esta versión debe ser **Linux/Unix**. El orquestador funciona en Windows y Unix; el entorno probado en esta entrega es Windows.

Si ejecutas Tria en el servidor y el navegador en tu ordenador:

```sh
ssh -N -L 4310:127.0.0.1:4310 usuario@servidor
```

Después abre `http://127.0.0.1:4310`. Si Tria se ejecuta en tu ordenador, ese túnel del panel no hace falta: SSH se utiliza para consultar OpenClaw y desplegar. El acceso por WiFi requiere que el hostname resuelva o que la IP configurada sea vigente.

## Control de acceso y despliegue

El propietario elige los permisos de los CLI en Conexiones; la configuración inicial permite acceso completo, acorde a una instancia administrada por su dueño. El panel escucha en loopback por defecto. Puedes cambiarlo con `--host` y configurar `TRIA_TOKEN` para requerir autenticación del panel. Tria no obliga a pasar por una aprobación adicional para cada comando de un trabajo iniciado.

Un despliegue usa los comandos que tú introduces, por ejemplo los proporcionados por OpenClaw. Un checkout remoto con cambios sin commit impide la sincronización para preservar el trabajo existente. Si el build o el health check fallan, Tria registra el error y el commit anterior; **no ejecuta un rollback automático** porque bases de datos/migraciones requieren un procedimiento propio del proyecto.

Cancelar SSH puede cortar el transporte sin garantizar la cancelación de un proceso que ya haya aceptado el Gateway remoto. El helper remoto tiene timeout propio; si se pierde la conexión, comprueba el servicio y la sesión de OpenClaw antes de repetir un despliegue. No hay reintento automático de despliegues.

## Datos y arquitectura

- `src/agents.mjs`: adaptadores de los CLI y normalización de respuestas.
- `src/engine.mjs`: discusión, plan, implementación/revisión, pruebas, publicación y despliegue.
- `src/process.mjs`: procesos, cancelación, comandos y SSH.
- `src/store.mjs`: snapshots atómicos JSON + historial append-only JSONL.
- `src/server.mjs`: API HTTP propia y Server-Sent Events; esta API local no es una API de pago de un proveedor de IA.
- `public/`: panel sin dependencias externas.
- `bin/tria.mjs`: CLI npm e instancia local.

El directorio de datos contiene configuración, clones, ejecuciones y conversaciones; no se incluye en el paquete ni en Git. Esta versión está orientada a un propietario por instancia, no a un servicio multiusuario. Conserva los eventos completos en disco; el panel limita la salida técnica visible. No hay compactación del historial en disco todavía.

## Verificación de esta entrega

Consulta [docs/VALIDACION.md](docs/VALIDACION.md). Las pruebas de integración usan agentes de fixture claramente identificados para verificar el motor con Git y procesos reales. Una prueba de fixture no demuestra que una cuenta de Claude esté autenticada o que un servidor SSH sea accesible. Esas conexiones se comprueban por separado.

Referencias de integración: [Codex no interactivo](https://learn.chatgpt.com/docs/non-interactive-mode), [Claude Code programático](https://code.claude.com/docs/en/headless), [CLI de OpenClaw](https://docs.openclaw.ai/cli/agent).
