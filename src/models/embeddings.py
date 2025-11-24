from sentence_transformers import SentenceTransformer
import config
import streamlit as st

class EmbeddingHandler:
    def __init__(self):
        self.model = None
    
    @st.cache_resource
    def load_embedding_model(_self):
        """Load sentence transformer model for embeddings (cached locally)"""
        print(f"📥 Loading embedding model: {config.EMBEDDING_MODEL}")
        print(f"💾 Cache location: {config.EMBEDDING_CACHE}")
        
        _self.model = SentenceTransformer(
            config.EMBEDDING_MODEL,
            cache_folder=str(config.EMBEDDING_CACHE)
        )
        
        print("✅ Embedding model loaded successfully!")
        return _self.model
    
    def get_embeddings(self, texts):
        """Generate embeddings for given texts"""
        if self.model is None:
            self.model = self.load_embedding_model()
        
        embeddings = self.model.encode(texts, show_progress_bar=True)
        return embeddings