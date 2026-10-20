# Pedidos de la cafetería

App para que los alumnos pidan antes del recreo y la cafetería tenga todo pronto.

- `/` → app del alumno
- `/cafeteria.html` → panel de la cafetería

## Arquitectura

Una imagen (Node + Express) que sirve la API y las pantallas, más Postgres. En Kubernetes:

| Objeto | Para qué |
|---|---|
| `Deployment cafeteria` (2 réplicas) + `Service` | App y API |
| `StatefulSet postgres` + PVC + `Service` | Base de datos persistente |
| `ConfigMap cafeteria-config` | X minutos de corte y horarios de recreo |
| `Secret cafeteria-db` | Password de la base, lo crea el pipeline |
| `Ingress` | Expone la app |

## Regla del corte

El backend rechaza con `409` cualquier pedido hecho después de `hora del recreo − X`. El frontend solo muestra lo que dice el backend.

X se cambia sin redesplegar, porque el ConfigMap está montado como archivo y se lee en cada request:

```bash
kubectl edit configmap cafeteria-config -n team10
```

En menos de un minuto la app toma el nuevo valor.

## Correr local

```bash
docker compose up --build
```

Abrir http://localhost:3000 y http://localhost:3000/cafeteria.html

## Pipeline

En cada PR corre los tests. En cada push a `main` construye la imagen con el SHA del commit, la sube a GHCR y despliega al namespace `team10`.

Secrets necesarios en GitHub: `KUBECONFIG` (el archivo del laboratorio entero) y `DB_PASSWORD`.
