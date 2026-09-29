# Despliegue de un servicio Node.js con GitHub Actions

Proyecto práctico de **CI/CD en toda la cadena**:

1. **IaC:** un Droplet en DigitalOcean se crea con Terraform y se configura con Ansible.
2. **La app:** un servicio Node.js (Express) con `/` que responde `Hello, world!`.
3. **Deploy manual:** el playbook `node_service.yml` (rol `app`) deja la app corriendo en el
   puerto 80.
4. **Deploy automático:** un workflow de GitHub Actions despliega en cada push a `main`, con dos
   opciones: `ansible-playbook` (opción 1) y `rsync + SSH` (opción 2).

- **Requisito principal:** código Terraform que cree un Droplet en DigitalOcean con IP pública,
  configurado por Ansible (Node.js instalado).
- **Reto 1:** rol `app` en Ansible que clone, instale dependencias, compile y arranque la app.
- **Reto 2:** workflow de GitHub Actions (secrets + variables de entorno) que automatice el
  despliegue.
- **Anexo A (opcional):** replicar la misma IaC contra AWS emulado con
  [Floci](https://floci.io), gratis y en local.

> Recordatorio: DigitalOcean cobra por Droplet activo. Cuando termines la práctica, ejecuta
> `terraform destroy` (paso 13) para dejar de pagar.

---

## 0. Prerrequisitos

| Herramienta | Versión mínima | Para qué la usamos |
|-------------|----------------|--------------------|
| Terraform   | >= 1.5         | Crear el Droplet   |
| Ansible     | ansible-core 2.15+ | Configurar el servidor y desplegar la app |
| doctl (opcional) | reciente  | Listar regiones, sizes, imágenes y claves SSH |
| Cuenta en DigitalOcean | — | Cuenta válida con un método de pago activo |

Todo lo que sigue está pensado para una máquina local con Linux/macOS (o WSL en Windows).

---

## 1. Crear la cuenta y el token de API en DigitalOcean

1. Entra en <https://cloud.digitalocean.com> y crea una cuenta.
2. Ve a **API Tokens**: <https://cloud.digitalocean.com/account/api/tokens>
3. Click en **Generate Token**:
   - Name: `terraform-iac`
   - Scope: **Read & Write**
   - Expiration: elige el plazo que prefieras.
4. **Copia el token**: solo se muestra una vez y es la credencial que usará Terraform.

Guárdalo en un archivo o gestor de contraseñas; no lo subas a git.

```bash
export DIGITALOCEAN_TOKEN="dop_v1_XXXXXXXXXXXXXXXXXXXXXXXX"
```

Si usas `doctl` en algún momento, la variable se llama `DIGITALOCEAN_ACCESS_TOKEN`; el provider
acepta las dos (`DIGITALOCEAN_TOKEN` y `DIGITALOCEAN_ACCESS_TOKEN`).

### Instalación opcional de doctl

```bash
# macOS
brew install doctl

# Linux (binario oficial). Descarga el .tar.gz de tu arquitectura en
# https://github.com/digitalocean/doctl/releases/latest
curl -sSLo /tmp/doctl.tar.gz \
  https://github.com/digitalocean/doctl/releases/latest/download/doctl-<VERSION>_linux_amd64.tar.gz
sudo tar -xzf /tmp/doctl.tar.gz -C /usr/local/bin doctl
doctl version
```

doctl es útil para **descubrir valores válidos** antes de escribirlos a mano:

```bash
doctl compute region list          # region -> slug (nyc1, nyc3, fra1, sgp1, ...)
doctl compute size list            # size -> slug (s-1vcpu-1gb, s-2vcpu-2gb, ...)
doctl compute image list-distribution   # image -> slug (ubuntu-24-04-x64, ...)
doctl compute ssh-key list
```

---

## 2. Generar el par de claves SSH

El requisito del proyecto es entrar **con clave privada, sin contraseña**. La clave pública
es la que se registra en DigitalOcean.

```bash
# Si ya tienes una, no repitas esto
ssh-keygen -t ed25519 -C "terraform-iac-lab" -f ~/.ssh/id_ed25519

# Comprobar que existe la publica
ls -l ~/.ssh/id_ed25519*
```

- `~/.ssh/id_ed25519` → **privada**, nunca se comparte ni se sube al repo.
- `~/.ssh/id_ed25519.pub` → **pública**, es la que Terraform registra en tu cuenta.

Si ya tienes una clave subida a DigitalOcean, obtén su fingerprint y úsala en el paso 6
(`ssh_key_fingerprint`) para no duplicarla:

```bash
doctl compute ssh-key list
# ID          Name                FingerPrint
# 32000000    laptop             aa:bb:cc:dd:...
```

---

## 3. Instalar Terraform (Debian / Ubuntu)

Método recomendado con el repositorio oficial de HashiCorp:

```bash
sudo apt-get update
sudo apt-get install -y gnupg software-properties-common curl

curl -fsSL https://apt.releases.hashicorp.com/gpg \
  | sudo gpg --dearmor -o /usr/share/keyrings/hashicorp-archive-keyring.gpg

echo "deb [signed-by=/usr/share/keyrings/hashicorp-archive-keyring.gpg] \
https://apt.releases.hashicorp.com $(lsb_release -cs) main" \
  | sudo tee /etc/apt/sources.list.d/hashicorp.list

sudo apt-get update
sudo apt-get install -y terraform
```

Alternativas:

```bash
# macOS
brew install terraform
brew install tfenv tfenv-plugin-terraform   # para gestionar versiones

# Cualquier Linux, binario manual
curl -sSLo /tmp/tf.zip \
  https://releases.hashicorp.com/terraform/1.9.8/terraform_1.9.8_linux_amd64.zip
sudo unzip -o /tmp/tf.zip -d /usr/local/bin
```

Verificación (debe imprimir `Terraform v1.x.x`):

```bash
terraform version
```

---

## 4. Instalar Ansible

Opción A — paquete del sistema (simple):

```bash
sudo apt-get update
sudo apt-get install -y ansible-core
```

Opción B — `pipx` (independiente del sistema, recomendado en máquinas de trabajo):

```bash
pipx install ansible-core
# o: python3 -m pip install --user ansible-core
```

Verificación y colección necesaria para el módulo de firewall:

```bash
ansible --version
ansible-galaxy collection install -r ansible/requirements.yml
```

---

## 5. Estructura del proyecto

```
IaC-on-DigitalOcean/
├── app/                          # <-- servico Node.js (Express)
│   ├── package.json              #     dependencias y scripts (build/start)
│   ├── package-lock.json         #     fija las versiones para npm ci
│   ├── scripts/build.js          #     compila src/ -> dist/ + build-info.json
│   ├── src/index.js              #     GET / -> "Hello, world!", /healthz, /info
│   └── (dist/ y node_modules/ no se versionan)
├── terraform/
│   ├── main.tf                     # provider + ssh key + droplet
│   ├── variables.tf                # variables de entrada
│   ├── outputs.tf                  # IP, comando ssh, línea de inventario
│   └── terraform.tfvars.example    # plantilla de valores
├── terraform-floci/                # la misma IaC contra AWS emulado (opcional, Anexo A)
│   ├── provider.tf                 # provider aws apuntando a Floci
│   ├── main.tf                     # S3, SQS, DynamoDB, SSM, IAM y EC2 emulados
│   ├── variables.tf
│   └── outputs.tf
├── floci/
│   └── docker-compose.yml          # emulador local de AWS
├── ansible/
│   ├── ansible.cfg
│   ├── inventory.ini               # grupos [droplets] y [app]
│   ├── inventory.app.example.ini   # plantilla del grupo [app]
│   ├── requirements.yml
│   ├── site.yml                    # playbook de config del servidor
│   ├── node_service.yml            # playbook de despliegue de la app <-- nuevo
│   └── roles/
│       └── app/                    # rol de despliegue (clonar, instalar, build, start)
│           ├── defaults/main.yml
│           ├── tasks/main.yml
│           └── templates/node-service.service.j2
├── .github/
│   └── workflows/
│       ├── deploy-ansible.yml      # Opción 1: deploy con ansible-playbook
│       └── deploy-ssh.yml          # Opción 2: deploy con rsync + SSH
└── README.md
```

El estado de Terraform se guarda en `terraform/terraform.tfstate` (backend local). Ese archivo
es el "historial" de tu infraestructura: **no lo borres si quieres poder destruir el Droplet**,
y nunca lo subas a git.

---

## 6. Configurar las variables

```bash
cd terraform
cp terraform.tfvars.example terraform.tfvars
$EDITOR terraform.tfvars
```

`terraform.tfvars` está en `.gitignore`, así que es el sitio correcto para el token:

```hcl
do_token = "dop_v1_XXXXXXXXXXXXXXXXXXXXXXXX"

droplet_name   = "web-1"
droplet_region = "nyc3"
droplet_size   = "s-1vcpu-1gb"
droplet_image  = "ubuntu-24-04-x64"

ssh_key_name         = "terraform-iac-lab"
ssh_public_key_path = "~/.ssh/id_ed25519.pub"
```

Tres formas de entregar el token (prioridad de mayor a menor):

1. `do_token` en `terraform.tfvars` (o cualquier `*.auto.tfvars`).
2. `TF_VAR_do_token` en el entorno: `export TF_VAR_do_token="dop_v1_..."`.
3. `DIGITALOCEAN_TOKEN` o `DIGITALOCEAN_ACCESS_TOKEN` en el entorno, si `do_token` queda en `null`.

Los valores por defecto de `variables.tf` son seguros para una laboratorio: plan `s-1vcpu-1gb`,
imagen `ubuntu-24-04-x64`, región `nyc3`.

### Usar una clave SSH que ya existe

Si no quieres que Terraform suba la clave, comenta `ssh_public_key_path` y define el
fingerprint existente:

```hcl
ssh_key_fingerprint = "aa:bb:cc:dd:ee:ff:00:11:22:33:44:55:66:77:88:99"
```

En ese caso el recurso `digitalocean_ssh_key` se crea con `count = 0` y el Droplet referencia la
clave que ya tenías.

---

## 7. Desplegar el Droplet

El flujo de trabajo de Terraform siempre es el mismo: **init → plan → apply**.

```bash
cd terraform

# 1) Instala providers (descarga digitalocean/digitalocean) y crea .terraform.lock.hcl
terraform init

# 2) Formatea y valida la sintaxis (opcional pero recomendado)
terraform fmt -recursive
terraform validate

# 3) Simula: NO crea nada, solo muestra el plan
terraform plan -out=droplet.tfplan

# 4) Aplica exactamente ese plan
terraform apply droplet.tfplan
```

Salida esperada de `apply`:

```
digitalocean_droplet.web: Creating...
digitalocean_droplet.web: Creation complete after 1m2s
Outputs:

droplet_id       = "32000000"
ipv4_address     = "203.0.113.10"
ssh_command      = "ssh root@203.0.113.10"
```

> `terraform plan` es seguro y gratuito: no llama a la API para crear nada. Úsalo siempre antes
> de un `apply` para ver exactamente qué se va a crear, destruir o cambiar.

### Ver los valores sin desplegar

```bash
terraform output                # todos los outputs
terraform output -raw ipv4_address
```

---

## 8. Comprobar el acceso por SSH

```bash
# Con el output directo
ssh root@$(terraform output -raw ipv4_address)

# O con el comando que expone el output
$(terraform output -raw ssh_command)
```

Comprobaciones dentro del Droplet:

```bash
whoami                 # root
curl -s ifconfig.me     # confirma que la IP publica es la del Droplet
ip -4 addr show        # eth0 con IP publica, ens3/eth1 con IP privada
```

Si `ssh` dice `Permission denied (publickey)`, casi siempre es que la clave pública del Droplet no
es la que tienes en local. Revisa `ssh -v root@<ip>` y el campo `Offering public key`.

---

## 9. Configurar el servidor con Ansible (stretch goal)

Ansible se conecta por SSH a la IP que Terraform acaba de crear.

```bash
# 1) Pega la línea que generó Terraform
cd ..
terraform -chdir=terraform output -raw ansible_inventory_host
# -> web-1 ansible_host=203.0.113.10 ansible_user=root
```

Copia esa línea en `ansible/inventory.ini` (añádela a ambos grupos, `[droplets]` y `[app]`):

```ini
[droplets]
web-1 ansible_host=203.0.113.10 ansible_user=root

[droplets:vars]
ansible_python_interpreter=/usr/bin/python3

[app]
web-1 ansible_host=203.0.113.10 ansible_user=root

[app:vars]
ansible_python_interpreter=/usr/bin/python3
```

Comprueba la conexión antes de cambiar nada:

```bash
cd ansible
ansible-inventory --list
ansible droplets -m ping
```

Ejecuta el playbook (dry-run primero para ver qué haría):

```bash
ansible-playbook site.yml --check --diff
ansible-playbook site.yml
```

Qué hace el playbook:

1. Actualiza la cache de APT e instala `nginx`, `ufw`, `curl`, `unattended-upgrades`, `chrony`.
2. Crea el usuario `admin` con sudo sin contraseña.
3. Endurece SSH: `PasswordAuthentication no`, `PubkeyAuthentication yes`.
4. Abre en el firewall los puertos 22, 80 y 443 y activa UFW.
5. Despliega una página de prueba en `/var/www/html/index.html` y reinicia nginx.

Node.js y npm **no** se instalan aquí: los instala el rol `app` durante el despliegue de la app
(paso 11). Si la app escucha en el puerto 80 y nginx viene instalado del proyecto anterior,
el rol `app` detiene nginx para que la app pueda ocupar el puerto. Si prefieres nginx como
proxy inverso (app en 3000, nginx en 80), pon `app_port: 3000` y configura un `proxy_pass`
en el virtualhost (fuera del alcance de este reto).

### Comprobar el resultado

```bash
curl -s http://203.0.113.10          # en tu máquina
ssh root@203.0.113.10 'ufw status'  # en el servidor
```

### Personalizar el playbook

`ansible/site.yml` usa variables que puedes sobreescribir sin editar el playbook:

```bash
ansible-playbook site.yml -e admin_user=deploy -e upgrade_packages=true
```

---

## 10. La aplicacion Node.js

La app vive en `app/`. Es un servidor Express minimalista con tres rutas:

| Ruta | Descripcion |
|------|-------------|
| `GET /` | Devuelve `Hello, world!` (es el requisito del reto) |
| `GET /healthz` | Healthcheck: `{"status":"ok"}` (lo usa Ansible y el workflow) |
| `GET /info` | Vuela de la compilacion (commit y fecha, `build-info.json`) |

`npm run build` copia `src/` a `dist/` y genera `dist/build-info.json` con el commit y la
fecha de compilacion. `npm run start` lanza `dist/index.js`. Escucha en el puerto `80` por
defecto (se cambia con la variable `PORT`).

Comprobar en local:

```bash
cd app
npm ci        # instala desde package-lock.json (determinista)
npm run build
PORT=3000 npm start
curl localhost:3000/   # Hello, world!
```

Para que `npm ci` funcione en el servidor (via Ansible o GitHub Actions), `package-lock.json`
se versiona.

## 11. Desplegar la app con Ansible (rol `app`)

El playbook `node_service.yml` es el que cumple el reto **Task #1**. Lanza el rol `app`, que
hace exactamente esto:

1. Instala **Node.js + npm** desde NodeSource (si no estan).
2. Crea el usuario `nodeapp` y el directorio `/srv/node-service`.
3. (Opcional) instala la deploy key y la clave publica del runner.
4. **Clona** o actualiza el repositorio en `/srv/node-service/app`.
5. **Instala** las dependencias con `npm ci` (solo dependencias de produccion).
6. **Compila** la app con `npm run build`.
7. **Arranca** la app como servicio systemd `node-service` en el **puerto 80**, reinicia
   automaticamente y habilita el arranque al boot.
8. Ejecuta un **healthcheck** contra `http://127.0.0.1:80/healthz`.

Para poder desplegar, el servidor debe estar creado (paso 7) y el inventario apuntando a la IP
real (paso 9). El playbook usa el grupo `[app]`, que ya esta incluido en `inventory.ini`.

Variables que admite el rol (todas con valor por defecto en `roles/app/defaults/main.yml`):

| Variable | Defecto | Descripcion |
|----------|---------|-------------|
| `app_repo` | `https://github.com/OWNER/REPO.git` | Repositorio a clonar |
| `app_branch` | `main` | Rama a desplegar |
| `app_commit` | *(vacio)* | Si se fija un SHA, desplegara *exactamente* ese commit |
| `app_deploy_key` | *(vacio)* | Deploy key privada para repositorios privados |
| `app_runner_ssh_public_key` | *(vacio)* | Clave publica del runner para `.ssh/authorized_keys` |
| `app_port` | `80` | Puerto del servicio |
| `nodejs_version` | `20.x` | Version de Node.js instalada |

Despliegue manual:

```bash
cd ansible
ansible-playbook node_service.yml --tags app
```

O con variables para un repositorio en concreto:

```bash
ansible-playbook node_service.yml --tags app \
  -e app_repo=git@github.com:tu-usuario/tu-repo.git \
  -e 'app_deploy_key=-----BEGIN OPENSSH PRIVATE KEY-----...'
```

Cuando termine, compruebalo desde tu maquina:

```bash
curl -s http://203.0.113.10/          # Hello, world!
curl -s http://203.0.113.10/healthz   # {"status":"ok"}
```

> El servicio corre con el usuario `nodeapp` (no root) y usa `AmbientCapabilities` para poder
> escuchar en el puerto 80.

## 12. Automatizar el despliegue con GitHub Actions

El reto **Task #2** pide un workflow. Hay dos, para que puedas probar ambas opciones. Ambos
comparten los mismos secrets y hacen lo mismo: en cada push a `main` (o manual), compilan la app
en un runner, la despliegan en el Droplet y verifican que responda.

### Secrets que necesitas crear

Ve a *Settings → Secrets and variables → Actions → New repository secret*:

| Secret | Opcion 1 (Ansible) | Opcion 2 (rsync) | Descripcion |
|--------|:---:|:---:|-------------|
| `SERVER_HOST` | si | si | IP publica del Droplet |
| `SERVER_USER` | si | si | Usuario SSH. `root` en un droplet recien creado |
| `SERVER_SSH_KEY` | si | si | Clave **privada** SSH que puede entrar al Droplet |
| `APP_DEPLOY_KEY` | solo repo privado | - | Deploy key GitHub para que el servidor clone el repo |
| `SERVER_HOST_KEY` | opcional | - | Host key del Droplet (si no, se usa `ssh-keyscan`) |
| `SERVER_FINGERPRINT` | - | opcional | Huella SHA256 del host (evita MITM) |

> **Nunca** pongas la clave privada directamente en el codigo: siempre a traves de secrets. Los
> valores se muestran como `***` en los logs.

### Opcion 1: `deploy-ansible.yml` (con `ansible-playbook`)

El job `build` compila y prueba la app en un runner de GitHub. Solo al llegar a `main`, el job
`deploy`:

1. Instala `ansible-core` y las colecciones.
2. Genera `inventory.ini` a partir de `SERVER_HOST` y `SERVER_USER`.
3. Ejecuta el playbook con la deploy key y el SHA exacto del push:

   ```bash
   ansible-playbook node_service.yml --tags app \
     --extra-vars "app_repo=git@github.com:OWNER/REPO.git" \
     --extra-vars "app_deploy_key=$APP_DEPLOY_KEY" \
     --extra-vars "app_commit=$SHA"
   ```
4. Hace `curl http://$SERVER_HOST/` para verificar el despliegue.

El rol `app` instala Node.js en el servidor, asi que la primera ejecucion prepara todo.

### Opcion 2: `deploy-ssh.yml` (con rsync + SSH)

Sin Ansible en el runner: el codigo se copia al servidor con `rsync` (mediante
[webfactory/ssh-agent](https://github.com/webfactory/ssh-agent) y
[appleboy/ssh-action](https://github.com/appleboy/ssh-action)) y el servicio se reinicia.

1. `web-factory/ssh-agent` carga la clave en el agente SSH del runner. (El proyecto original del
   reto referencia `web-factory/ssh-agent`; ese repositorio ya responde como
   **webfactory/ssh-agent**, que es el que se usa aqui.)
2. `rsync -az --delete` sube solo `app/` a `/tmp/node-service-release/`.
3. `appleboy/ssh-action` ejecuta en el servidor: instala Node.js si falta, copia a
   `/opt/app/`, `npm ci --omit=dev`, `npm run build`, crea la unidad systemd (si no existe) y
   reinicia el servicio.
4. Mismo healthcheck final que en la opcion 1.

Obtener la huella para `SERVER_FINGERPRINT`:

```bash
ssh-keyscan 203.0.113.10 | ssh-keygen -lf -   # copiar el valor SHA256:...
```

### Ver las dos opciones en accion

```bash
# 1) sube el codigo a GitHub
git push origin main

# 2) abre el repositorio -> Actions -> Deploy (Ansible) / Deploy (SSH+rsync)
```

Cualquier cambio en `app/` dispara ambos workflows; basta con que uno de los dos tenga los
secrets completos para que el despliegue funcione.

---

## 13. Destruir la infraestructura

Cuando termines, **destruye el Droplet para no seguir pagando**:

```bash
cd terraform
terraform plan -destroy        # confirma qué se va a borrar
terraform destroy
```

`destroy` usa el estado para encontrar el Droplet y apagarlo. Si borras `terraform.tfstate` a mano,
Terraform "olvida" el Droplet y te cobrará la instancia hasta que la elimines a mano desde el
panel de DigitalOcean.

### Rotar o eliminar la clave SSH

```bash
terraform state list                                  # ver recursos
terraform apply -replace=digitalocean_ssh_key.this    # forzar recreacion
```

---

## 14. Publicar la solución en la comunidad

Este proyecto forma parte de un reto comunitario: la idea es que otras personas ejecuten tu código
y te den feedback.

1. **Fork** del repositorio del reto desde tu cuenta de GitHub.
2. Clona tu fork y crea una rama con tu trabajo:
   ```bash
   git clone git@github.com:<tu-usuario>/<repo>.git
   cd <repo>
   git checkout -b mi-solucion-terraform-ansible
   ```
3. Commitea **sin secretos**. Antes de hacerlo, comprueba que no se cuelgan nada:
   ```bash
   git status
   git diff --cached
   grep -r "dop_v1_" . --exclude-dir=.git    # no debe salir nada
   ```
4. Sube la rama y abre un **Pull Request** contra el repositorio original.
5. En la descripción del PR cuenta brevemente: qué creaste, qué aprendiste y qué problemas
   encontraste. Responde al feedback que recibas.

---

## 15. Buenas prácticas

- **El estado es sacred:** versiona el código, nunca edites el `.tfstate` a mano.
- **Nada de secretos en git:** tokens solo en `terraform.tfvars`, variables de entorno o un
  secret manager. Ya están en `.gitignore`.
- **Empieza siempre por `plan`:** leer el plan es la mejor forma de detectar un `destroy`
  accidental.
- **Idempotencia:** tanto Terraform como Ansible deben poder repetirse sin efectos raros. Por eso
  el playbook usa módulos (no `shell`) y el recurso droplet no se recrea en cada `apply`.
- **Versiona el lock file:** `.terraform.lock.hcl` (que sí se versiona) fija las versiones de los
  providers para que todos ejecuten el mismo código.
- **`terraform fmt` y `validate` en el CI** antes de cualquier `apply`.
- **Tags y backups** activados (`droplet_tags`, `droplet_backups`) para saber qué es qué en el
  panel y poder recuperar una instancia.

---

## 16. Solución de problemas

| Síntoma | Causa probable | Solución |
|---------|----------------|----------|
| `Error: Invalid access token` | token mal copiado, expirado o de solo lectura | Regenera el token con scope **Read & Write** en el panel |
| `digitalocean_ssh_key`: `public key is required` | `ssh_public_key_path` apunta a un archivo inexistente o a la **privada** | Usa `~/.ssh/id_ed25519.pub` o define `ssh_key_fingerprint` con una clave ya existente |
| `Error: 404 image not found` | slug de imagen inexistente | `doctl compute image list-distribution` y copia el slug exacto |
| `Error: size ... is not available in region` | plan no disponible en esa región | Cambia `droplet_region` o `droplet_size` |
| `Permission denied (publickey)` | la clave local no coincide con la del Droplet | `ssh -v root@<ip>` y revisa `Offering public key` |
| `ansible: UNREACHABLE` | IP/host/user mal en el inventario o UFW cortando el 22 | `ansible droplets -m ping`, y abre el 22 **después** de aplicar |
| `terraform apply` pide el valor de `do_token` | variable sin valor | Exporta `TF_VAR_do_token` o rellena `terraform.tfvars` |

---

## Anexo A: la misma IaC contra AWS local con Floci

> Este anexo es **opcional**: el requisito del reto es DigitalOcean. Pero sirve para practicar
> Terraform + Ansible contra la API de AWS **sin cuenta y sin gastar un céntimo**, y para entender
> cómo cambia una misma IaC al cambiar de proveedor.

### A.0 Qué es Floci y qué puede y qué no puede hacer

[Floci](https://floci.io) es un emulador local de servicios de AWS (compatible con el formato de
endpoints de LocalStack). Levanta un endpoint único en `http://localhost:4566` y guarda el estado
en un directorio local, así que todo lo que crees ahí desaparece con `docker compose down -v`.

| | DigitalOcean (este repo) | Floci (este anexo) |
|---|---|---|
| Coste | Se paga mientras el Droplet exista | Gratis, 100 % local |
| Provider de Terraform | `digitalocean/digitalocean` | `hashicorp/aws` con endpoints custom |
| Autenticación | `DIGITALOCEAN_TOKEN` real | Credenciales falsas (`test`/`test`) |
| Ansible por SSH | Sí, Droplet real con Ubuntu | **No en modo mock**: emulación sin sistema operativo |
| `terraform destroy` | Apaga y borra la máquina | Borra el estado emulado |

Punto clave: el provider `digitalocean` **solo** habla con la API de DigitalOcean, así que este
Droplet no se puede desplegar en Floci. Lo que se replica en Floci es la **misma metodología**
(provider → variables → plan → apply → destroy) con recursos `aws_*`.

### A.1 Levantar Floci

Necesitas Docker y Docker Compose. Ya tienes el `docker-compose.yml` listo en `floci/`:

```bash
cd floci
docker compose up -d
docker compose logs -f floci     # sigue el arranque
```

Qué hace el compose de este repo:

- publica `4566` (todas las llamadas a la API de AWS),
- publica `2200-2299` (rango de puertos SSH de las instancias EC2 emuladas),
- publica `9169` (Instance Metadata Service, IMDS),
- monta `./data` (persistencia local) y `/var/run/docker.sock` (para los servicios que sí corren
  en contenedores reales: Lambda, RDS, ElastiCache...).

Comprueba que responde:

```bash
export AWS_ENDPOINT_URL=http://localhost:4566
aws sts get-caller-identity --endpoint-url $AWS_ENDPOINT_URL
```

### A.2 Terraform contra Floci

```bash
cd ../terraform-floci

terraform init          # descarga hashicorp/aws
terraform fmt -check
terraform validate
terraform plan -out=floci.tfplan
terraform apply floci.tfplan
```

`terraform-floci/provider.tf` es la pieza clave. Los emuladores no implementan la verificación
real de credenciales ni el IMDS de AWS, así que hay que desactivarlas:

```hcl
provider "aws" {
  region     = "us-east-1"
  access_key = "test"
  secret_key = "test"

  skip_credentials_validation = true   # no hay STS real contra el emulador
  skip_metadata_api_check     = true   # no consultes el IMDS de mi máquina
  skip_requesting_account_id  = true   # no hace falta un account id real
  s3_use_path_style           = true   # S3 con path-style, no virtual-host

  endpoints {                          # cada servicio usado necesita su endpoint
    dynamodb = "http://localhost:4566"
    ec2      = "http://localhost:4566"
    iam      = "http://localhost:4566"
    s3       = "http://localhost:4566"
    sqs      = "http://localhost:4566"
    ssm      = "http://localhost:4566"
    sts      = "http://localhost:4566"
  }
}
```

> **El endpoint se declara servicio a servicio**: si añades un recurso y olvidas su `endpoints`,
> Terraform intentará hablar con la API real de AWS y fallará. Alternativa equivalente:
> `export AWS_ENDPOINT_URL=http://localhost:4566` (o `AWS_ENDPOINT_URL_S3`, etc.).

Qué crea `terraform-floci/main.tf`: un bucket S3 con bloqueo de acceso público, una cola SQS, una
tabla DynamoDB (`PAY_PER_REQUEST`), un parámetro de SSM, un rol IAM con una política adjunta y,
opcionalmente, una instancia EC2.

### A.3 Verificar y limpiar

```bash
# Ver los recursos emulados con el AWS CLI
aws --endpoint-url $AWS_ENDPOINT_URL s3api head-bucket --bucket floci-terraform-example
aws --endpoint-url $AWS_ENDPOINT_URL sqs list-queues
aws --endpoint-url $AWS_ENDPOINT_URL dynamodb list-tables
aws --endpoint-url $AWS_ENDPOINT_URL ssm get-parameter --name /floci/environment

# Lo mismo desde Terraform
terraform output

# Limpiar
terraform destroy
cd ../floci && docker compose down -v
```

### A.4 Estado remoto emulado (S3 backend + lock en DynamoDB)

Con backend local el estado vive en tu disco. Para practicar el flujo real de equipo
(estado compartido + bloqueo), Floci también emula el backend S3 con lock en DynamoDB:

```hcl
terraform {
  backend "s3" {
    bucket                      = "tfstate"
    key                         = "terraform.tfstate"
    region                      = "us-east-1"
    endpoint                    = "http://localhost:4566"
    dynamodb_endpoint           = "http://localhost:4566"
    dynamodb_table              = "tflock"
    access_key                  = "test"
    secret_key                  = "test"
    skip_credentials_validation = true
    skip_region_validation      = true
    use_path_style              = true
  }
}
```

Los recursos del backend se crean **antes** del `init`:

```bash
aws --endpoint-url $AWS_ENDPOINT_URL s3api create-bucket --bucket tfstate
aws --endpoint-url $AWS_ENDPOINT_URL dynamodb create-table \
  --table-name tflock \
  --attribute-definitions AttributeName=LockID,AttributeType=S \
  --key-schema AttributeName=LockID,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST

terraform init   # ahora migrará el estado local al bucket emulado
```

Advertencia útil: el estado **sigue siendo el estado de tu infraestructura emulada**, no de AWS
real. No confundas `terraform destroy` sobre Floci con borrar algo en producción.

### A.5 EC2 en Floci: mock vs. Docker

`main.tf` incluye la instancia EC2, pero desactivada por defecto:

```bash
# 1) Descubre los AMI del catálogo emulado
aws --endpoint-url $AWS_ENDPOINT_URL ec2 describe-images \
  --query 'Images[].[ImageId,Name]' --output table

# 2) Aplica con la instancia activada
terraform apply -var create_instance=true -var instance_ami=ami-xxxxxxxx
```

Dos modos, controlables por variable de entorno:

| Modo | Variable | Qué hace | ¿Ansible por SSH? |
|------|----------|----------|--------------------|
| Mock | `FLOCI_SERVICES_EC2_MOCK=true` | Registra la instancia en el estado, **no lanza contenedores** | No: no hay sistema operativo |
| Docker | `FLOCI_SERVICES_EC2_MOCK=false` (por defecto) | Levanta un contenedor por instancia y publica sus puertos | Solo si el catálogo arranca `sshd` y la clave es válida |

```bash
cd floci
FLOCI_EC2_MOCK=true docker compose up -d      # modo CI, instantáneo y sin Docker anidado
docker compose logs floci | grep "Published EC2"
# Published EC2 instance i-0abc... app port 22 on host port 2200 (socat -> 172.17.0.3:22)
```

En modo Docker, Floci publica el puerto SSH de cada instancia en el host dentro del rango
2200-2299 usando sidecars de `socat`: es la forma de alcanzar "la instancia" desde tu máquina.
El userland es el de la imagen del catálogo de Floci, no el de un Ubuntu completo de AWS, así que
**no esperes un `apt` disponible ni un Droplet equivalente**.

### A.6 Ansible en el mundo Floci

Aquí conviene ser honesto sobre los límites de la emulación: **Floci emula APIs, no máquinas
Linux**. Por eso hay tres formas de practicar la parte de Ansible, de más útil a menos:

1. **La real (recomendada):** el playbook de este repo, `ansible/site.yml`, contra el Droplet del
   paso 9. Es el flujo del enunciado: Terraform crea la máquina y Ansible la configura.
2. **Con una VM local:** levanta una VM (Vagrant, Multipass, libvirt, Docker) y apunta el
   inventario a ella. El mismo `site.yml` funciona tal cual, sin tocar el código del playbook:

   ```ini
   [droplets]
   web-1 ansible_host=192.168.56.10 ansible_user=ubuntu
   ```

   ```bash
   cd ansible && ansible-playbook site.yml
   ```

3. **Sin máquina, para iterar la lógica del playbook:** `--check` contra `localhost`, que valida
   sintaxis, variables y permisos sin tocar nada. Es el equivalente local de lo que hace el modo
   mock en Floci para Terraform:

   ```bash
   cd ansible
   ansible-playbook site.yml --check --diff \
     -i 'localhost,' -c local -e admin_user=admin
   ```

   Ansible contra la API emulada (crear el bucket, subir un `index.html` con `s3_sync` o
   `amazon.aws.s3`) es posible, pero ya no es "configurar un servidor": es un playbook de
   gestión de recursos. Trátalo como un ejercicio aparte, no como el stretch goal del reto.

Resumen: **Terraform → Floci es totalmente soportado y recomendado; Ansible → Floci solo de
forma indirecta**, porque necesita un sistema operativo detrás.

### A.7 Volver al laboratorio de DigitalOcean

Los dos worlds son independientes (carpetas y estados separados). Cuando termines Floci:

```bash
cd floci && docker compose down -v     # borra la emulación y su estado
```

y el laboratorio de DigitalOcean sigue intacto en `terraform/` y `ansible/`.

---

## Anexo B: comandos de referencia

```bash
# Terraform
terraform init                      # inicializa (descarga providers)
terraform fmt -check -recursive     # comprueba formato
terraform validate                  # valida la configuracion
terraform plan                      # simula
terraform apply                     # crea/actualiza
terraform destroy                   # destruye
terraform output -json              # outputs en JSON
terraform show                      # estado en texto legible

# DigitalOcean
doctl compute droplet list
doctl compute droplet get <id>
doctl account balance --output json

# Ansible
ansible-inventory --graph
ansible droplets -m ping -vvv
ansible-playbook site.yml --check --diff
ansible-playbook site.yml --syntax-check

# Floci / AWS local
docker compose -f floci/docker-compose.yml up -d        # levanta el emulador
docker compose -f floci/docker-compose.yml logs -f       # sigue el arranque
docker compose -f floci/docker-compose.yml down -v      # apaga y borra el estado
aws --endpoint-url $AWS_ENDPOINT_URL s3 ls
aws --endpoint-url $AWS_ENDPOINT_URL ec2 describe-instances
aws --endpoint-url $AWS_ENDPOINT_URL ec2 describe-images
```
