# MXHOME — LabDash

Dashboard de infraestructura homelab. Monitoriza Proxmox, OPNsense, Kubernetes, Unraid, Plex, Immich, Home Assistant, Portainer, Uptime Kuma y Tailscale desde una única interfaz web con diagrama de red interactivo, sistema de alertas y autenticación 2FA.

---

## Stack

| Capa | Tecnología |
|---|---|
| Backend | FastAPI + Uvicorn (Python 3.12) |
| Frontend | Vite + React 18 + TypeScript |
| Diagrama | @xyflow/react (React Flow) |
| Base de datos | SQLite (`aiosqlite`) o PostgreSQL (`asyncpg`) |
| Contenedor | Docker multi-stage (Node 22 → Python 3.12-slim) |
| Orquestación | k3s / Kubernetes |

---

## Capturas

> **Dashboard** — nodos Proxmox, K8s, OPNsense, eventos del sistema
> **Network** — editor React Flow con templates y topología automática
> **Proxmox** — gestión de VMs/LXC con controles de encendido
> **OPNsense** — gateways, reglas, WiFi, WireGuard, DHCP
> **Unraid** — array, Docker, almacenamiento
> **Notifications** — reglas de alerta, Telegram, historial
> **Settings** — credenciales, 2FA, usuarios, backup/restore

---

## Estructura del proyecto

```
LabDash/
├── backend/
│   ├── main.py            # FastAPI — 86+ endpoints REST
│   ├── db.py              # SQLite async (settings, usuarios, métricas, alertas)
│   ├── db_pg.py           # PostgreSQL async (alternativa a db.py)
│   ├── auth.py            # Autenticación: PBKDF2 + TOTP 2FA + rate limiting
│   ├── alerting.py        # Motor de alertas con canal multi-destino
│   ├── collector.py       # Colector de métricas en background
│   ├── templates.py       # Templates de topología de red
│   ├── proxmox.py         # Cliente Proxmox VE (ticket auth)
│   ├── opnsense.py        # Cliente OPNsense (API key)
│   ├── k8s.py             # Cliente Kubernetes (in-cluster / token)
│   ├── unraid.py          # Cliente Unraid GraphQL
│   ├── plex.py            # Cliente Plex Media Server
│   ├── immich.py          # Cliente Immich REST
│   ├── homeassistant.py   # Cliente Home Assistant REST
│   ├── portainer.py       # Cliente Portainer CE/EE
│   ├── uptime_kuma.py     # Cliente Uptime Kuma (status page API)
│   ├── tailscale.py       # Cliente Tailscale VPN
│   ├── telegram.py        # Bot Telegram con botones inline
│   ├── snmp.py            # Poller SNMP (IF-MIB, ancho de banda)
│   ├── snmp_trap.py       # Receptor de traps SNMP (UDP)
│   ├── ping.py            # Ping batch concurrente
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── App.tsx                      # Shell, rutas, toasts, dark mode
│   │   ├── api.ts                       # Cliente HTTP tipado con auth
│   │   ├── pages/
│   │   │   ├── Dashboard.tsx            # Vista agregada de toda la infra
│   │   │   ├── Network.tsx              # Editor React Flow + topología auto
│   │   │   ├── Proxmox.tsx              # VMs/LXC con controles de potencia
│   │   │   ├── OPNsense.tsx             # Firewall, WiFi, WireGuard, DHCP
│   │   │   ├── Unraid.tsx               # NAS, array y Docker
│   │   │   ├── Services.tsx             # Plex, Immich, Home Assistant
│   │   │   ├── Notifications.tsx        # Alertas, Telegram, historial
│   │   │   ├── Settings.tsx             # Credenciales, 2FA, usuarios, backup
│   │   │   ├── SetupWizard.tsx          # Asistente de configuración inicial
│   │   │   ├── Login.tsx                # Login + verificación TOTP
│   │   │   ├── TotpSetup.tsx            # Configuración de autenticador
│   │   │   └── TotpVerify.tsx           # Verificación de código TOTP
│   │   └── components/
│   │       ├── GlobalSearch.tsx         # Búsqueda global (Ctrl+K)
│   │       ├── InfraNode.tsx            # Nodo personalizado para React Flow
│   │       ├── LineChart.tsx            # Gráfica de métricas históricas
│   │       └── Sparkline.tsx            # Mini-gráfica inline para cards
│   ├── index.css                        # Tema oscuro completo
│   ├── index.html
│   ├── package.json
│   └── vite.config.ts
├── k3s/
│   ├── deployment.yaml           # SQLite: Namespace, PVC, RBAC, Ingress
│   └── deployment-postgres.yaml  # PostgreSQL: StatefulSet + backup CronJob
├── Dockerfile           # Multi-stage build (Node → Python)
├── docker-compose.yml
└── .dockerignore
```

