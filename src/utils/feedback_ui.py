import streamlit as st
from utils.database import save_feedback
from utils.monitoring import FEEDBACK_COUNTER

def get_current_messages():
    """Get current chat messages safely"""
    if st.session_state.current_chat_id and st.session_state.current_chat_id in st.session_state.chat_sessions:
        return st.session_state.chat_sessions[st.session_state.current_chat_id]['messages']
    return []

def show_feedback_buttons(message_index, username, mode, chat_id):
    """Display feedback buttons (thumbs up/down) for a message"""
    
    
    thumbs_up_key = f"thumbs_up_{chat_id}_{message_index}"
    thumbs_down_key = f"thumbs_down_{chat_id}_{message_index}"
    feedback_given_key = f"feedback_given_{chat_id}_{message_index}"
    show_comment_key = f"show_comment_{chat_id}_{message_index}"
    comment_saved_key = f"comment_saved_{chat_id}_{message_index}"
    
    if feedback_given_key not in st.session_state: st.session_state[feedback_given_key] = None
    if show_comment_key not in st.session_state: st.session_state[show_comment_key] = False
    if comment_saved_key not in st.session_state: st.session_state[comment_saved_key] = False
    
    chat_messages = get_current_messages()
    
    if not (message_index > 0 and message_index < len(chat_messages)):
        return
        
    user_msg = chat_messages[message_index - 1]['content']
    ai_msg = chat_messages[message_index]['content']
    
    col1, col2, col3, col4 = st.columns([1, 1, 1, 10])
    
    with col1:
        if st.button("👍", key=thumbs_up_key, help="Good response", 
                    disabled=st.session_state[feedback_given_key] is not None):
            st.session_state[feedback_given_key] = "thumbs_up"
            st.session_state[show_comment_key] = True
            
            # Metric & Save
            FEEDBACK_COUNTER.labels(type="thumbs_up").inc()
            save_feedback(username, mode, user_msg, ai_msg, "thumbs_up", "")
            st.rerun()
    
    with col2:
        if st.button("👎", key=thumbs_down_key, help="Needs improvement",
                    disabled=st.session_state[feedback_given_key] is not None):
            st.session_state[feedback_given_key] = "thumbs_down"
            st.session_state[show_comment_key] = True
            
            # Metric & Save
            FEEDBACK_COUNTER.labels(type="thumbs_down").inc()
            save_feedback(username, mode, user_msg, ai_msg, "thumbs_down", "")
            st.rerun()
    
    with col3:
        if st.session_state[feedback_given_key] is not None:
            if st.button("💬", key=f"comment_icon_{chat_id}_{message_index}", help="Add comment"):
                st.session_state[show_comment_key] = not st.session_state[show_comment_key]
                st.rerun()
    
    # FEEDBACK STATUS 
    if st.session_state[feedback_given_key] == "thumbs_up":
        st.caption("✅ Helpful!")
    elif st.session_state[feedback_given_key] == "thumbs_down":
        st.caption("📝 Noted.")
    
    # COMMENT FORM 
    if st.session_state[show_comment_key] and not st.session_state[comment_saved_key]:
        with st.form(key=f"comment_form_{chat_id}_{message_index}"):
            comment = st.text_area("Tell us more:", height=100, key=f"comment_text_{chat_id}_{message_index}")
            if st.form_submit_button("Submit"):
                if comment.strip():
                    save_feedback(username, mode, user_msg, ai_msg, st.session_state[feedback_given_key], comment.strip())
                    st.session_state[comment_saved_key] = True
                    st.session_state[show_comment_key] = False
                    st.success("Thank you!")
                    st.rerun()

def display_message_with_feedback(message, message_index, username, mode, chat_id):
    with st.chat_message(message["role"]):
        st.markdown(message["content"])
        
        if (message["role"] == "assistant" and message["content"] and 
            not message["content"].startswith(("⚠️", "❌", "Error"))):
            show_feedback_buttons(message_index, username, mode, chat_id)