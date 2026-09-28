variable "bucket_name" {
  description = "Nombre del bucket S3 emulado."
  type        = string
  default     = "floci-terraform-example"
}

variable "queue_name" {
  description = "Nombre de la cola SQS emulada."
  type        = string
  default     = "floci-terraform-jobs"
}

variable "table_name" {
  description = "Nombre de la tabla DynamoDB emulada."
  type        = string
  default     = "floci-terraform-items"
}

variable "iam_role_name" {
  description = "Nombre del rol IAM emulado."
  type        = string
  default     = "floci-terraform-app"
}

variable "create_instance" {
  description = "Crea una instancia EC2 emulada. Requiere que Floci tenga el servicio EC2 con IMIs en su catalogo."
  type        = bool
  default     = false
}

variable "instance_ami" {
  description = "AMI del catalogo emulado de Floci. Lista las disponibles con: aws --endpoint-url http://localhost:4566 ec2 describe-images"
  type        = string
  default     = "ami-00000000000000000"
}

variable "instance_type" {
  description = "Tipo de instancia emulado."
  type        = string
  default     = "t3.micro"
}
