# LabDash `v2.5.5`

Dashboard de infraestructura homelab. Monitoriza Proxmox, OPNsense, Kubernetes, Unraid, Plex, Immich, Home Assistant, Portainer, Uptime Kuma y Tailscale desde una única interfaz web.

**Docker Hub:** [miguelix/labdash](https://hub.docker.com/r/miguelix/labdash)

```bash
docker pull miguelix/labdash:latest
```

---

## Despliegue rápido

### Docker Compose (imagen precompilada)

```yaml
services:
  labdash:
    image: miguelix/labdash:latest
    container_name: labdash
    restart: unless-stopped
    ports:
      - "8080:8080"
    volumes:
      - labdash_data:/data

volumes:
  labdash_data:
```

```bash
docker compose up -d
# Abrir http://localhost:8080
```

En el primer arranque aparece el **asistente de configuración** para crear el usuario administrador. Las credenciales de las integraciones también se pueden introducir directamente en **Settings** sin reiniciar el contenedor.

### Construir desde el código fuente

```bash
git clone https://github.com/tuuser/LabDash.git
cd LabDash
docker compose up -d --build
```

---

## Variables de entorno

Todas las credenciales son opcionales vía variables de entorno — también configurables desde la UI.

| Variable | Descripción |
|---|---|
| `DB_PATH` | Ruta al fichero SQLite (default: `/data/labdash.db`) |
| `DATABASE_URL` | URL PostgreSQL — activa el backend Postgres |
| `PVE_URL` / `PVE_USER` / `PVE_PASS` | Proxmox VE |
| `OPN_URL` / `OPN_KEY` / `OPN_SECRET` | OPNsense |
| `K8S_URL` / `K8S_TOKEN` | Kubernetes (vacío = in-cluster) |
| `UNRAID_URL` / `UNRAID_KEY` | Unraid |
| `PLEX_URL` / `PLEX_TOKEN` | Plex Media Server |
| `IMMICH_URL` / `IMMICH_KEY` | Immich |
| `HA_URL` / `HA_TOKEN` | Home Assistant |
| `PORTAINER_URL` / `PORTAINER_KEY` | Portainer CE/EE |
| `UPTIME_KUMA_URL` | Status page pública de Uptime Kuma |
| `TAILSCALE_KEY` | API token de Tailscale |
| `TELEGRAM_TOKEN` / `TELEGRAM_CHAT_ID` | Bot de alertas Telegram |
| `SNMP_TARGET` / `SNMP_COMMUNITY` | Switch SNMP (legado — usar Settings para múltiples targets) |
| `CORS_ORIGINS` | Orígenes CORS (default: `*`) |
| `SSL_VERIFY` | Verificar TLS al conectar con APIs externas (default: `false`) |

---

## Integraciones

| Servicio | Qué muestra |
|---|---|
| **Proxmox VE** | Nodos, VMs/LXC, controles de encendido, métricas en tiempo real |
| **OPNsense** | Gateways WAN, interfaces, versión/uptime/CPU/RAM, DHCP, ARP, firewall, WireGuard |
| **Kubernetes** | Nodos, deployments, pods por namespace |
| **Unraid** | Array, Docker, almacenamiento (compatible Unraid 7.x) |
| **Plex** | Sesiones activas, transcodificación, librerías |
| **Immich** | Fotos/vídeos/almacenamiento global y por usuario |
| **Home Assistant** | Estados de entidades con filtro por dominio; selección de entidades a mostrar |
| **Portainer** | Endpoints, stacks y contenedores |
| **Uptime Kuma** | Monitores up/down con % de uptime |
| **Tailscale** | Dispositivos VPN con estado online/offline |
| **SNMP** | Interfaces de switch: ancho de banda, velocidad, errores, info del sistema |

---

## Funcionalidades principales

- **Dashboard** — vista agregada de toda la infra con tarjetas por servicio
- **Network** — editor de topología interactivo (React Flow) con templates y generación automática desde la infra real
- **Alertas** — reglas configurables con Telegram, ntfy, email y webhook; bot Telegram con comandos `/status`, `/vms`, `/alerts`
- **2FA** — TOTP compatible con Google Authenticator / Authy
- **Búsqueda global** — `Ctrl+K` busca por nodos, VMs, gateways y servicios
- **Modo claro/oscuro** — toggle en la cabecera
- **Nombre personalizable** — campo `App name` en Settings
- **Backup/Restore** — exportación e importación de la BD completa

---

## Despliegue en k3s

```bash
# SQLite
kubectl apply -f k3s/deployment.yaml

# PostgreSQL (StatefulSet + backup diario)
kubectl apply -f k3s/deployment-postgres.yaml
```

Edita el `Secret` con tus credenciales y el `Ingress` con tu hostname antes de aplicar. La imagen ya está disponible en Docker Hub: `miguelix/labdash:latest`.

---

## HTTPS

LabDash sirve HTTP. Para producción, ponlo detrás de un reverse proxy:

**Nginx**
```nginx
location / {
    proxy_pass http://127.0.0.1:8080;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

**Traefik**
```yaml
labels:
  - "traefik.enable=true"
  - "traefik.http.routers.labdash.rule=Host(`dash.home.local`)"
  - "traefik.http.routers.labdash.entrypoints=websecure"
  - "traefik.http.routers.labdash.tls=true"
  - "traefik.http.services.labdash.loadbalancer.server.port=8080"
```

---

## Desarrollo local

```bash
# Backend
cd backend && pip install -r requirements.txt
uvicorn main:app --reload --port 8080

# Frontend (en otra terminal)
cd frontend && npm install && npm run dev
```

Swagger disponible en `http://localhost:8080/docs`.

---

## Stack

| Capa | Tecnología |
|---|---|
| Backend | FastAPI + Uvicorn (Python 3.12) |
| Frontend | Vite + React 18 + TypeScript |
| Diagrama de red | @xyflow/react (React Flow) |
| Base de datos | SQLite (`aiosqlite`) o PostgreSQL (`asyncpg`) |
| Contenedor | Docker multi-stage (Node 22 → Python 3.12-slim) |

---

## Licencia

MIT
