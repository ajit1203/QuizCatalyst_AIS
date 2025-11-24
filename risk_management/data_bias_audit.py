import pandas as pd
import nltk
from nltk.corpus import stopwords
from nltk.tokenize import word_tokenize
from textblob import TextBlob
from sklearn.feature_extraction.text import TfidfVectorizer
import json
import logging

def download_nltk_resources():
    resources = {
        "corpora/stopwords": "stopwords",
        "tokenizers/punkt": "punkt",
        "tokenizers/punkt_tab": "punkt_tab" 
    }
    for path, pkg_id in resources.items():
        try:
            nltk.data.find(path)
        except LookupError:
            print(f"NLTK resource '{pkg_id}' not found.Downloading")
            nltk.download(pkg_id, quiet=True)

print("Checking NLTK resources")
download_nltk_resources()
print("NLTK resources are ready")

logging.getLogger("nltk").setLevel(logging.WARNING)

def audit_bias(input_file):
    """
    Loads a JSONL file, combines text fields, and runs a bias audit.
    """
    print(f"\n--- Starting Bias Audit for {input_file} ---")
    data = []
    with open(input_file, 'r', encoding='utf-8') as f:
        for line in f:
            try:
                example = json.loads(line)
                user_msg = ""
                assistant_msg = ""
                if 'messages' in example:
                    for msg in example['messages']:
                        if msg['role'] == 'user':
                            user_msg = msg['content']
                        elif msg['role'] == 'assistant':
                            assistant_msg = msg['content']
                
                example['full_text'] = f"{user_msg} {assistant_msg}"
                data.append(example)
                
            except json.JSONDecodeError:
                continue
    
    if not data:
        print("No data found for bias audit.")
        return

    df = pd.DataFrame(data)
    
    if 'full_text' not in df.columns or df['full_text'].empty:
        print("No text found for bias audit.")
        return

    df['sentiment'] = df['full_text'].astype(str).apply(lambda x: TextBlob(x).sentiment.polarity)
    print("\n1. Sentiment Polarity (negative vs. positive):")
    print(df['sentiment'].describe())
    df['subjectivity'] = df['full_text'].astype(str).apply(lambda x: TextBlob(x).sentiment.subjectivity)
    print("\n2. Subjectivity (objective vs. subjective):")
    print(df['subjectivity'].describe())
    stop_words = set(stopwords.words('english'))
    df['processed_text'] = df['full_text'].astype(str).apply(lambda x: " ".join([word for word in word_tokenize(x.lower()) if word.isalpha() and word not in stop_words]))
    tfidf = TfidfVectorizer(max_features=20)
    try:
        tfidf.fit(df[df['processed_text'].notna()]['processed_text'])
        print("\n3. Top 20 Most Frequent (TF-IDF) Terms:")
        print(tfidf.get_feature_names_out())
    except ValueError:
        print("\n3. Could not compute TF-IDF (likely empty vocabulary).")

    print("--- Bias Audit Complete ---")