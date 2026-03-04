# MXHOME — LabDash

Dashboard de infraestructura homelab. Monitoriza Proxmox, OPNsense, Kubernetes, Unraid, Plex, Immich y Home Assistant desde una única interfaz web con diagrama de red editable en el navegador.

---

## Stack

| Capa | Tecnología |
|---|---|
| Backend | FastAPI + Uvicorn (Python 3.12) |
| Frontend | Vite + React + TypeScript |
| Diagrama | @xyflow/react (React Flow) |
| Base de datos | SQLite (`aiosqlite`) |
| Contenedor | Docker multi-stage (Node 22 → Python 3.12-slim) |
| Orquestación | k3s / Kubernetes |

---

## Capturas

> Dashboard — nodos Proxmox, K8s, OPNsense  
> Network — editor React Flow con templates  
> Services — Plex, Immich, Unraid, Home Assistant  
> Settings — configuración de todas las integraciones

---

## Estructura del proyecto

```
LabDash/
├── backend/
│   ├── main.py          # FastAPI — 19 endpoints REST
│   ├── db.py            # SQLite async (settings + diagrama)
│   ├── templates.py     # Templates de topología de red
│   ├── proxmox.py       # Cliente Proxmox VE (ticket auth)
│   ├── opnsense.py      # Cliente OPNsense (API key)
│   ├── k8s.py           # Cliente Kubernetes (in-cluster / token)
│   ├── unraid.py        # Cliente Unraid GraphQL
│   ├── plex.py          # Cliente Plex Media Server
│   ├── immich.py        # Cliente Immich REST
│   ├── homeassistant.py # Cliente Home Assistant REST
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── App.tsx            # Shell con tabs y toasts
│   │   ├── api.ts             # Cliente HTTP tipado
│   │   ├── pages/
│   │   │   ├── Dashboard.tsx  # Proxmox VMs, K8s nodes, OPNsense gateways
│   │   │   ├── Network.tsx    # Editor react-flow (templates, edición, guardado)
│   │   │   ├── Services.tsx   # Plex, Immich, Unraid, Home Assistant, K8s workloads
│   │   │   └── Settings.tsx   # Formularios de credenciales
│   │   └── components/
│   │       └── InfraNode.tsx  # Nodo personalizado para React Flow
│   ├── index.css              # Tema oscuro completo
│   ├── index.html
│   ├── package.json
│   └── vite.config.ts
├── k3s/
│   └── deployment.yaml  # Namespace, Secret, PVC, RBAC, Deployment, Service, Ingress
├── Dockerfile           # Multi-stage build
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

---

## Despliegue en k3s

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

El despliegue incluye un `ClusterRole` con permisos de solo lectura sobre nodos, pods y deployments para que el dashboard pueda leer el propio clúster desde dentro.

---

## Configuración

Toda la configuración se gestiona desde **Settings** en la UI o mediante variables de entorno:

### Variables de entorno disponibles

| Variable | Descripción |
|---|---|
| `DB_PATH` | Ruta al fichero SQLite (default: `/data/labdash.db`) |
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

---

## Integraciones

### Proxmox VE
- Nodos del clúster (CPU, RAM, uptime, estado)
- Inventario de VMs y contenedores LXC con estado running/stopped
- Templates distinguidos del inventario

### OPNsense
- Estado de gateways WAN (online/offline, RTT, packet loss)
- Estadísticas de interfaces de red

### Kubernetes / k3s
- Nodos del clúster (Ready/NotReady, roles, versión kubelet)
- Deployments por namespace (réplicas deseadas vs ready)
- Conteo de pods running

### Unraid
- Info de sistema (CPU, RAM, versión OS, array status)
- Lista de contenedores Docker con estado

### Plex Media Server
- Info del servidor (nombre, versión, plataforma)
- Librerías con conteo de elementos

### Immich
- Estadísticas de fotos, vídeos y almacenamiento usado

### Home Assistant
- Estados de entidades configurables (sensors, device_trackers, media_players, etc.)
- Filtro por `entity_id` personalizable

---

## Editor de red

La pestaña **Network** incluye un editor de topología completo basado en React Flow:

| Acción | Cómo |
|---|---|
| Cargar template | Botón **Templates** → seleccionar → Cargar |
| Activar edición | Botón **Ver** → cambia a **Editando** |
| Añadir nodo | Botón **+ Nodo** → elegir tipo, nombre e IP |
| Conectar nodos | Arrastrar desde un handle (círculo) a otro nodo |
| Eliminar | Seleccionar nodo/arista → botón **Borrar sel.** |
| Guardar | Botón **Guardar** — persiste en SQLite |

### Template incluido: MXHOME
Topología completa predefinida:
```
Digi 10G ──┐
            ├──► OPNsense ──► Core Switch
KEIO 600M ─┘                     │
                    ┌────────────┼────────────┐
                 VLAN 1       VLAN 25      VLAN 50      VLAN 60
                 (LAB)        (WiFi)       (HomeLab)    (MAAS)
                 pve-*        WiFi AP      k3s-single   maas-ctrl
                 NAS                       Ingress LB   juju-ctrl
```

Para añadir más templates, editar `backend/templates.py` siguiendo la estructura de `MXHOME_TOPOLOGY`.

---

## API REST

| Método | Ruta | Descripción |
|---|---|---|
| `GET` | `/healthz` | Health check |
| `GET` | `/api/status` | Resumen agregado de toda la infra |
| `GET` | `/api/proxmox/nodes` | Nodos Proxmox con métricas |
| `GET` | `/api/proxmox/vms` | VMs y LXC agrupados por nodo |
| `GET` | `/api/opnsense/gateways` | Estado de gateways |
| `GET` | `/api/opnsense/interfaces` | Estadísticas de interfaces |
| `GET` | `/api/k8s/nodes` | Nodos Kubernetes |
| `GET` | `/api/k8s/workloads` | Deployments y pods por namespace |
| `GET` | `/api/unraid/system` | Info del sistema Unraid |
| `GET` | `/api/unraid/docker` | Contenedores Docker de Unraid |
| `GET` | `/api/plex/info` | Info y librerías de Plex |
| `GET` | `/api/immich/stats` | Estadísticas de Immich |
| `GET` | `/api/ha/states` | Estados de entidades de HA |
| `GET` | `/api/diagram` | Diagrama guardado (nodes + edges) |
| `POST` | `/api/diagram` | Guardar diagrama |
| `GET` | `/api/templates` | Listar templates disponibles |
| `GET` | `/api/templates/{id}` | Obtener un template |
| `GET` | `/api/settings` | Leer configuración (passwords enmascarados) |
| `POST` | `/api/settings` | Guardar configuración |

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
| Unraid | 60 s |
| Plex | 60 s |
| Immich | 60 s |

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