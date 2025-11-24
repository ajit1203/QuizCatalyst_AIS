# 1. Base Image (Cached)
FROM nvidia/cuda:12.4.1-cudnn-devel-ubuntu22.04

WORKDIR /app

# 2. Install Tools (Cached)
RUN apt-get update && apt-get install -y \
    python3.10 \
    python3-pip \
    git \
    build-essential \
    cmake \
    ninja-build \
    && rm -rf /var/lib/apt/lists/*

# 3. Link Python (Cached)
RUN ln -s /usr/bin/python3 /usr/bin/python && \
    python -m pip install --upgrade pip

# 4. Install Standard Libs (Cached)
COPY src/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 5. Install Llama-cpp (THE FIX)
# We do NOT set a global ENV variable.
# We set LD_LIBRARY_PATH *only* for this specific run command.
# We compile, then immediately delete the fake driver link and refresh the cache.
ENV CMAKE_ARGS="-DGGML_CUDA=on"
ENV FORCE_CMAKE=1
RUN ln -s /usr/local/cuda/lib64/stubs/libcuda.so /usr/local/cuda/lib64/stubs/libcuda.so.1 \
    && LD_LIBRARY_PATH="/usr/local/cuda/lib64/stubs:$LD_LIBRARY_PATH" \
       pip install --no-cache-dir llama-cpp-python \
    && rm /usr/local/cuda/lib64/stubs/libcuda.so.1 \
    && ldconfig

# 6. Install PyTorch Nightly (Cached if you didn't change this line)
RUN pip install --no-cache-dir --pre --upgrade --force-reinstall --no-deps \
    torch torchvision torchaudio \
    --index-url https://download.pytorch.org/whl/nightly/cu128

# 7. Copy Code
COPY src/ ./src

# 8. Run
EXPOSE 8501
EXPOSE 8000
CMD ["streamlit", "run", "src/main.py", "--server.port=8501", "--server.address=0.0.0.0"]