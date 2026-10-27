output "vpc_id" {
  value = aws_vpc.main.id
}

output "alb_dns_name" {
  value = aws_lb.alb.dns_name
}

output "docs_bucket" {
  value = aws_s3_bucket.docs.bucket
}

output "backend_ecr_url" {
  value = aws_ecr_repository.backend.repository_url
}
