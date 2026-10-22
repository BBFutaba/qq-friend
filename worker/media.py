"""Fixed local decoder. No shell, URLs, imports, commands or output paths from a model."""
import base64
import io
import json
import os
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1] / 'workspace'
os.environ['HF_HOME'] = str(ROOT / 'models')
os.environ['HF_HUB_OFFLINE'] = '1'
os.environ['HF_HUB_DISABLE_TELEMETRY'] = '1'

def source_file(raw):
    path = Path(raw).resolve(strict=True)
    if not path.is_relative_to((ROOT / 'media').resolve()) or not path.is_file():
        raise ValueError('媒体路径必须位于独立工作目录')
    if path.stat().st_size > 25 * 1024 * 1024:
        raise ValueError('媒体超过 25 MiB')
    return path

def jpeg(image):
    image.thumbnail((1280, 1280))
    output = io.BytesIO()
    image.convert('RGB').save(output, format='JPEG', quality=80)
    return 'data:image/jpeg;base64,' + base64.b64encode(output.getvalue()).decode('ascii')

def media_format(data):
    if data.startswith(b'RIFF') and data[8:12] == b'WAVE': return 'wav'
    if data.startswith(b'OggS'): return 'ogg'
    if len(data)>12 and data[4:8] == b'ftyp': return 'mov'
    if data.startswith(b'\x1aE\xdf\xa3'): return 'matroska'
    if data.startswith(b'fLaC'): return 'flac'
    if data.startswith(b'ID3') or data[:2] in (b'\xff\xfb', b'\xff\xf3', b'\xff\xf2'): return 'mp3'
    if data.startswith(b'#!AMR'): return 'amr'
    raise ValueError('不支持的媒体格式（QQ SILK 需桥接端先转换为 WAV）')

def decode(request):
    path=source_file(request['file'])
    data=path.read_bytes()
    action=request['action']
    if action=='image':
        from PIL import Image, ImageOps
        Image.MAX_IMAGE_PIXELS=25000000
        with Image.open(io.BytesIO(data)) as im:
            im.seek(0)
            return {'images':[jpeg(ImageOps.exif_transpose(im))], 'notes':[]}
    if action not in ('audio','video'): raise ValueError('不允许的媒体操作')
    import av
    import numpy as np
    fmt=media_format(data)
    # Fixed format + in-memory input prevents manifests from opening external files/URLs.
    images=[]
    notes=[]
    if action=='video':
        with av.open(io.BytesIO(data),format=fmt,options={'protocol_whitelist':'pipe'}) as container:
            if container.streams.video:
                stream=container.streams.video[0]
                last=-20.0
                for i,frame in enumerate(container.decode(stream)):
                    seconds=float(frame.time or 0)
                    if seconds>60 or i>2400: break
                    if seconds-last>=20:
                        images.append(jpeg(frame.to_image()))
                        notes.append({'type':'video_frame','second':round(seconds,1)})
                        last=seconds
                    if len(images)>=3: break
    audio=[]
    total=0
    with av.open(io.BytesIO(data),format=fmt,options={'protocol_whitelist':'pipe'}) as container:
        if container.streams.audio:
            resampler=av.AudioResampler(format='fltp',layout='mono',rate=16000)
            for index,frame in enumerate(container.decode(container.streams.audio[0])):
                for converted in resampler.resample(frame):
                    chunk=converted.to_ndarray().flatten()[:960000-total]
                    audio.append(chunk)
                    total+=len(chunk)
                if total>=960000 or index>15000: break
    if audio:
        from faster_whisper import WhisperModel
        model=WhisperModel(str(ROOT/'models'/'whisper-base'),device='cpu',compute_type='int8',cpu_threads=4,local_files_only=True)
        segments,info=model.transcribe(np.concatenate(audio),beam_size=3,vad_filter=True,condition_on_previous_text=False)
        text=''.join(s.text for s in segments)[:6000]
        notes.append({'type':'transcript','text':text,'language':info.language,'seconds':round(total/16000,1),'limitSeconds':60,'source':'local-whisper-base','uncertain':True})
    return {'images':images,'notes':notes,'bounded':True}

if __name__=='__main__':
    try:
        result=decode(json.load(sys.stdin))
        print(json.dumps(result,ensure_ascii=False))
    except Exception as error:
        print(json.dumps({'error':str(error)[:500]},ensure_ascii=False))
        sys.exit(1)
