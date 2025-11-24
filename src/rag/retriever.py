from rag.vector_store import VectorStore

class Retriever:
    def __init__(self):
        self.vector_store = VectorStore()
    
    def retrieve_context(self, query, top_k=None):
        """Retrieve relevant context for a query"""
        results = self.vector_store.search(query, top_k)
        
        if not results['documents']:
            return ""
        
        # Combine retrieved documents into context
        context = "\n\n".join(results['documents'][0])
        
        return context, results
    
    def add_documents_to_store(self, chunks):
        """Add document chunks to vector store"""
        self.vector_store.create_collection()
        self.vector_store.add_documents(chunks)