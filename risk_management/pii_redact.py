from presidio_analyzer import AnalyzerEngine
from presidio_anonymizer import AnonymizerEngine
import json
import logging

logging.getLogger("presidio-analyzer").setLevel(logging.ERROR)

print("Loading PII engines...")
analyzer = AnalyzerEngine()
anonymizer = AnonymizerEngine()
print("PII engines loaded.")

def redact_pii(text):
    #Helper function to redact PII from a single string.
    if not text or not isinstance(text, str):
        return text
    try:
        results = analyzer.analyze(text=text, language='en')
        anonymized_result = anonymizer.anonymize(text=text, analyzer_results=results)
        return anonymized_result.text
    except Exception:
        return text

def redact_pii_in_dataset(input_file):
    #Loads a JSONL file, redacts PII, and saves to a new file.
    output_file = "dolly_pii_redacted.jsonl" 
    
    with open(input_file, 'r', encoding='utf-8') as f_in, \
         open(output_file, 'w', encoding='utf-8') as f_out:
        
        for i, line in enumerate(f_in):
            if (i+1) % 1000 == 0:
                print(f"Processed {i+1} lines for PII redaction...")
            try:
                example = json.loads(line)
                
                if 'instruction' in example:
                    example['instruction'] = redact_pii(example['instruction'])
                if 'context' in example:
                    example['context'] = redact_pii(example['context'])
                if 'response' in example:
                    example['response'] = redact_pii(example['response'])
                    
                f_out.write(json.dumps(example) + '\n')
                
            except json.JSONDecodeError:
                print(f"Skipping malformed line: {line}")
                
    print(f"PII redacted data saved to {output_file}")
    return output_file