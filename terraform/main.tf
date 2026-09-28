terraform {
  required_version = ">= 1.5"

  required_providers {
    digitalocean = {
      source  = "digitalocean/digitalocean"
      version = "~> 2.0"
    }
  }

  backend "local" {
    path = "terraform.tfstate"
  }
}

provider "digitalocean" {
  token = var.do_token
}

resource "digitalocean_ssh_key" "this" {
  count = var.ssh_key_fingerprint == null ? 1 : 0

  name       = var.ssh_key_name
  public_key = try(file(pathexpand(var.ssh_public_key_path)), "")
}

locals {
  use_existing_ssh_key = var.ssh_key_fingerprint != null

  droplet_ssh_keys = local.use_existing_ssh_key ? [var.ssh_key_fingerprint] : [digitalocean_ssh_key.this[0].id]
}

resource "digitalocean_droplet" "web" {
  name       = var.droplet_name
  region     = var.droplet_region
  size       = var.droplet_size
  image      = var.droplet_image
  ssh_keys   = local.droplet_ssh_keys
  tags       = var.droplet_tags
  ipv6       = var.droplet_ipv6
  monitoring = var.droplet_monitoring
  backups    = var.droplet_backups

  lifecycle {
    create_before_destroy = true
  }
}