---

## Despliegue rápido con Docker

```bash
# 1. Clonar el repo
git clone https://github.com/tuuser/LabDash.git
cd LabDash

# 2. (Opcional) Crear .env con credenciales iniciales
cat > .env << 'EOF'
PVE_URL=https://192.168.1.7:8006
PVE_USER=root@pam
PVE_PASS=tupassword
OPN_URL=https://192.168.1.1
OPN_KEY=tuapikey
OPN_SECRET=tuapisecret
EOF

# 3. Construir y arrancar
docker compose up -d

# 4. Abrir en el navegador
open http://localhost:8080
```

> Las credenciales también se pueden introducir directamente en la pestaña **Settings** de la interfaz web. No es necesario reiniciar el contenedor.

En el primer arranque se muestra el **asistente de configuración** para crear el usuario administrador y configurar las integraciones.

---

## Despliegue en k3s

### SQLite (por defecto)

```bash
# 1. Editar el Secret con tus credenciales
vim k3s/deployment.yaml   # busca "stringData:"

# 2. Cambiar la imagen por la tuya
# image: ghcr.io/tuusuario/labdash:latest

# 3. Cambiar el hostname del Ingress
# host: dash.home.local

# 4. Aplicar
kubectl apply -f k3s/deployment.yaml

# 5. Verificar
kubectl get pods -n labdash
```

### PostgreSQL

```bash
kubectl apply -f k3s/deployment-postgres.yaml
```

Incluye StatefulSet de PostgreSQL 16, init container que espera a que la BD esté lista y CronJob de backup diario con `pg_dump` (retención 7 días).

El despliegue incluye un `ClusterRole` con permisos de solo lectura sobre nodos, pods y deployments.

---

## Configuración

Toda la configuración se gestiona desde **Settings** en la UI o mediante variables de entorno:

### Variables de entorno

| Variable | Descripción |
|---|---|
| `DB_PATH` | Ruta al fichero SQLite (default: `/data/labdash.db`) |
| `DATABASE_URL` | URL PostgreSQL — activa el backend Postgres (ej. `postgresql://user:pass@host/db`) |
| `PVE_URL` | URL del host Proxmox (ej. `https://192.168.1.7:8006`) |
| `PVE_USER` | Usuario Proxmox (ej. `root@pam`) |
| `PVE_PASS` | Contraseña Proxmox |
| `OPN_URL` | URL OPNsense |
| `OPN_KEY` | API key OPNsense |
| `OPN_SECRET` | API secret OPNsense |
| `K8S_URL` | URL del API server (vacío = in-cluster automático) |
| `K8S_TOKEN` | Bearer token de Kubernetes |
| `UNRAID_URL` | URL de Unraid (ej. `http://192.168.1.10`) |
| `UNRAID_KEY` | API key de Unraid |
| `PLEX_URL` | URL de Plex (ej. `http://192.168.1.10:32400`) |
| `PLEX_TOKEN` | X-Plex-Token |
| `IMMICH_URL` | URL de Immich (ej. `http://192.168.1.10:2283`) |
| `IMMICH_KEY` | API key de Immich |
| `HA_URL` | URL de Home Assistant |
| `HA_TOKEN` | Long-Lived Access Token de HA |
| `HA_ENTITIES` | Lista de entity_id separados por comas (vacío = automático) |
| `PORTAINER_URL` | URL de Portainer CE/EE |
| `PORTAINER_KEY` | API key de Portainer |
| `UPTIME_KUMA_URL` | URL de la status page pública de Uptime Kuma |
| `TAILSCALE_KEY` | Bearer token de la API de Tailscale |
| `TELEGRAM_TOKEN` | Token del bot de Telegram |
| `TELEGRAM_CHAT_ID` | Chat ID por defecto para alertas |
| `SNMP_TARGET` | IP del switch SNMP (legado — usar Settings para múltiples targets) |
| `SNMP_COMMUNITY` | Comunidad SNMP (default: `public`) |

