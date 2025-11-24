from llama_cpp import Llama
import config
import streamlit as st

class LLMHandler:
    def __init__(self):
        self.model = None
    
    def load_model(self):
        if self.model is not None: return
        print(f"🚀 Loading GGUF: {config.MODEL_ID}")
        try:
            self.model = Llama(
                model_path=str(config.MODEL_ID),
                n_ctx=4096,
                n_gpu_layers=-1,
                verbose=True
            )
            print("✅ Model loaded on GPU!")
        except Exception as e:
            print(f"❌ Load Error: {e}")
            raise e

    def generate_response(self, input_data, max_new_tokens=None):
        if self.model is None: self.load_model()
        max_tokens = max_new_tokens or config.MAX_NEW_TOKENS
        
        # Construct Prompt
        prompt_text = ""
        if isinstance(input_data, str):
            prompt_text = f"[INST] {input_data} [/INST]"
        else:
            for msg in input_data:
                if msg['role'] == 'user':
                    prompt_text += f"[INST] {msg['content']} [/INST]"
                elif msg['role'] == 'assistant':
                    prompt_text += f" {msg['content']} </s>"

        # Inference
        output = self.model(
            prompt_text,
            max_tokens=max_tokens,
            temperature=config.TEMPERATURE,
            stop=["</s>", "[/INST]"],
            echo=False
        )
        return output['choices'][0]['text'].strip()

    def generate_rag_response(self, query, context):
        return self.generate_response(f"Context:\n{context}\n\nQuestion: {query}")
    
    def generate_socratic_question(self, context, history, question):
        return self.generate_response(f"Context: {context}\nStudent: {question}\nAsk a guiding question.")
        
    def generate_final_explanation(self, context, history, answer):
        return self.generate_response(f"Context: {context}\nAnswer: {answer}\nValidate and explain.")

    def generate_qa_for_batch(self, chunks):
        return [self.generate_response(f"Create a Q&A pair from:\n{c}") for c in chunks]

@st.cache_resource(show_spinner=False)
def get_llm_handler():
    handler = LLMHandler()
    handler.load_model()
    return handler