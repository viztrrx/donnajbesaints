"""Generate original 8px Minecraft 1.8 textures using only Python's standard library."""
from pathlib import Path
import json, struct, zlib, zipfile, hashlib, base64
ROOT = Path(__file__).resolve().parent
files = {}
textures = {}
def png(w, h, pixels):
    def chunk(t, b):
        return struct.pack('>I', len(b)) + t + b + struct.pack('>I', zlib.crc32(t+b)&0xffffffff)
    raw = b''.join(b'\0'+bytes(sum(pixels[y*w:(y+1)*w], ())) for y in range(h))
    return b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',w,h,8,6,0,0,0))+chunk(b'IDAT',zlib.compress(raw,9))+chunk(b'IEND',b'')
def rgba(c): return tuple(c)+(255,) if len(c)==3 else tuple(c)
def shade(c,d): return tuple(max(0,min(255,v+d)) for v in c[:3])+(rgba(c)[3],)
def make(name,c,kind='grain',accent=None,animated=False):
    seed=int.from_bytes(hashlib.sha256(name.encode()).digest()[:4],'big')
    p=[]
    for y in range(8):
        for x in range(8):
            d=(((x*13+y*7+seed)%11)==0)*7-(((x*7+y*11+seed)%13)==0)*7
            v=shade(c,d)
            if kind=='brick': v=shade(c,-28 if y%4==0 or (x+(4 if y>=4 else 0))%8==0 else d)
            if kind=='plank': v=shade(c,-22 if y%4==3 else (-12 if x==(2 if y<4 else 6) else d))
            if kind=='log': v=shade(c,-20 if x%3==0 else d)
            if kind=='rings': v=shade(c,-25 if max(abs(x-3.5),abs(y-3.5)) in (1.5,3.5) else d)
            if kind=='ore' and (x,y) in [(1,1),(2,1),(1,2),(5,4),(6,4),(5,5),(2,6)]: v=rgba(accent)
            if kind=='edge': v=shade(c,-20 if x in (0,7) or y in (0,7) else d)
            if kind=='glass': v=rgba(c) if x in (0,7) or y in (0,7) else ((220,242,250,100) if (x,y) in [(2,2),(3,3)] else (0,0,0,0))
            if kind=='grass_side': v=shade((113,143,70) if y<2+(x%3==0) else c,d)
            if kind=='overlay': v=shade((185,185,185),d) if y<2+(x%3==0) else (0,0,0,0)
            if kind=='fire': v=(255,180 if y<4 else 103,28,255) if y>=((x*3)%5)+1 else (0,0,0,0)
            p.append(v)
    textures[name]=p
    path='assets/minecraft/textures/blocks/'+name+'.png'
    files[path]=png(8,8,p)
    if animated: files[path+'.mcmeta']=json.dumps({'animation':{'frametime':1,'frames':[0]}}).encode()
base={'stone':(126,128,131),'dirt':(133,96,65),'coarse_dirt':(115,83,57),'grass_top':(177,177,177),'sand':(218,205,153),'red_sand':(186,108,56),'gravel':(139,133,127),'bedrock':(65,65,69),'snow':(238,245,249),'clay':(155,165,180),'netherrack':(114,49,48),'soul_sand':(86,65,52),'end_stone':(217,219,164),'obsidian':(38,29,54),'ice':(144,184,230,170),'packed_ice':(135,179,226),'hardened_clay':(156,95,65),'mycelium_top':(123,103,122),'sponge':(193,190,74),'sponge_wet':(145,153,52),'stone_granite':(155,112,95),'stone_diorite':(194,194,189),'stone_andesite':(137,140,136),'prismarine_rough':(87,151,140),'prismarine_dark':(52,94,79)}
for n,c in base.items(): make(n,c,animated=n=='prismarine_rough')
for n,c in [('grass_side',(133,96,65)),('grass_side_overlay',(177,177,177))]: make(n,c,'overlay' if n.endswith('overlay') else 'grass_side')
for n,c in [('cobblestone',(119,121,124)),('cobblestone_mossy',(103,121,89)),('stonebrick',(126,129,132)),('stonebrick_mossy',(110,127,97)),('stonebrick_cracked',(106,109,112)),('brick',(161,87,67)),('nether_brick',(57,31,37)),('prismarine_bricks',(100,160,146))]: make(n,c,'brick')
for wood,c in {'oak':(169,133,79),'spruce':(111,80,48),'birch':(205,191,142),'jungle':(164,114,79),'acacia':(177,94,58),'big_oak':(77,52,33)}.items():
    make('planks_'+wood,c,'plank')
    make('log_'+wood,(210,208,193) if wood=='birch' else shade(c,-35),'log')
    make('log_'+wood+'_top',c,'rings')
    make('leaves_'+wood,(150,150,150) if wood not in ('spruce','birch') else ((79,111,77) if wood=='spruce' else (128,167,85)))
for n,c in {'coal':(38,39,42),'iron':(211,173,145),'gold':(247,208,64),'diamond':(76,221,221),'emerald':(48,207,111),'redstone':(221,45,40),'lapis':(49,83,187),'quartz':(235,218,204)}.items():
    make(n+'_ore',(114,49,48) if n=='quartz' else (126,128,131),'ore',c)
    if n!='quartz': make(n+'_block',c,'edge')
