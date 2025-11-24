import logging

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
log_file = "data_provenance.log"
file_handler = logging.FileHandler(log_file)
logger = logging.getLogger(__name__) 
logger.addHandler(file_handler)
logger.propagate = False 

def log_data_source(source_file, source_url, license_type):
    """
    Logs metadata about a data source to a dedicated log file.
    """
    try:
        with open(source_file, 'r', encoding='utf-8') as f:
            line_count = sum(1 for _ in f)
        
        log_message = (
            f"\n--- Data Provenance Log Entry ---"
            f"\nSource File: {source_file}"
            f"\nData Source URL: {source_url}"
            f"\nData License: {license_type}"
            f"\nTotal Examples: {line_count}"
            f"\n---------------------------------"
        )
        logger.info(log_message)
        print(f"Provenance logged to {log_file}")
        
    except FileNotFoundError:
        logger.error(f"Failed to log provenance. File not found: {source_file}")
        print(f"Error: Could not find file {source_file} to log provenance.")
    except Exception as e:
        logger.error(f"An error occurred during logging: {e}")
        print(f"An error occurred during logging: {e}")