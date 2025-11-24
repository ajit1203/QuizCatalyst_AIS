import streamlit as st
import sys
from pathlib import Path
import time
import os

sys.path.append(str(Path(__file__).parent))
import config

from models.llm_handler import get_llm_handler
from rag.document_processor import DocumentProcessor
from rag.retriever import Retriever
from utils.auth import show_login_page
from utils.feedback_ui import display_message_with_feedback
from utils.database import (
    create_new_chat_in_db, get_user_chats, get_chat_messages, 
    save_message_to_db, update_chat_title, update_chat_mode_pdf
)
from utils.monitoring import (
    start_metrics_server, RESPONSE_COUNTER, LENGTH_GAUGE, LATENCY_SUMMARY,
    RETRIEVAL_LATENCY, SIMILARITY_SCORE, RETRIEVAL_ATTEMPTS, RETRIEVAL_HITS,
    INDEX_SIZE, INDEX_FRESHNESS, DOCS_INDEXED, UPLOAD_ERRORS, LARGE_FILES
)

UPLOADS_DIR = Path(__file__).parent / "data" / "uploads"
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)

st.set_page_config(page_title="QuizCatalyst", page_icon="🎓", layout="wide", initial_sidebar_state="expanded")

st.markdown("""
<style>
    .main { background-color: #131314; color: #E3E3E3; }
    [data-testid="stSidebar"] { background-color: #1E1F20; border-right: 1px solid #333; }
    [data-testid="stSidebar"] * { color: #E3E3E3 !important; }
    .uploaded-file-chip { display: inline-flex; align-items: center; background-color: #1E1F20; border: 1px solid #444; border-radius: 8px; padding: 8px 16px; margin-bottom: 10px; font-size: 14px; color: #A8C7FA; }
    [data-testid="stHeader"] { background-color: transparent; }
    .stDeployButton {display:none;}
    footer {visibility: hidden;}
</style>
""", unsafe_allow_html=True)

if 'authenticated' not in st.session_state: st.session_state.authenticated = False
if 'user' not in st.session_state: st.session_state.user = None
if 'current_chat_id' not in st.session_state: st.session_state.current_chat_id = None
if 'llm_handler' not in st.session_state: st.session_state.llm_handler = None
if 'retriever' not in st.session_state: st.session_state.retriever = None
if 'doc_processor' not in st.session_state: st.session_state.doc_processor = DocumentProcessor()
if 'active_processed_pdf' not in st.session_state: st.session_state.active_processed_pdf = None
if 'socratic_state' not in st.session_state: st.session_state.socratic_state = "IDLE"

def save_uploaded_file(uploaded_file):
    try:
        file_path = UPLOADS_DIR / uploaded_file.name
        with open(file_path, "wb") as f: f.write(uploaded_file.getbuffer())
        return file_path
    except Exception as e: print(f"Error saving file: {e}"); return None

def load_user_chats():
    if st.session_state.user: st.session_state.chat_sessions = get_user_chats(st.session_state.user['id'])

def create_new_chat():
    chat_id = f"chat_{int(time.time() * 1000)}"
    create_new_chat_in_db(chat_id, st.session_state.user['id'])
    st.session_state.chat_sessions[chat_id] = {
        'messages': [], 'title': 'New Chat', 'timestamp': time.time(),
        'mode': "LLM", 'pdf_name': None, 'pdf_ref': None, 'study_guide': None
    }
    st.session_state.current_chat_id = chat_id
    st.session_state.socratic_state = "IDLE" 
    return chat_id

def switch_chat(chat_id):
    st.session_state.current_chat_id = chat_id
    st.session_state.socratic_state = "IDLE"
    st.session_state.chat_sessions[chat_id]['messages'] = get_chat_messages(chat_id)

def get_current_chat():
    if not st.session_state.current_chat_id: create_new_chat()
    chat = st.session_state.chat_sessions[st.session_state.current_chat_id]
    if chat.get('pdf_name') and chat.get('pdf_ref') is None:
        file_path = UPLOADS_DIR / chat['pdf_name']
        if file_path.exists(): chat['pdf_ref'] = open(file_path, "rb")
        else: chat['pdf_name'] = None
    return chat

