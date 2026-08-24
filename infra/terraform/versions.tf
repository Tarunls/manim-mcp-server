terraform {
  required_version = ">= 1.7.0"
  backend "gcs" {
    bucket = "educationalvideo-506219-lesson-studio-tfstate"
    prefix = "staging"
  }
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}
