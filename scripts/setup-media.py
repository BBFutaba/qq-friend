from pathlib import Path
import json
import os
ROOT=Path(__file__).resolve().parents[1]/'workspace'
os.environ['HF_HOME']=str(ROOT/'models')
os.environ['HF_HUB_DISABLE_TELEMETRY']='1'
from faster_whisper.utils import download_model
download_model('base',output_dir=str(ROOT/'models'/'whisper-base'))
(ROOT/'media-ready.json').write_text(json.dumps({'images':True,'audio':True,'video':True,'model':'whisper-base','maxSeconds':60}),encoding='utf-8')
print('Fixed media decoder and local whisper-base ready')