def initialize_llm():
    if st.session_state.llm_handler is None: st.session_state.llm_handler = get_llm_handler()

def process_pdf(uploaded_file, chat_data):
    try:
        if st.session_state.llm_handler is None:
            with st.spinner("⚙️ Loading AI Model..."): initialize_llm()
        
        file_name = uploaded_file.name if hasattr(uploaded_file, 'name') else "document.pdf"
        if hasattr(uploaded_file, 'size') and uploaded_file.size > 10 * 1024 * 1024:
            LARGE_FILES.inc(); st.warning("⚠️ Large file detected.")

        if hasattr(uploaded_file, 'getbuffer'): save_uploaded_file(uploaded_file)

        with st.spinner(f"📄 Processing '{file_name}'..."):
            st.session_state.retriever = Retriever()
            chunks = st.session_state.doc_processor.process_pdf(uploaded_file)
            st.session_state.retriever.add_documents_to_store(chunks)
            
            DOCS_INDEXED.inc(); INDEX_FRESHNESS.set_to_current_time(); INDEX_SIZE.inc(sum(len(c) for c in chunks))

            chat_data['pdf_name'] = file_name
            chat_data['pdf_ref'] = uploaded_file
            st.session_state.active_processed_pdf = file_name
            
            if chunks:
                prompt = f"Generate a 3-word title for: '{chunks[0][:200]}'"
                try:
                    new_title = st.session_state.llm_handler.generate_response(prompt, max_new_tokens=20).replace('"', '').replace("Title:", "").strip()
                    chat_data['title'] = new_title
                    update_chat_title(st.session_state.current_chat_id, new_title)
                except Exception: pass

            update_chat_mode_pdf(st.session_state.current_chat_id, chat_data['mode'], file_name, chat_data.get('study_guide'))
            return True
    except Exception as e:
        UPLOAD_ERRORS.inc(); st.error(f"❌ Processing failed: {e}"); return False

