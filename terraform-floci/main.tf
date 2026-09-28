resource "aws_s3_bucket" "app" {
  bucket = var.bucket_name
}

resource "aws_s3_bucket_public_access_block" "app" {
  bucket                  = aws_s3_bucket.app.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_sqs_queue" "jobs" {
  name = var.queue_name
}

resource "aws_dynamodb_table" "items" {
  name         = var.table_name
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "id"

  attribute {
    name = "id"
    type = "S"
  }
}

resource "aws_ssm_parameter" "environment" {
  name  = "/floci/environment"
  type  = "String"
  value = "local"
}

resource "aws_iam_role" "app" {
  name = var.iam_role_name

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Service = "ec2.amazonaws.com"
        }
        Action = "sts:AssumeRole"
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "s3_read" {
  role       = aws_iam_role.app.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonS3ReadOnlyAccess"
}

resource "aws_instance" "web" {
  count = var.create_instance ? 1 : 0

  ami                         = var.instance_ami
  instance_type               = var.instance_type
  iam_instance_profile        = aws_iam_role.app.name
  associate_public_ip_address = true
  tags = {
    Name = "floci-web"
  }
}