---

## Integraciones

### Proxmox VE
- Nodos del clúster (CPU, RAM, uptime, estado)
- Inventario de VMs y contenedores LXC con estado running/stopped
- Controles de encendido/apagado/reinicio
- Detalle de nodo con métricas en tiempo real
- Templates distinguidos del inventario

### OPNsense
- Estado de gateways WAN (online/offline, RTT, packet loss)
- Estadísticas de interfaces de red
- Reglas de firewall
- Tablas DHCP y ARP
- Puntos de acceso WiFi (SSID, clientes conectados, señal)
- Estado de túneles WireGuard

### Kubernetes / k3s
- Nodos del clúster (Ready/NotReady, roles, versión kubelet)
- Deployments, DaemonSets y StatefulSets por namespace
- Conteo de pods running

### Unraid
- Info de sistema (CPU, RAM, versión OS, array status)
- Lista de contenedores Docker con estado
- Estado del array de discos

### Plex Media Server
- Info del servidor (nombre, versión, plataforma)
- Librerías con conteo de elementos

### Immich
- Estadísticas de fotos, vídeos y almacenamiento usado

### Home Assistant
- Estados de entidades configurables (sensors, device_trackers, media_players, etc.)
- Filtro por `entity_id` personalizable

### Portainer
- Estado de endpoints (Docker/Swarm/K8s)
- Listado de stacks con estado
- Inventario de contenedores por endpoint

### Uptime Kuma
- Monitores con estado up/down
- Porcentaje de uptime por monitor
- Historial de latencia

### Tailscale
- Dispositivos conectados a la red VPN
- Estado online/offline, IPs asignadas, sistema operativo
- Soporte de etiquetas (ACL tags)

### SNMP
- Interfaces de switches (IF-MIB: estado operacional, descripción)
- Cálculo de ancho de banda desde contadores de 64 bits
- Soporte multi-target via configuración

### Traps SNMP
- Receptor UDP (puerto 1620 por defecto)
- Decodificación BER/TLV de OIDs y valores
- SNMPv1 y SNMPv2c
- Eventos persistidos en base de datos

---

## Autenticación y seguridad

- **Contraseñas**: PBKDF2-HMAC-SHA256 con 260.000 iteraciones (OWASP 2023)
- **2FA**: TOTP compatible con Google Authenticator, Authy, etc. (RFC 6238)
- **Sesiones**: tokens Bearer con TTL de 12 horas
- **Rate limiting**: 5 intentos por ventana de 5 minutos, bloqueo 10 minutos
- **Gestión de usuarios**: creación, roles (admin/viewer), eliminación
- **Sesiones activas**: listado y revocación individual
- **Audit log**: registro de todas las acciones de usuario
- **Backup/Restore**: exportación e importación de la base de datos

---

## Sistema de alertas

La pestaña **Notifications** permite crear reglas que evalúan métricas recogidas por el colector:

| Campo | Descripción |
|---|---|
| Métrica | Clave de la métrica (ej. `proxmox.node.cpu`) |
| Operador | `gt`, `lt`, `eq`, `ne`, `gte`, `lte` |
| Umbral | Valor numérico de comparación |
| Cooldown | Tiempo mínimo entre disparos (5 min – 24 h) |

