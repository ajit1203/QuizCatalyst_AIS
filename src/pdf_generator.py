import fpdf
from io import BytesIO
from unidecode import unidecode  

class PDF(fpdf.FPDF):
    def header(self):
        self.set_font('Helvetica', 'B', 15)
        self.cell(0, 10, 'QuizCatalyst Study Guide', 0, 1, 'C')
        self.ln(10)

    def footer(self):
        self.set_y(-15)
        self.set_font('Helvetica', 'I', 8)
        self.cell(0, 10, f'Page {self.page_no()}', 0, 0, 'C')

def create_study_guide_pdf(qa_string: str) -> bytes:
    """
    Takes a string of Q&As and converts it into a downloadable PDF.
    """
    pdf = PDF()
    pdf.add_page()
    pdf.set_font('Helvetica', '', 12)    
    pdf.set_left_margin(15)
    pdf.set_right_margin(15)
    
    
    qa_string = unidecode(qa_string)
    
    for line in qa_string.split('\n'):
        if not line.strip():
            pdf.ln(5) 
            continue
            
        if line.startswith('Q'):
            pdf.set_font('Helvetica', 'B', 12) 
            pdf.multi_cell(0, 7, line, split_only=True)
            pdf.ln(2)
        elif line.startswith('A'):
            pdf.set_font('Helvetica', '', 12)
            pdf.multi_cell(0, 7, line, split_only=True)
            pdf.ln(2)
        else:
            pdf.set_font('Helvetica', '', 12)
            pdf.multi_cell(0, 7, line, split_only=True)
            
    return pdf.output(dest='S')