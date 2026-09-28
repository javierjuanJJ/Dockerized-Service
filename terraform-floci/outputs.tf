output "s3_bucket" {
  description = "Bucket S3 emulado en Floci."
  value       = aws_s3_bucket.app.id
}

output "s3_bucket_arn" {
  description = "ARN del bucket S3 emulado."
  value       = aws_s3_bucket.app.arn
}

output "sqs_queue_url" {
  description = "URL de la cola SQS emulada."
  value       = aws_sqs_queue.jobs.url
}

output "dynamodb_table" {
  description = "Tabla DynamoDB emulada."
  value       = aws_dynamodb_table.items.name
}

output "ssm_parameter" {
  description = "Parametro SSM emulado."
  value       = aws_ssm_parameter.environment.name
}

output "iam_role_arn" {
  description = "ARN del rol IAM emulado."
  value       = aws_iam_role.app.arn
}

output "instance_public_ip" {
  description = "IP publica de la instancia EC2 emulada (vacio si create_instance = false)."
  value       = var.create_instance ? aws_instance.web[0].public_ip : null
}

output "floci_endpoint" {
  description = "Endpoint local de Floci."
  value       = "http://localhost:4566"
}
