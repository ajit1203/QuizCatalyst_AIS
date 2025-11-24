import streamlit as st
from prometheus_client import start_http_server, Counter, Gauge, Summary, Histogram

RESPONSE_COUNTER = Counter(
    'llm_responses_total', 
    'Total number of responses generated', 
    ['mode'] 
)


FEEDBACK_COUNTER = Counter(
    'user_feedback_total', 
    'Total user feedback received', 
    ['type'] 
)

LENGTH_GAUGE = Gauge(
    'response_length_chars', 
    'Length of the generated response in characters'
)

LATENCY_SUMMARY = Summary(
    'request_processing_seconds', 
    'Time spent generating response'
)

RETRIEVAL_LATENCY = Summary(
    'rag_retrieval_seconds', 
    'Time spent retrieving documents from Vector DB'
)


SIMILARITY_SCORE = Histogram(
    'rag_similarity_score', 
    'Distribution of vector distances (lower is better for L2)', 
    buckets=[0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 1.5]
)

RETRIEVAL_ATTEMPTS = Counter(
    'rag_retrieval_attempts_total', 
    'Total number of RAG retrieval attempts'
)
RETRIEVAL_HITS = Counter(
    'rag_context_hits_total', 
    'Number of retrievals that returned non-empty context'
)

INDEX_SIZE = Gauge(
    'rag_index_size_bytes', 
    'Approximate size of the knowledge base content in bytes'
)
INDEX_FRESHNESS = Gauge(
    'rag_index_last_updated_timestamp', 
    'Unix timestamp of the last successful ingestion'
)

DATA_DRIFT = Gauge(
    'rag_data_drift_score', 
    'Estimated drift score of the corpus'
)

DOCS_INDEXED = Counter(
    'ingestion_docs_total', 
    'Total number of documents successfully indexed'
)

UPLOAD_ERRORS = Counter(
    'ingestion_errors_total', 
    'Total number of file upload/processing failures'
)

LARGE_FILES = Counter(
    'ingestion_large_files_total', 
    'Number of uploaded files exceeding 10MB'
)

@st.cache_resource
def start_metrics_server(port=8000):
    """
    Starts the Prometheus metrics server on port 8000.
    Uses st.cache_resource to ensure it only starts ONCE.
    """
    try:
        start_http_server(port)
        print(f"✅ Metrics server started on port {port}")
    except OSError:
        print(f"⚠️ Metrics server already running on port {port}")