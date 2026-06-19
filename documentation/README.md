# 🎓 QuizCatalyst: AI-Powered Personalized Tutor

## 1. Project Title and Overview
**QuizCatalyst** is an advanced, personalized AI tutoring system designed to transform static educational materials into interactive learning experiences. By leveraging Retrieval-Augmented Generation (RAG) and Large Language Models (LLMs), the system allows users to upload PDF textbooks or notes and engage in Socratic dialogue, receive automated study guides, and track their learning progress.

**Key Features:**
* **RAG-based Q&A:** Context-aware answers based on uploaded PDFs.
* **Socratic Mode:** The AI asks guiding questions rather than just providing answers.
* **Automated Study Guides:** Generates summaries and Q&A pairs from document chunks.
* **Risk Management:** Includes pipelines for PII redaction, toxicity screening, and bias auditing.
* **Performance Monitoring:** Real-time metrics via Prometheus and Grafana.

**Project Folder Structure:**
```text
├── deployment/
│   ├── Dockerfile
├── documentation/
│   ├── AI System project proposal/
│   │   └── AI Systems Project Proposal.pdf
│   └── README.md
├── monitoring/
│   ├── logs/
│   └── prometheus/
│       └── prometheus.yml
├── risk_management/
│   ├── data_bias_audit.py
│   ├── license_provenance_log.py
│   ├── pii_redact.py
│   └── toxicity_screen.py
├── src/
│   ├── config.py
│   ├── data/
│   │   ├── chroma_db/
│   │   └── uploads/
│   ├── main.py
│   ├── models/
│   │   ├── embeddings/
│   │   ├── embeddings.py
│   │   ├── llm_handler.py
│   │   ├── pdf_generator.py
│   │   └── quizcatalyst-dolly-adapter/
│   │   └── mistral-7b.gguf (model to be downloaded by the user)
│   ├── rag/
│   │   ├── document_processor.py
│   │   ├── retriever.py
│   │   └── vector_store.py
│   ├── requirements.txt
│   ├── training/
│   │   ├── finetune_data/
│   │   ├── finetune.py
│   │   └── process_data.py
│   ├── utils/
│   │   ├── auth.py
│   │   ├── data/
│   │   │   ├── feedback.csv
│   │   │   └── users.db
│   │   ├── database.py
│   │   ├── feedback_ui.py
│   │   ├── helpers.py
│   │   └── monitoring.py
│   └── videos/
│       └── system_demo.mp4
├──docker-compose.yml
```
---

## 2. Repository Contents

| Directory | Description |
| :--- | :--- |
| **`src/`** | Core application source code. Includes `main.py` (entry point), `models/` (LLM logic), `config.py`, `data/` (contains sample uploads), `rag/` (document processing), `training/` (processed data and fine-tuning codes), and `utils/` (authentication, database, and monitoring helpers). |
| **`deployment/`** | Containerization configurations including `Dockerfile` for orchestration. |
| **`monitoring/`** | Configuration for system observability. Contains `prometheus/prometheus.yml` and log directories. |
| **`risk_management/`** | Safety and compliance scripts: `data_bias_audit.py`, `pii_redact.py`, `license_provenance_log.py`and `toxicity_screen.py`. |
| **`training/`** | Scripts for dataset preparation (`process_data.py`) and fine-tuning the Mistral model (`finetune.py`). |
| **`documentation/`** | Project deliverables, including the AI System Project Proposal and reports. |
| **`videos/`** | Demonstration assets, including `system_demo.mp4`. |

---

## 3. System Entry Point

The main entry point for the application is **`src/main.py`**.

### 3.1 Prerequisites
* Python 3.10+
* NVIDIA GPU (Recommended for local LLM inference) with CUDA 12.x.
* See `src/requirements.txt` for Python dependencies.
### Model Setup
Before running the application, you must download the quantized Mistral model to the `src/models` directory.
1. **Install the Hugging Face Hub CLI:**
   ```bash
   pip install huggingface-hub
2. **Download the Model:**
   ```bash
   huggingface-cli download TheBloke/Mistral-7B-Instruct-v0.2-GGUF mistral-7b-instruct-v0.2.Q4_K_M.gguf --local-dir .\src\models --local-dir-use-symlinks False

### 3.2 Running Locally
1.  **Install Dependencies:**
    ```bash
    pip install -r src/requirements.txt
    ```
2.  **Launch the App:**
    ```bash
    streamlit run src/main.py
    ```
    The application will start on `http://localhost:8501`.
    
### 3.3 Containerized Environment (Docker)
The system is fully containerized using Docker and Docker Compose to orchestrate the App, Prometheus, and Grafana.

**Build and Run:**
```bash
docker-compose up --build
```

---

## 4. Video Demonstration

A comprehensive demonstration of the system is available in the repository:
* 🎥 **Video File:** `videos/system_demo.mp4`.

**Demo Highlights:**
* User Authentication (Login/Signup).
* PDF Upload & Vector Indexing.
* Interactive RAG Chat & Study Guide Generation.
* Real-time Metrics Visualization (Grafana).

---

## 5. Deployment Strategy

The system is designed for containerized deployment using **Docker** and **Docker Compose**, ensuring consistency across environments.

### 5.1 Architecture
The stack consists of three orchestrated services:
1.  **`quizcatalyst`**: The Streamlit application running on a custom image built from `nvidia/cuda:12.4.1-cudnn-devel-ubuntu22.04`.
2.  **`prometheus`**: Scrapes metrics from the application every 5 seconds.
3.  **`grafana`**: Visualizes the metrics on port 3000.

### 5.2 Deployment Command
* **Initial Build / Dependency Updates:**
    Run this when you first start the project or if you have modified `Dockerfile` or `requirements.txt`.
    ```bash
    docker compose up --build
    ```

* **Restarting Services:**
    Run this to apply changes made to the application code (Python files) without rebuilding the entire container.
    ```bash
    docker compose restart
    ```

* **Starting Existing Containers:**
    Run this to start the application if the containers are already built and stopped.
    ```bash
    docker compose up
    ```

* **Global Hosting (Optional):**
    To expose the local Streamlit application to the internet (e.g., for demos):
    ```bash
    ngrok http 8501
    ```

* **App URL:** `http://localhost:8501`
* **Metrics Endpoint:** `http://localhost:8000`
* **Grafana Dashboard:** `http://localhost:3000`

#### Refer to `deployment/Dockerfile` for more details.

## 6. Monitoring and Metrics
The system implements a robust observability pipeline using `prometheus_client`. Metrics are exposed on port `8000` and visualized in Grafana.

### Key Metrics Monitored (`src/monitoring.py`):
* **LLM Performance:**
    * `llm_responses_total`: Counter for total AI responses generated.
    * `request_processing_seconds`: Summary of generation latency.
    * `response_length_chars`: Gauge for output verbosity.
* **RAG Efficiency:**
    * `rag_retrieval_seconds`: Latency for vector DB lookups.
    * `rag_similarity_score`: Histogram of cosine similarity scores (monitoring relevance).
    * `rag_context_hits_total`: Tracks successful knowledge retrieval.
* **System Health:**
    * `ingestion_errors_total`: Tracks failed file uploads.
    * `ingestion_large_files_total`: Alerts on files >10MB.
* **User Feedback:**
    * `user_feedback_total`: Tracks Thumbs Up/Down interactions.

## 7. Project Documentation
* **Project Proposal:** `documentation/AI System project proposal/AI Systems Project Proposal.pdf`.
