"""Generate an editable, dependency-free SVG of the implemented LMD architecture."""
from pathlib import Path
from html import escape
import math
import re

ROOT = Path(__file__).resolve().parent
W, H = 1440, 1080
parts = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">', '<title>LMD system architecture</title>', '<desc>Local desktop user interface, Rust application services, Python scientific sidecar, and local workspace storage. Only Rust reads and writes SQLite.</desc>', '''<defs>
<marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#526576"/></marker>
</defs>''']

def rect(x,y,w,h,fill='#fff',stroke='#ccd6df',r=12,dash=''):
    parts.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{r}" fill="{fill}" stroke="{stroke}" stroke-width="1.5"'+(f' stroke-dasharray="{dash}"' if dash else '')+'/>')
def text(x,y,s,size=22,color='#20354a',weight=400,anchor='start'):
    parts.append(f'<text x="{x}" y="{y}" font-family="Arial, Helvetica, sans-serif" font-size="{size}" font-weight="{weight}" fill="{color}" text-anchor="{anchor}">{escape(s)}</text>')
def line(path,label=None,lx=0,ly=0,both=False):
    parts.append(f'<path d="{path}" fill="none" stroke="#526576" stroke-width="2.4" stroke-linejoin="round"/>')
    numbers = [float(value) for value in re.findall(r"-?\d+(?:\.\d+)?", path)]
    points = list(zip(numbers[::2], numbers[1::2]))
    ends = [(points[-1], points[-2])]
    if both: ends.append((points[0], points[1]))
    for tip, previous in ends:
        dx, dy = tip[0]-previous[0], tip[1]-previous[1]
        length = math.hypot(dx,dy)
        ux, uy = dx/length, dy/length
        base = (tip[0]-12*ux, tip[1]-12*uy)
        triangle = [tip, (base[0]-5*uy,base[1]+5*ux), (base[0]+5*uy,base[1]-5*ux)]
        coords = " ".join(f"{x:.1f},{y:.1f}" for x,y in triangle)
        parts.append(f'<polygon points="{coords}" fill="#526576"/>')
    if label: text(lx,ly,label,18,'#526576',anchor='middle')
def boxhead(x,y,title,sub,color):
    text(x,y,title,26,color,700);text(x,y+31,sub,19,'#526576')

rect(0,0,W,H,'#fff','#fff',0)
text(48,49,'LMD SYSTEM ARCHITECTURE',32,weight=700)
text(1392,48,'Local desktop application',20,'#526576',anchor='end')
rect(26,76,1388,973,'#fff','#b7c5d1',18,'7 6')

# Presentation layer.
rect(54,102,1332,212,'#f0f6fc','#99bad5')
boxhead(78,140,'User interface','React + TypeScript  |  Tauri desktop shell','#245c8c')
for x,title,body,tools in [
    (78,'Data management','Molecules, formulations, experiments','Entry forms, libraries, import / export'),
    (518,'Analysis and prediction','Statistics, models, candidate assessment','ECharts visualizations'),
    (958,'Molecular drawing and design','Structure editing and design requests','Ketcher + local Indigo WebAssembly')]:
    rect(x,191,404,99,'#fff','#d1dfeb',8)
    text(x+16,220,title,21,weight=700)
    text(x+16,247,body,18)
    text(x+16,274,tools,17,'#526576')
line('M 438 317 L 438 394','Tauri commands / structured responses',644,361,True)

# Application and scientific services.
rect(54,399,768,253,'#f0f8f6','#91b9ae')
boxhead(78,438,'Application services','Rust','#286b57')
text(78,518,'Commands, validation and job coordination',22)
text(78,553,'Database queries, transactions and migrations',22)
text(78,588,'Statistics and training-feature construction',22)
text(78,623,'Candidate persistence, provenance and file operations',22)
rect(974,399,412,253,'#fbf6ec','#d7bb88')
boxhead(998,438,'Scientific sidecar','Python','#926526')
text(998,518,'RDKit / Mordred descriptors',21)
text(998,553,'scikit-learn training and prediction',21)
text(998,588,'Template / seed-based generation',21)
text(998,623,'Structural and domain assessment',21)
line('M 826 531 L 970 531','JSON CLI',898,500,True)
text(898,561,'Results / errors',17,'#526576',anchor='middle')

# Persistence boundary and individual paths.
line('M 438 655 L 438 770','Queries / transactions',570,707,True)
line('M 1180 655 L 1180 770','Scientific artifacts',1280,708,True)
line('M 754 655 L 754 741 L 1056 741 L 1056 770','File management',878,731,True)
rect(54,775,768,203,'#f5f7fa','#b9c6d4')
boxhead(78,814,'Workspace database','SQLite  |  accessed through Rust','#3e526a')
text(78,887,'Molecules • additives • base oils • formulations',21)
text(78,920,'Experiments • measured results • descriptors • models • jobs',21)
text(78,953,'Design candidates and predictions stored separately',21)
rect(974,775,412,203,'#f5f7fa','#b9c6d4')
boxhead(998,814,'Workspace files','Local filesystem','#3e526a')
text(998,887,'Structures and attachments',21)
text(998,920,'Model bundles and exports',21)
text(998,953,'Backups and diagnostic reports',21)
text(54,1021,'Database writes are owned by Rust; the Python sidecar does not access SQLite directly.',20,'#526576')
parts.append('</svg>')
(ROOT/'lmd-system-architecture.svg').write_text('\n'.join(parts),encoding='utf-8')
print(ROOT/'lmd-system-architecture.svg')
