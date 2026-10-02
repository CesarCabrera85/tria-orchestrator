# Instrucción de César para OpenClaw: integración con Tria

Estoy construyendo Tria, un orquestador local instalable mediante npm que coordina Codex CLI, Claude Code y tu instancia de OpenClaw. Quiero que trabajéis en equipo para construir y terminar mis proyectos a partir de un repositorio Git y un objetivo. Lee esto como mi encargo de preparar la integración, no como una orden de sustituir tu instalación actual.

## Funcionamiento acordado

- Tria ejecuta Codex y Claude Code con sus sesiones de suscripción ya iniciadas. No quiero añadir API keys ni cambiar de proveedor/modelo para esta integración.
- El panel, historial, repositorios de trabajo y procesos del orquestador se alojan en mis equipos. Las inferencias de Codex y Claude siguen usando sus servicios externos; no estamos afirmando que esos modelos funcionen offline.
- Tú aportas el conocimiento del proyecto que creaste, el estado real del servidor, sus rutas y su procedimiento de despliegue. Participas en la conversación junto con Codex y Claude.
- Tria desarrolla en una copia de trabajo independiente y en una rama `tria/<id>`. Los agentes debaten y se reparten tareas; cada tarea recibe revisión del otro agente y se ejecutan las pruebas. Evitad modificar la misma copia a la vez.
- Las ramas verificadas se publican en GitHub. El servidor puede obtener esa revisión exacta y desplegarla. Conservad mis cambios existentes y el commit anterior para poder recuperar el servicio.
- Yo decido los accesos y permisos. Respetad mi autorización de trabajar en estos proyectos sin pedirme confirmación a cada paso. Si falta un dato concreto, una cuenta o hay una limitación real, explicadla una vez y continuad con lo que sí se pueda hacer. No añadáis recomendaciones genéricas ajenas a la tarea. Esta instrucción no desactiva políticas del proveedor ni implica que se puedan saltar bloqueos técnicos.

## Prepara la puerta de conexión

1. Identifica sistema operativo, usuario de servicio, IP/hostname del servidor en mi red, puerto SSH y método actual de acceso. Reutiliza el SSH existente si lo hay. No envíes contraseñas, claves privadas, cookies ni tokens.
2. Comprueba Node.js (22 o superior), Git y el ejecutable de OpenClaw. Comunica sus rutas absolutas y sus versiones. La conexión inicial de Tria a este servidor usa SSH y un pequeño proceso Node; no requiere publicar un puerto de OpenClaw en Internet.
3. Identifica el ID del agente que conoce mis proyectos. Comprueba la sintaxis de `openclaw agent --help`. Necesitamos `agent --agent ID --session-id UUID --json --message TEXTO`. No utilices `--local` contra un Gateway que ya está activo. Mantén su modelo y autenticación actuales.
4. Para cada proyecto que vamos a gestionar, devuelve URL GitHub, ruta absoluta del checkout del servidor, rama y commit actuales, estado de Git, documentos .md importantes, gestor de dependencias y comandos reales de instalación/build/test/arranque.
5. Describe cómo despliegas ahora (Docker Compose, systemd, PM2 u otro), el directorio desde el que se ejecuta, puertos y un comando de health check que falle con código distinto de 0 si el servicio no funciona. Explica migraciones, variables requeridas por nombre, volúmenes y datos persistentes, sin revelar sus valores secretos.
6. Si hay cambios locales sin commit, informa y consérvalos antes de sincronizar. No hagas reset --hard ni borres datos. Tria no puede desplegar de forma fiable una revisión distinta a la que ha probado.
7. No despliegues ni reinicies la web únicamente por recibir este mensaje. Primero devuelve los datos de conexión y la ficha del proyecto. Si hace falta habilitar SSH y está dentro del acceso que ya te he autorizado, prepáralo y verifica la conexión; informa de cualquier dato que necesites de mi ordenador.

## Respuesta que necesita Tria

Devuelve un bloque JSON con datos reales (usa null donde todavía falte un dato):

```json
{
  "ssh": {"target":"usuario@host-o-alias", "port":22, "node":"/ruta/absoluta/node", "repoPath":"/ruta/del/proyecto"},
  "openclaw": {"command":"/ruta/absoluta/openclaw", "agent":"ID_REAL"},
  "repository":"URL_REAL_GITHUB",
  "currentBranch":"RAMA_REAL",
  "currentCommit":"SHA_REAL",
  "workingTreeClean":false,
  "documents":["README.md"],
  "verificationCommands":["COMANDOS_REALES"],
  "deployCommand":"COMANDO_REAL_DESDE_repoPath",
  "healthCommand":"COMANDO_REAL_QUE_COMPRUEBA_EL_SERVICIO",
  "pending":[]
}
```

El acceso al panel remoto se puede realizar con un túnel como `ssh -N -L 4310:127.0.0.1:4310 usuario@servidor`, si Tria vive allí. Si Tria vive en el ordenador donde están mis cuentas de Codex y Claude, su panel es local y SSH se usa para hablar contigo y desplegar. No copies credenciales de esas cuentas al servidor.
