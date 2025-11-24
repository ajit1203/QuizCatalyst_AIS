import torch
import json
from detoxify import Detoxify

DEVICE = 'cuda' if torch.cuda.is_available() else 'cpu'
print(f"Loading toxicity model on device: {DEVICE}...")
TOXICITY_MODEL = Detoxify('unbiased', device=DEVICE)
print("Toxicity model loaded.")

def filter_toxic_content(input_file, threshold=0.8):
    filtered_data = []
    output_file = "dolly_toxic_filtered.jsonl" 
    
    with open(input_file, 'r', encoding='utf-8') as f_in:
        # Read all lines into memory to process
        lines = f_in.readlines()
        
    print(f"Starting toxicity scan of {len(lines)} examples...")
    
    # Process in batches 
    batch_size = 32
    for i in range(0, len(lines), batch_size):
        batch_lines = lines[i:i+batch_size]
        batch_examples = []
        batch_texts = []
        
        for line in batch_lines:
            try:
                example = json.loads(line)
                instruction = example.get('instruction', '')
                context = example.get('context', '')
                response = example.get('response', '')
                combined_text = f"{instruction} {context} {response}"
                
                if not combined_text.strip():
                    continue 
                    
                batch_examples.append(example)
                batch_texts.append(combined_text)
            except json.JSONDecodeError:
                print(f"Skipping malformed line: {line}")
        
        if not batch_texts:
            continue
            
        try:
            scores_dict = TOXICITY_MODEL.predict(batch_texts)
            
            # Filter batch
            for idx, example in enumerate(batch_examples):
                is_toxic = False
                for score_type in scores_dict:
                    if scores_dict[score_type][idx] > threshold:
                        is_toxic = True
                        break 
                
                if not is_toxic:
                    filtered_data.append(example)
                    
        except Exception as e:
            print(f"Error processing batch {i}: {e}")

    with open(output_file, 'w', encoding='utf-8') as f_out:
        for example in filtered_data:
            f_out.write(json.dumps(example) + '\n')
            
    print(f"Filtered {len(filtered_data)} non-toxic examples to {output_file}")
    return output_file