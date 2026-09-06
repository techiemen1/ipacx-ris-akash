variable "kubeconfig_path" {
  description = "Path to the kubeconfig used for deployment."
  type        = string
  default     = "~/.kube/config"
}

variable "namespace" {
  description = "Kubernetes namespace for iPACX RIS."
  type        = string
  default     = "ipacx-ris"
}

variable "backend_image" {
  description = "Backend container image."
  type        = string
  default     = "ipacx/backend:latest"
}

variable "frontend_image" {
  description = "Frontend container image."
  type        = string
  default     = "ipacx/frontend:latest"
}
