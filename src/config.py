import os
from pathlib import Path

# Paths
SRC_DIR = Path(__file__).parent.resolve()
DATA_DIR = SRC_DIR / "data"
MODELS_DIR = SRC_DIR / "models"
VECTOR_DB_DIR = DATA_DIR / "chroma_db"
UPLOADS_DIR = DATA_DIR / "uploads"
LOGS_DIR = Path("/app/monitoring/logs")

# Create dirs
DATA_DIR.mkdir(parents=True, exist_ok=True)
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)


MODEL_ID = "/app/src/models/mistral-7b.gguf" 

EMBEDDING_MODEL = "sentence-transformers/all-MiniLM-L6-v2"
EMBEDDING_CACHE = MODELS_DIR / "embeddings"
VECTOR_DB_NAME = "quiz_catalyst"

# Parameters
MAX_NEW_TOKENS = 1024
TEMPERATURE = 0.7
TOP_P = 0.95
CHUNK_SIZE = 1000
CHUNK_OVERLAP = 200
TOP_K_RETRIEVAL = 3