terraform {
  required_version = ">= 1.5.0"

  required_providers {
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = "~> 2.30"
    }
    helm = {
      source  = "hashicorp/helm"
      version = "~> 2.13"
    }
  }
}

provider "kubernetes" {
  config_path = var.kubeconfig_path
}

provider "helm" {
  kubernetes {
    config_path = var.kubeconfig_path
  }
}

resource "kubernetes_namespace" "ipacx" {
  metadata {
    name = var.namespace
  }
}

resource "helm_release" "ipacx_ris" {
  name       = "ipacx-ris"
  namespace  = kubernetes_namespace.ipacx.metadata[0].name
  chart      = "${path.module}/../helm/ipacx-ris"
  wait       = true
  timeout    = 600

  set {
    name  = "backend.image"
    value = var.backend_image
  }

  set {
    name  = "frontend.image"
    value = var.frontend_image
  }
}
