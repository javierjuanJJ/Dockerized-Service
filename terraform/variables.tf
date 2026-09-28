variable "do_token" {
  description = "Token de la API de DigitalOcean. Si es null se usa la variable de entorno DIGITALOCEAN_TOKEN."
  type        = string
  sensitive   = true
  default     = null
}

variable "droplet_name" {
  description = "Nombre del Droplet."
  type        = string
  default     = "web-1"
}

variable "droplet_region" {
  description = "Slug de la region donde se crea el Droplet (doctl compute region list)."
  type        = string
  default     = "nyc3"
}

variable "droplet_size" {
  description = "Slug del plan del Droplet (doctl compute size list)."
  type        = string
  default     = "s-1vcpu-1gb"
}

variable "droplet_image" {
  description = "Slug de la imagen del sistema operativo (doctl compute image list-distribution)."
  type        = string
  default     = "ubuntu-24-04-x64"
}

variable "droplet_tags" {
  description = "Etiquetas aplicadas al Droplet."
  type        = list(string)
  default     = ["terraform", "iac", "devops-labs"]
}

variable "droplet_ipv6" {
  description = "Habilita IPv6 en el Droplet."
  type        = bool
  default     = true
}

variable "droplet_monitoring" {
  description = "Instala el agente de monitoreo de DigitalOcean."
  type        = bool
  default     = false
}

variable "droplet_backups" {
  description = "Habilita backups automaticos semanales."
  type        = bool
  default     = false
}

variable "ssh_key_name" {
  description = "Nombre con el que se registra la clave SSH en DigitalOcean (si no se indica fingerprint)."
  type        = string
  default     = "terraform-iac-lab"
}

variable "ssh_public_key_path" {
  description = "Ruta local a la clave publica que se sube a DigitalOcean. Admite rutas relativas a ~."
  type        = string
  default     = "~/.ssh/id_ed25519.pub"
}

variable "ssh_key_fingerprint" {
  description = "Fingerprint o ID de una clave SSH ya existente en DigitalOcean. Si es null se sube la clave local."
  type        = string
  default     = null
}