**Canales de notificación disponibles:**
- **Telegram** — mensajes ricos con botones de silencio inline (1h / 6h / 24h)
- **ntfy.sh** — notificaciones push ligeras
- **Email** — SMTP configurable
- **Webhook** — POST HTTP a cualquier URL

El bot de Telegram acepta comandos: `/status`, `/vms`, `/alerts`, `/silences`, `/help`.

---

## Editor de red

La pestaña **Network** incluye un editor de topología completo basado en React Flow:

| Acción | Cómo |
|---|---|
| Cargar template | Botón **Templates** → seleccionar → Cargar |
| Generar topología | Botón **Auto** — detecta nodos desde la infra real |
| Activar edición | Botón **Ver** → cambia a **Editando** |
| Añadir nodo | Botón **+ Nodo** → elegir tipo, nombre e IP |
| Conectar nodos | Arrastrar desde un handle (círculo) a otro nodo |
| Eliminar | Seleccionar nodo/arista → botón **Borrar sel.** |
| Exportar / Importar | Botones en la barra de herramientas |
| Guardar | Botón **Guardar** — persiste en SQLite/Postgres |

Los nodos muestran estado en tiempo real con polling cada 15 segundos. La topología se autoguarda cada 5 minutos.

---

## API REST

### Autenticación

| Método | Ruta | Descripción |
|---|---|---|
| `POST` | `/api/auth/login` | Login con usuario y contraseña |
| `POST` | `/api/auth/verify-totp` | Verificación TOTP en el flujo de login |
| `POST` | `/api/auth/logout` | Invalidar sesión actual |
| `POST` | `/api/auth/change-password` | Cambiar contraseña |
| `GET` | `/api/auth/totp-init` | Generar secreto TOTP |
| `GET` | `/api/auth/totp-qr` | QR para app de autenticación |
| `POST` | `/api/auth/totp-enable` | Activar 2FA |
| `POST` | `/api/auth/disable-totp` | Desactivar 2FA |
| `GET` | `/api/auth/me` | Info del usuario actual |

### Usuarios y sesiones

| Método | Ruta | Descripción |
|---|---|---|
| `GET` | `/api/users` | Listar usuarios |
| `POST` | `/api/users` | Crear usuario |
| `PATCH` | `/api/users/{id}/role` | Cambiar rol |
| `DELETE` | `/api/users/{id}` | Eliminar usuario |
| `GET` | `/api/sessions` | Sesiones activas |
| `DELETE` | `/api/sessions/{token}` | Revocar sesión |
| `GET` | `/api/audit-log` | Log de auditoría |

### Infraestructura

| Método | Ruta | Descripción |
|---|---|---|
| `GET` | `/api/proxmox/nodes` | Nodos Proxmox con métricas |
| `GET` | `/api/proxmox/vms` | VMs y LXC agrupados por nodo |
| `GET` | `/api/proxmox/node-detail/{node}` | Detalle de nodo |
| `POST` | `/api/proxmox/vm-action` | Control de potencia (start/stop/reboot) |
| `GET` | `/api/opnsense/gateways` | Estado de gateways |
| `GET` | `/api/opnsense/interfaces` | Estadísticas de interfaces |
| `GET` | `/api/opnsense/sysinfo` | Info del sistema OPNsense |
| `GET` | `/api/opnsense/dhcp` | Tabla DHCP |
| `GET` | `/api/opnsense/arp` | Tabla ARP |
| `GET` | `/api/opnsense/fw-rules` | Reglas de firewall |
| `GET` | `/api/opnsense/wifi` | APs WiFi y clientes |
| `GET` | `/api/opnsense/wireguard` | Estado WireGuard |
| `GET` | `/api/k8s/nodes` | Nodos Kubernetes |
| `GET` | `/api/k8s/workloads` | Deployments y pods |
| `GET` | `/api/unraid/system` | Info del sistema Unraid |
| `GET` | `/api/unraid/docker` | Contenedores Docker |
| `GET` | `/api/unraid/disks` | Estado del array |
| `GET` | `/api/plex/info` | Info y librerías de Plex |
| `GET` | `/api/immich/stats` | Estadísticas de Immich |
| `GET` | `/api/ha/states` | Estados de entidades de HA |
| `GET` | `/api/portainer/data` | Endpoints, stacks y contenedores |
| `GET` | `/api/uptime-kuma/monitors` | Monitores de Uptime Kuma |
| `GET` | `/api/tailscale/devices` | Dispositivos Tailscale |