def main():
    start_metrics_server()

    if not st.session_state.authenticated: show_login_page(); return
    if 'chat_sessions' not in st.session_state: load_user_chats()
    
    if st.session_state.current_chat_id is None:
        if st.session_state.chat_sessions: switch_chat(list(st.session_state.chat_sessions.keys())[0])
        else: create_new_chat()

    current_chat = get_current_chat()
    if not current_chat['messages']: current_chat['messages'] = get_chat_messages(st.session_state.current_chat_id)

    with st.sidebar:
        st.title("🎓 QuizCatalyst")
        st.markdown(f"<div class='sidebar-user'>User: <b>{st.session_state.user['username']}</b></div>", unsafe_allow_html=True)
        st.divider()
        if st.button("➕ New Chat", use_container_width=True): create_new_chat(); st.rerun()
        st.markdown("### History")
        for chat_id, data in list(st.session_state.chat_sessions.items()):
            if st.button(f"💬 {data['title']}", key=chat_id, use_container_width=True): switch_chat(chat_id); st.rerun()
        st.divider()
        if st.button("🚪 Logout"): st.session_state.authenticated = False; st.session_state.user = None; st.rerun()

    col_plus, col_spacer, col_mode = st.columns([1, 12, 3])
    
    
    with col_plus:
        with st.popover("➕", help="Upload"):
            if current_chat['mode'] == "LLM":
                st.warning("🚫 **Wrong Mode**")
                st.caption("Switch to **RAG + LLM** to upload files.")
            else:
                uploaded = st.file_uploader("Upload PDF", type=['pdf'], key=f"up_{st.session_state.current_chat_id}")
                if uploaded and current_chat.get('pdf_name') != uploaded.name:
                    if process_pdf(uploaded, current_chat): st.success("Processed!"); time.sleep(0.5); st.rerun()
                
                st.divider()
                if st.button("✨ Study Guide", use_container_width=True):
                    if current_chat.get('pdf_name'):
                        with st.spinner("Generating..."):
                            qa = st.session_state.llm_handler.generate_qa_for_batch(st.session_state.retriever.vector_store.collection.get()['documents'][:4])
                            current_chat['study_guide'] = "\n\n".join(qa)
                            update_chat_mode_pdf(st.session_state.current_chat_id, current_chat['mode'], current_chat['pdf_name'], current_chat['study_guide'])
                            st.rerun()
                    else: st.error("Upload first!")

    with col_mode:
        with st.popover(f"{current_chat['mode']}"):
            new_mode = st.radio("Mode", ["LLM", "RAG + LLM"], index=0 if current_chat['mode'] == "LLM" else 1)
            if new_mode != current_chat['mode']:
                current_chat['mode'] = new_mode
                if new_mode == "LLM": current_chat['pdf_name'] = None
                update_chat_mode_pdf(st.session_state.current_chat_id, new_mode, current_chat['pdf_name'], current_chat.get('study_guide'))
                st.rerun()

    if current_chat.get('pdf_name') and current_chat['mode'] == "RAG + LLM":
        st.markdown(f"""<div class="uploaded-file-chip">📄 <strong>{current_chat['pdf_name']}</strong></div>""", unsafe_allow_html=True)

    if current_chat.get('study_guide'):
        with st.expander("📝 Study Guide", expanded=True):
            st.text_area("", current_chat['study_guide'], height=300)
            if st.button("Close"): current_chat['study_guide'] = None; st.rerun()

    
    for idx, msg in enumerate(current_chat['messages']):
        display_message_with_feedback(msg, idx, st.session_state.user['username'], current_chat['mode'], st.session_state.current_chat_id)

    disable_input = current_chat['mode'] == "RAG + LLM" and not current_chat.get('pdf_name')
    placeholder = "Ask anything..." if not disable_input else "⚠️ Upload a PDF first."

    if prompt := st.chat_input(placeholder, disabled=disable_input):
        
        if st.session_state.llm_handler is None:
            with st.spinner("⚙️ Loading the Model..."): initialize_llm()

        current_chat['messages'].append({"role": "user", "content": prompt})
        save_message_to_db(st.session_state.current_chat_id, "user", prompt)
        if current_chat['title'] == "New Chat":
             update_chat_title(st.session_state.current_chat_id, prompt[:30] + "...")

        try:
            response = ""
            llm = st.session_state.llm_handler
            start_time = time.time()
            
            if current_chat['mode'] == "RAG + LLM":
                if st.session_state.active_processed_pdf != current_chat['pdf_name']:
                     process_pdf(current_chat['pdf_ref'], current_chat)
                
                retriever = st.session_state.retriever
                RETRIEVAL_ATTEMPTS.inc()
                start_ret = time.time()
                
                with st.spinner("🔍 Reading Document..."):
                    context, results = retriever.retrieve_context(prompt)
                
                RETRIEVAL_LATENCY.observe(time.time() - start_ret)
                if context: RETRIEVAL_HITS.inc()
                
                if results and 'distances' in results:
                    try: SIMILARITY_SCORE.observe(results['distances'][0][0])
                    except: pass

                with st.spinner("🤖 Thinking..."):
                    response = llm.generate_rag_response(prompt, context)
            else:
                with st.spinner("🤖 Thinking..."):
                    response = llm.generate_response(current_chat['messages'])
            
            duration = time.time() - start_time
            LATENCY_SUMMARY.observe(duration)
            RESPONSE_COUNTER.labels(mode=current_chat['mode']).inc()
            LENGTH_GAUGE.set(len(response))

            current_chat['messages'].append({"role": "assistant", "content": response})
            save_message_to_db(st.session_state.current_chat_id, "assistant", response)
            st.rerun()
            
        except Exception as e:
            st.error(f"Error: {e}")

if __name__ == "__main__":
    main()