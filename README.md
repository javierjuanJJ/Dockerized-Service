# IaC en DigitalOcean con Terraform y Ansible

Proyecto práctico de **Infraestructura como Código (IaC)**: crear un Droplet en DigitalOcean con
Terraform y configurarlo con un playbook de Ansible.

- **Requisito principal:** escribir código Terraform que cree un Droplet en DigitalOcean con IP
  pública y acceso por SSH usando una clave privada.
- **Stretch goal:** playbook de Ansible que configure ese servidor.

> Recordatorio: DigitalOcean cobra por Droplet activo. Cuando termines la práctica, ejecuta
> `terraform destroy` (paso 10) para dejar de pagar.

---

## 0. Prerrequisitos

| Herramienta | Versión mínima | Para qué la usamos |
|-------------|----------------|--------------------|
| Terraform   | >= 1.5         | Crear el Droplet   |
| Ansible     | ansible-core 2.14+ | Configurar el servidor |
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
├── terraform/
│   ├── main.tf                     # provider + ssh key + droplet
│   ├── variables.tf                # variables de entrada
│   ├── outputs.tf                  # IP, comando ssh, línea de inventario
│   └── terraform.tfvars.example    # plantilla de valores
├── ansible/
│   ├── ansible.cfg
│   ├── inventory.ini
│   ├── requirements.yml
│   └── site.yml                    # playbook de configuración
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

Copia esa línea en `ansible/inventory.ini`:

```ini
[droplets]
web-1 ansible_host=203.0.113.10 ansible_user=root

[droplets:vars]
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

## 10. Destruir la infraestructura

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

## 11. Publicar la solución en la comunidad

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

## 12. Buenas prácticas

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

## 13. Solución de problemas

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

## Anexo A: ¿Y en AWS o con Floci?

El enunciado menciona que la servidor Linux previo puede vivir en AWS u otro proveedor, pero el
requisito de este proyecto es **DigitalOcean**: el provider `digitalocean` habla únicamente con la
API de DigitalOcean, así que no se puede desplegar este Droplet en AWS.

- **AWS:** el mismo HCL con `aws_instance` sigue el mismo flujo (`init`/`plan`/`apply`) cambiando
  el provider, el recurso y las credenciales (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`,
  región). La estructura del proyecto, el versionado y el flujo de trabajo son idénticos.
- **Floci** (<https://floci.io>) es un emulador local de servicios de AWS, compatible con el
  formato de endpoints de LocalStack. Sirve para practicar Terraform contra una emulación de AWS
  **sin gastar crédito y sin salir de tu máquina**, pero **no emula la API de DigitalOcean**, así
  que no sirve para este proyecto:

  ```bash
  mkdir floci && cd floci
  cat > compose.yaml <<'EOF'
  services:
    floci:
      image: floci/floci:latest
      ports:
        - "4566:4566"
      volumes:
        - ./data:/app/data
  EOF
  docker compose up -d

  export AWS_ENDPOINT_URL=http://localhost:4566
  aws sts get-caller-identity --endpoint-url $AWS_ENDPOINT_URL
  ```

  Con `AWS_ENDPOINT_URL` apuntando a Floci, los recursos de AWS del provider `aws` se crean
  contra el emulador local, y ahí sí puedes practicar recursos tipo `aws_s3_bucket`.

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
```