### Red y monitorización

| Método | Ruta | Descripción |
|---|---|---|
| `POST` | `/api/ping` | Ping batch a lista de IPs |
| `GET` | `/api/snmp/interfaces` | Interfaces SNMP de switch |
| `GET` | `/api/network/live` | Estado de red en vivo (SNMP + ping) |
| `POST` | `/api/wol` | Wake-on-LAN |

### Diagrama y templates

| Método | Ruta | Descripción |
|---|---|---|
| `GET` | `/api/diagram` | Diagrama guardado (nodes + edges) |
| `POST` | `/api/diagram` | Guardar diagrama |
| `GET` | `/api/templates` | Listar templates disponibles |
| `GET` | `/api/templates/{id}` | Obtener un template |

### Alertas y notificaciones

| Método | Ruta | Descripción |
|---|---|---|
| `GET` | `/api/alert-rules` | Listar reglas de alerta |
| `POST` | `/api/alert-rules` | Crear regla |
| `PATCH` | `/api/alert-rules/{id}` | Actualizar regla |
| `DELETE` | `/api/alert-rules/{id}` | Eliminar regla |
| `PATCH` | `/api/alert-rules/{id}/toggle` | Activar/desactivar regla |
| `POST` | `/api/alert-rules/{id}/test` | Enviar alerta de prueba |
| `POST` | `/api/alert-rules/{id}/silence` | Silenciar regla |
| `GET` | `/api/alert-silences` | Reglas silenciadas |
| `GET` | `/api/alert-history` | Historial de alertas disparadas |
| `GET` | `/api/telegram/status` | Estado del bot de Telegram |
| `POST` | `/api/telegram/config` | Configurar bot |
| `POST` | `/api/telegram/test` | Enviar mensaje de prueba |
| `POST` | `/api/telegram/webhook` | Webhook receptor de Telegram |

### Métricas, eventos y configuración

| Método | Ruta | Descripción |
|---|---|---|
| `GET` | `/api/metrics/{key}` | Métricas históricas (24h por defecto) |
| `GET` | `/api/metrics-keys` | Claves de métricas disponibles |
| `GET` | `/api/events` | Log de eventos del sistema |
| `GET` | `/api/uptime/{host}` | Historial de uptime por host |
| `GET` | `/api/settings` | Leer configuración (passwords enmascarados) |
| `POST` | `/api/settings` | Guardar configuración |
| `GET` | `/api/backup` | Exportar backup de la BD |
| `POST` | `/api/restore` | Importar backup |
| `GET` | `/api/dashboard/bundle` | Todos los datos del dashboard en una sola llamada |
| `GET` | `/healthz` | Health check |

La documentación interactiva (Swagger) está disponible en `/docs`.

---

## Caché

Cada cliente tiene su propio TTL para reducir la carga sobre las APIs externas:

| Integración | TTL |
|---|---|
| Proxmox | 20 s |
| OPNsense | 30 s |
| Kubernetes | 30 s |
| Home Assistant | 30 s |
| Portainer | 30 s |
| Unraid | 60 s |
| Plex | 60 s |
| Immich | 60 s |
| Uptime Kuma | 60 s |
| Tailscale | 60 s |
| Ping | 10 s |
| SNMP | 10 s |

Al guardar la configuración desde Settings, todos los cachés se invalidan automáticamente.

---

## Desarrollo local (sin Docker)

```bash
# Backend
cd backend
pip install -r requirements.txt
uvicorn main:app --reload --port 8080

# Frontend (en otra terminal)
cd frontend
npm install
npm run dev   # proxy → localhost:8080
```

El proxy de Vite redirecciona `/api/*` al backend automáticamente durante el desarrollo.

---

## Licencia

MIT
