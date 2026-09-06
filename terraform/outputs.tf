output "namespace" {
  value = kubernetes_namespace.ipacx.metadata[0].name
}

output "release_name" {
  value = helm_release.ipacx_ris.name
}