colors={'white':(225,226,220),'orange':(221,125,45),'magenta':(178,81,186),'light_blue':(96,166,209),'yellow':(230,200,57),'lime':(121,189,51),'pink':(224,148,165),'gray':(69,72,74),'silver':(153,158,157),'cyan':(44,137,155),'purple':(124,65,174),'blue':(59,76,161),'brown':(109,76,49),'green':(80,111,41),'red':(174,53,47),'black':(32,33,37)}
for n,c in colors.items():
    make('wool_colored_'+n,c)
    make('hardened_clay_stained_'+n,tuple((v*2+b)//3 for v,b in zip(c,(140,89,64))))
    make('glass_'+n,c,'glass')
make('glass',(193,220,227),'glass')
for n,c in [('sandstone',(216,203,157)),('red_sandstone',(185,104,53))]:
    for suffix,kind in [('top','grain'),('bottom','grain'),('normal','brick'),('smooth','grain'),('carved','rings')]:make(n+'_'+suffix,c,kind)
for n,c in [('quartz_block_top',(232,229,220)),('quartz_block_bottom',(217,214,205)),('quartz_block_side',(232,229,220)),('glowstone',(211,173,94)),('redstone_lamp_off',(102,73,44)),('redstone_lamp_on',(222,172,91)),('sea_lantern',(189,222,214))]:make(n,c,'edge',animated=n=='sea_lantern')
for n,c in [('water_still',(170,185,205,180)),('water_flow',(170,185,205,180)),('lava_still',(242,109,21)),('lava_flow',(242,109,21)),('portal',(125,52,179,195)),('fire_layer_0',(255,133,20)),('fire_layer_1',(255,133,20))]:make(n,c,'fire' if n.startswith('fire') else 'grain',animated=True)
files['pack.mcmeta']=json.dumps({'pack':{'pack_format':1,'description':'Chromebox Lite 8x | Simple blocks + static effects | 1.8'}},indent=2).encode()
files['assets/minecraft/textures/gui/title/background/enable_blur.txt']=b'enable_blur=0\n'
# Original pack icon and a contact sheet, scaled with nearest-neighbor pixels.
icon=[]
for y in range(64):
    for x in range(64): icon.append((99,174,105,255) if 12<=x<52 and 12<=y<27 else ((139,101,66,255) if 12<=x<52 and 27<=y<52 else (26,36,44,255)))
files['pack.png']=png(64,64,icon)
# A trusted, unpacked bundle avoids shipping a ZIP parser in the game loader.
# Only this original artwork is published; no client/game assets are copied.
payload = {name: base64.b64encode(data).decode('ascii') for name, data in sorted(files.items())}
revision = hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()
bundle = {'format': 1, 'folder': 'agent-console-chromebox-lite-8x',
          'name': 'Chromebox Lite 8x', 'revision': revision, 'files': payload}
loader = ROOT.parent.parent / 'eaglercraft' / 'loader'
(loader / 'chromebox-lite.js').write_text('// Generated by resource-packs/chromebox-lite/build.py. Original artwork only.\n'
    + 'window.__eaglerBundledPack = ' + json.dumps(bundle, separators=(',', ':')) + ';\n')
files['README.txt']=(ROOT/'README.md').read_bytes()
archive=ROOT/'Chromebox-Lite-8x-1.8.zip'
with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED,compresslevel=9) as z:
    for name,data in sorted(files.items()):
        info=zipfile.ZipInfo(name,(2026,10,9,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED
        z.writestr(info,data)
# 12-column preview of every replacement, labels supplied in a matching index.
names=list(textures);cols=12;cell=48;rows=(len(names)+cols-1)//cols
pixels=[]
for y in range(rows*cell):
    for x in range(cols*cell):
        i=(y//cell)*cols+x//cell;px=x%cell;py=y%cell
        v=(26,36,44,255)
        if i<len(names) and 4<=px<44 and 4<=py<44:
            t=textures[names[i]][((py-4)//5)*8+(px-4)//5]
            a=t[3]/255;v=tuple(round(t[k]*a+v[k]*(1-a)) for k in range(3))+(255,)
        pixels.append(v)
(ROOT/'preview.png').write_bytes(png(cols*cell,rows*cell,pixels))
(ROOT/'preview-index.txt').write_text('\n'.join(' | '.join(names[i:i+cols]) for i in range(0,len(names),cols))+'\n')
with zipfile.ZipFile(archive) as z:
    assert z.testzip() is None
    assert json.loads(z.read('pack.mcmeta'))['pack']['pack_format']==1
    for n in z.namelist():
        if n.endswith('.png'):
            b=z.read(n);assert b[:8]==b'\x89PNG\r\n\x1a\n'
            w,h=struct.unpack('>II',b[16:24]);assert w==h and w in (8,64)
        if n.endswith('.mcmeta'):json.loads(z.read(n))
print(f'{archive}\n{len(textures)} block textures; {archive.stat().st_size:,} bytes; ZIP integrity and metadata passed.')
