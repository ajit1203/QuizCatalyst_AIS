import os
from datasets import load_dataset, Dataset
import json
from license_provenance_log import log_data_source
from toxicity_screen import filter_toxic_content
from pii_redact import redact_pii_in_dataset
from data_bias_audit import audit_bias

dataset_name = "databricks/databricks-dolly-15k"
dataset_url = "https://huggingface.co/datasets/databricks/databricks-dolly-15k"
dataset_license = "CC BY-SA 3.0" 
data_sample_size = 1000 
original_file = "dolly_original.jsonl"
toxic_filtered_file = "dolly_toxic_filtered.jsonl"
pii_redacted_file = "dolly_pii_redacted.jsonl"
final_clean_file = "processed_data.jsonl" 

print("--- Starting Data Processing Pipeline ---")
print(f"Downloading dataset: {dataset_name}")
dataset = load_dataset(dataset_name, split="train")

if data_sample_size:
    dataset = dataset.shuffle(seed=42).select(range(data_sample_size))
    print(f"Using a sample of {data_sample_size} examples.")

dataset.to_json(original_file)
print(f"Saved original data to {original_file}")

log_data_source(original_file, dataset_url, dataset_license)
print("Data provenance logged.")

print("Filtering for toxicity")
toxic_filtered_file_path = filter_toxic_content(original_file, threshold=0.8)
print(f"Toxic content filtered. Saved to {toxic_filtered_file_path}")

print("Redacting PII")
pii_redacted_file_path = redact_pii_in_dataset(toxic_filtered_file_path)
print(f"PII redacted. Saved to {pii_redacted_file_path}")

print("Formatting data into chat template")
def format_dolly_example(example):
    if example.get("context"):
        user_prompt = f"Instruction: {example['instruction']}\nContext: {example['context']}"
    else:
        user_prompt = f"Instruction: {example['instruction']}"
    
    messages = [
        {"role": "user", "content": user_prompt},
        {"role": "assistant", "content": example["response"]}
    ]
    return {"messages": messages}

clean_dataset = load_dataset("json", data_files=pii_redacted_file_path, split="train")
formatted_dataset = clean_dataset.map(format_dolly_example, remove_columns=clean_dataset.column_names)
formatted_dataset.to_json(final_clean_file)
print(f"Final clean & formatted data saved to {final_clean_file}")
print("Running final bias audit on clean data...")
audit_bias(final_clean_file)
print("Bias audit complete. Report printed above.")
os.remove(original_file)
os.remove(toxic_filtered_file_path)
os.remove(pii_redacted_file_path)
print("Cleanup complete.")
print("--- Data Processing Pipeline Finished ---")
print(f"Ready to fine-tune using: {final_clean_file}")