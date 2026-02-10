-- Schema for DBOS workflow state (separate from app data)
CREATE SCHEMA IF NOT EXISTS dbos;

-- Enable pgvector for vector similarity search (must run BEFORE table creation)
CREATE EXTENSION IF NOT EXISTS vector;

-- Enable UUID generation functions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
