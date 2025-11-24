import streamlit as st
import re
from utils.database import create_user, verify_user

def is_valid_email(email):
    """Validate email format"""
    pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
    return re.match(pattern, email) is not None

def is_valid_username(username):
    """Validate username (alphanumeric and underscore, 3-20 chars)"""
    pattern = r'^[a-zA-Z0-9_]{3,20}$'
    return re.match(pattern, username) is not None

def is_valid_password(password):
    """Validate password (at least 6 characters)"""
    return len(password) >= 6

def show_login_page():
    """Display login page"""
    st.markdown("""
        <style>
        .auth-container {
            max-width: 500px;
            margin: 0 auto;
            padding: 2rem;
        }
        </style>
    """, unsafe_allow_html=True)
    
    col1, col2, col3 = st.columns([1, 2, 1])
    
    with col2:
        st.markdown("<div class='auth-container'>", unsafe_allow_html=True)
        
        # Logo/Title
        st.markdown("<h1 style='text-align: center;'>🤖 QuizCatalyst</h1>", unsafe_allow_html=True)
        st.markdown("<p style='text-align: center; color: gray;'>Personalized AI Tutor</p>", unsafe_allow_html=True)
        st.markdown("<br>", unsafe_allow_html=True)
        
        tab1, tab2 = st.tabs(["🔐 Login", "✨ Sign Up"])
        
        with tab1:
            st.markdown("### Welcome Back!")
            
            with st.form("login_form"):
                username = st.text_input("Username", placeholder="Enter your username")
                password = st.text_input("Password", type="password", placeholder="Enter your password")
                
                col_a, col_b, col_c = st.columns([1, 2, 1])
                with col_b:
                    submit = st.form_submit_button("Login", use_container_width=True, type="primary")
                
                if submit:
                    if not username or not password:
                        st.error("⚠️ Please fill in all fields")
                    else:
                        success, user_data = verify_user(username, password)
                        if success:
                            st.session_state.authenticated = True
                            st.session_state.user = user_data
                            st.success(f"✅ Welcome back, {username}!")
                            st.rerun()
                        else:
                            st.error("❌ Invalid username or password")
        
        with tab2:
            st.markdown("### Create Account")
            
            with st.form("signup_form"):
                new_username = st.text_input("Username", placeholder="Choose a username (3-20 characters)", key="signup_username")
                new_email = st.text_input("Email", placeholder="Enter your email", key="signup_email")
                new_password = st.text_input("Password", type="password", placeholder="Choose a password (min 6 characters)", key="signup_password")
                confirm_password = st.text_input("Confirm Password", type="password", placeholder="Re-enter your password", key="signup_confirm")
                
                col_a, col_b, col_c = st.columns([1, 2, 1])
                with col_b:
                    submit = st.form_submit_button("Sign Up", use_container_width=True, type="primary")
                
                if submit:
                    # Validation
                    if not new_username or not new_email or not new_password or not confirm_password:
                        st.error("⚠️ Please fill in all fields")
                    elif not is_valid_username(new_username):
                        st.error("⚠️ Username must be 3-20 characters (letters, numbers, underscore only)")
                    elif not is_valid_email(new_email):
                        st.error("⚠️ Please enter a valid email address")
                    elif not is_valid_password(new_password):
                        st.error("⚠️ Password must be at least 6 characters")
                    elif new_password != confirm_password:
                        st.error("⚠️ Passwords do not match")
                    else:
                        success, message = create_user(new_username, new_email, new_password)
                        if success:
                            st.success(f"✅ {message}")
                            st.info("👉 Please go to the Login tab to sign in")
                        else:
                            st.error(f"❌ {message}")
        
        st.markdown("</div>", unsafe_allow_html=True)

def show_logout_button():
    """Display logout button in sidebar"""
    with st.sidebar:
        st.divider()
        st.markdown(f"👤 **Logged in as:** {st.session_state.user['username']}")
        
        if st.button("🚪 Logout", use_container_width=True):
            st.session_state.authenticated = False
            st.session_state.user = None
            st.session_state.chat_history = []
            st.session_state.document_uploaded = False
            st.rerun()