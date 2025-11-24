import chromadb
from chromadb.config import Settings
import config
from models.embeddings import EmbeddingHandler

class VectorStore:
    def __init__(self):
        self.client = None
        self.collection = None
        self.embedding_handler = EmbeddingHandler()
        self.initialize_client()
    
    def initialize_client(self):
        """Initialize ChromaDB client"""
        self.client = chromadb.PersistentClient(
            path=str(config.VECTOR_DB_DIR)
        )
    
    def create_collection(self, collection_name=None):
        """Create or get a collection"""
        collection_name = collection_name or config.VECTOR_DB_NAME
        
        # This one command replaces the entire old method.
        # It safely gets the collection if it exists,
        # or creates it if it doesn't. No more delete/corrupt bug.
        self.collection = self.client.get_or_create_collection(
            name=collection_name,
            metadata={"hnsw:space": "cosine"}
        )
        
        return self.collection
        
        return self.collection
    
    def add_documents(self, chunks):
        """Add document chunks to vector store"""
        if self.collection is None:
            self.create_collection()
        
        print("Generating embeddings for document chunks...")
        embeddings = self.embedding_handler.get_embeddings(chunks)
        
        # Prepare data for ChromaDB
        ids = [f"chunk_{i}" for i in range(len(chunks))]
        
        print("Adding documents to vector store...")
        self.collection.add(
            embeddings=embeddings.tolist(),
            documents=chunks,
            ids=ids
        )
        
        print(f"Successfully added {len(chunks)} chunks to vector store")
    
    def search(self, query, top_k=None):
        """Search for relevant documents"""
        top_k = top_k or config.TOP_K_RETRIEVAL
        
        if self.collection is None:
            raise ValueError("No collection available. Please upload a document first.")
        
        # Generate query embedding
        query_embedding = self.embedding_handler.get_embeddings([query])[0]
        
        # Search in vector store
        results = self.collection.query(
            query_embeddings=[query_embedding.tolist()],
            n_results=top_k
        )
        
        return results
    
    def get_collection(self, collection_name=None):
        """Get existing collection"""
        collection_name = collection_name or config.VECTOR_DB_NAME
        try:
            self.collection = self.client.get_collection(name=collection_name)
            return self.collection
        except:
            return None