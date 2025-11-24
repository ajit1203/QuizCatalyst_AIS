import sqlite3
import hashlib
import csv
from pathlib import Path
from datetime import datetime
import pandas as pd

DB_DIR = Path(__file__).parent / "data"
DB_DIR.mkdir(parents=True, exist_ok=True)
USERS_DB = DB_DIR / "users.db"
FEEDBACK_CSV = DB_DIR / "feedback.csv"

def hash_password(password):
    return hashlib.sha256(password.encode()).hexdigest()

def init_users_database():
    conn = sqlite3.connect(USERS_DB)
    cursor = conn.cursor()
    
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            last_login TIMESTAMP
        )
    ''')
    
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS chats (
            id TEXT PRIMARY KEY,
            user_id INTEGER NOT NULL,
            title TEXT,
            mode TEXT DEFAULT 'LLM',
            pdf_name TEXT,
            study_guide TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users (id)
        )
    ''')

    cursor.execute('''
        CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            chat_id TEXT NOT NULL,
            role TEXT NOT NULL,
            content TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (chat_id) REFERENCES chats (id)
        )
    ''')
    
    conn.commit()
    conn.close()

def create_user(username, email, password):
    try:
        conn = sqlite3.connect(USERS_DB)
        cursor = conn.cursor()
        password_hash = hash_password(password)
        cursor.execute('INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)', 
                      (username, email, password_hash))
        conn.commit()
        conn.close()
        return True, "Account created successfully!"
    except sqlite3.IntegrityError as e:
        if 'username' in str(e): return False, "Username already exists"
        elif 'email' in str(e): return False, "Email already exists"
        return False, "Error creating account"
    except Exception as e:
        return False, f"Error: {str(e)}"

def verify_user(username, password):
    try:
        conn = sqlite3.connect(USERS_DB)
        cursor = conn.cursor()
        password_hash = hash_password(password)
        cursor.execute('SELECT id, username, email FROM users WHERE username = ? AND password_hash = ?', 
                      (username, password_hash))
        user = cursor.fetchone()
        if user:
            cursor.execute('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE username = ?', (username,))
            conn.commit()
            conn.close()
            return True, {'id': user[0], 'username': user[1], 'email': user[2]}
        conn.close()
        return False, None
    except Exception as e:
        return False, None


def create_new_chat_in_db(chat_id, user_id, title="New Chat", mode="LLM"):
    """Creates a new chat session in DB"""
    conn = sqlite3.connect(USERS_DB)
    cursor = conn.cursor()
    cursor.execute('INSERT INTO chats (id, user_id, title, mode) VALUES (?, ?, ?, ?)', 
                  (chat_id, user_id, title, mode))
    conn.commit()
    conn.close()

def update_chat_title(chat_id, new_title):
    conn = sqlite3.connect(USERS_DB)
    cursor = conn.cursor()
    cursor.execute('UPDATE chats SET title = ? WHERE id = ?', (new_title, chat_id))
    conn.commit()
    conn.close()

def update_chat_mode_pdf(chat_id, mode, pdf_name=None, study_guide=None):
    """Updates mode, pdf reference, and study guide"""
    conn = sqlite3.connect(USERS_DB)
    cursor = conn.cursor()
    cursor.execute('''
        UPDATE chats 
        SET mode = ?, pdf_name = ?, study_guide = ? 
        WHERE id = ?
    ''', (mode, pdf_name, study_guide, chat_id))
    conn.commit()
    conn.close()

def save_message_to_db(chat_id, role, content):
    conn = sqlite3.connect(USERS_DB)
    cursor = conn.cursor()
    cursor.execute('INSERT INTO messages (chat_id, role, content) VALUES (?, ?, ?)', 
                  (chat_id, role, content))
    conn.commit()
    conn.close()

def get_user_chats(user_id):
    """Returns list of all chats for a user"""
    conn = sqlite3.connect(USERS_DB)
    cursor = conn.cursor()
    cursor.execute('''
        SELECT id, title, mode, pdf_name, study_guide, created_at 
        FROM chats WHERE user_id = ? ORDER BY created_at DESC
    ''', (user_id,))
    rows = cursor.fetchall()
    conn.close()
    
    chats = {}
    for r in rows:
        chats[r[0]] = {
            'title': r[1],
            'mode': r[2],
            'pdf_name': r[3],
            'study_guide': r[4],
            'timestamp': r[5],
            'messages': [],
            'pdf_ref': None  
        }
    return chats

def get_chat_messages(chat_id):
    """Returns all messages for a specific chat"""
    conn = sqlite3.connect(USERS_DB)
    cursor = conn.cursor()
    cursor.execute('SELECT role, content FROM messages WHERE chat_id = ? ORDER BY id ASC', (chat_id,))
    rows = cursor.fetchall()
    conn.close()
    return [{'role': r[0], 'content': r[1]} for r in rows]

# --- FEEDBACK FUNCTIONS ---
def init_feedback_csv():
    if not FEEDBACK_CSV.exists():
        with open(FEEDBACK_CSV, 'w', newline='', encoding='utf-8') as f:
            writer = csv.writer(f)
            writer.writerow(['timestamp', 'username', 'mode', 'user_query', 'ai_response', 'feedback_type', 'feedback_comment'])

def save_feedback(username, mode, user_query, ai_response, feedback_type, feedback_comment=""):
    try:
        if not FEEDBACK_CSV.exists(): init_feedback_csv()
        timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        with open(FEEDBACK_CSV, 'a', newline='', encoding='utf-8') as f:
            writer = csv.writer(f)
            writer.writerow([timestamp, username, mode, user_query[:500], ai_response[:500], feedback_type, feedback_comment[:1000]])
        return True
    except Exception:
        return False

init_users_database()
init_feedback_csv()