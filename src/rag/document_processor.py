from pypdf import PdfReader
from langchain_text_splitters import RecursiveCharacterTextSplitter
import config

class DocumentProcessor:
    def __init__(self):
        self.text_splitter = RecursiveCharacterTextSplitter(
            chunk_size=config.CHUNK_SIZE,
            chunk_overlap=config.CHUNK_OVERLAP,
            length_function=len,
            separators=["\n\n", "\n", " ", ""]
        )
    
    def extract_text_from_pdf(self, pdf_file):
        """Extract text from uploaded PDF file"""
        pdf_reader = PdfReader(pdf_file)
        text = ""
        
        for page in pdf_reader.pages:
            text += page.extract_text()
        
        return text
    
    def split_text_into_chunks(self, text):
        """Split text into chunks for embedding"""
        chunks = self.text_splitter.split_text(text)
        return chunks
    
    def process_pdf(self, pdf_file):
        """Process PDF: extract text and split into chunks"""
        print("Processing PDF...")
        
        # Extract text
        text = self.extract_text_from_pdf(pdf_file)
        
        if not text.strip():
            raise ValueError("No text could be extracted from the PDF")
        
        # Split into chunks
        chunks = self.split_text_into_chunks(text)
        
        print(f"PDF processed: {len(chunks)} chunks created")
        return chunks