import torch
from datasets import load_dataset
from transformers import (
    AutoModelForCausalLM,
    AutoTokenizer,
    BitsAndBytesConfig,
    TrainingArguments,
)
from peft import LoraConfig, get_peft_model, prepare_model_for_kbit_training
from trl import SFTTrainer

model_name = "mistralai/Mistral-7B-Instruct-v0.2"
dataset_name = "processed_data.jsonl"  
new_model_name = "quizcatalyst-dolly-adapter"

print("Starting script...")
print(f"Loading base model: {model_name}")

# Configure 4-bit quantization
bnb_config = BitsAndBytesConfig(
    load_in_4bit=True,
    bnb_4bit_quant_type="nf4",
    bnb_4bit_compute_dtype=torch.bfloat16,
    bnb_4bit_use_double_quant=True,
)

# Load the 4-bit model
model = AutoModelForCausalLM.from_pretrained(
    model_name,
    quantization_config=bnb_config,
    device_map="auto"  
)
model.config.use_cache = False
model.config.pretraining_tp = 1
print("Base model loaded.")

# Load Tokenizer 
tokenizer = AutoTokenizer.from_pretrained(model_name, trust_remote_code=True)
tokenizer.pad_token = tokenizer.eos_token
tokenizer.padding_side = "right"
print("Tokenizer loaded.")

# Load Pre-processed Dataset 
print(f"Loading pre-processed clean dataset: {dataset_name}")
dataset = load_dataset("json", data_files=dataset_name, split="train")
print("Clean dataset loaded.")

# Configure LoRA 
print("Configuring LoRA...")
model = prepare_model_for_kbit_training(model)
peft_config = LoraConfig(
    r=16,
    lora_alpha=32,
    lora_dropout=0.1,
    bias="none",
    task_type="CAUSAL_LM",
    target_modules=["q_proj", "v_proj"]  
)
model = get_peft_model(model, peft_config)
print("LoRA configured.")

# Configure Training Arguments 
training_args = TrainingArguments(
    output_dir="./quizcatalyst-finetuned",
    per_device_train_batch_size=2,  
    gradient_accumulation_steps=4,  
    learning_rate=2e-4,
    num_train_epochs=1,             
    logging_steps=10,
    save_strategy="epoch",
    optim="paged_adamw_8bit",       
    fp16=True,                      
    max_steps=-1,
    warmup_steps=10,
    group_by_length=True,
)

# Initialize Trainer
print("Initializing SFTTrainer...")
trainer = SFTTrainer(
    model=model,
    train_dataset=dataset,
    peft_config=peft_config,
    args=training_args,                
)

print("--- Starting Training ---")
trainer.train()
print("--- Training Complete ---")
print(f"Saving adapter to {new_model_name}...")
trainer.save_model(new_model_name)
print("Adapter saved. Finetuning process complete.")