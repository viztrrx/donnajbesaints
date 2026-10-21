"""Original minimalist artwork; normalized 16-unit shapes, no sampled game art."""
TRANSPARENT = (0, 0, 0, 0)
STONE = (143, 150, 151)
DIRT = (143, 105, 76)
GREEN = (101, 153, 87)
WHITE = (239, 238, 225)
DARK = (53, 61, 66)
WOOD = {'oak': (185, 146, 93), 'spruce': (120, 92, 64), 'birch': (222, 209, 157),
        'jungle': (179, 131, 102), 'acacia': (193, 110, 75), 'big_oak': (98, 72, 53)}
COLORS = {'white': WHITE, 'orange': (223, 137, 67), 'magenta': (179, 102, 170),
          'light_blue': (120, 183, 210), 'yellow': (234, 204, 89), 'lime': (153, 191, 83),
          'pink': (226, 158, 172), 'gray': (81, 88, 94), 'silver': (174, 183, 183),
          'cyan': (70, 157, 167), 'purple': (137, 100, 172), 'blue': (85, 112, 183),
          'brown': (125, 91, 68), 'green': (107, 139, 67), 'red': (193, 81, 73), 'black': (47, 51, 58)}
ORES = {'coal': DARK, 'iron': (220, 175, 142), 'gold': (241, 204, 87),
        'diamond': (104, 213, 206), 'emerald': (91, 193, 130), 'redstone': (215, 80, 69),
        'lapis': (85, 122, 194), 'quartz': WHITE}
FLOWERS = {'allium': (187, 133, 203), 'blue_orchid': (123, 188, 222),
           'dandelion': (241, 210, 95), 'houstonia': (230, 237, 244),
           'oxeye_daisy': WHITE, 'paeonia': (229, 161, 188), 'rose': (216, 85, 88),
           'tulip_orange': COLORS['orange'], 'tulip_pink': COLORS['pink'],
           'tulip_red': COLORS['red'], 'tulip_white': WHITE}

def rgba(c): return tuple(c) if len(c) == 4 else tuple(c) + (255,)
def shade(c, amount): return tuple(max(0, min(255, v + amount)) for v in c[:3]) + (rgba(c)[3],)

class Canvas:
    def __init__(self, color=TRANSPARENT, size=8):
        self.size = size
        self.pixels = [rgba(color)] * (size * size)
    def rect(self, x, y, w, h, color):
        # Shape coordinates use a 16-unit grid even for 8px tiles.
        x0, y0 = round(x * self.size / 16), round(y * self.size / 16)
        x1, y1 = round((x+w) * self.size / 16), round((y+h) * self.size / 16)
        for yy in range(max(0,y0), min(self.size,y1)):
            for xx in range(max(0,x0), min(self.size,x1)):
                self.pixels[yy*self.size+xx] = rgba(color)
        return self
    def line(self, x0, y0, x1, y1, color, width=1):
        steps = int(max(abs(x1-x0),abs(y1-y0))) or 1
        for i in range(steps+1):
            t=i/steps;self.rect(round(x0+(x1-x0)*t),round(y0+(y1-y0)*t),width,width,color)
        return self
    def frame(self, x, y, w, h, color, width=2):
        return self.rect(x,y,w,width,color).rect(x,y+h-width,w,width,color).rect(x,y,width,h,color).rect(x+w-width,y,width,h,color)
    def diamond(self, x, y, radius, color):
        for dy in range(-radius, radius+1):
            self.rect(x-radius+abs(dy),y+dy,2*(radius-abs(dy))+1,1,color)
        return self

def panel(c, dark=None):
    return Canvas(c).frame(0,0,16,16,dark or shade(c,-18))

def brick(c, moss=False, cracked=False):
    a=Canvas(c).rect(0,6,16,2,shade(c,-23)).rect(0,14,16,2,shade(c,-23))
    a.rect(6,0,2,6,shade(c,-23)).rect(12,8,2,6,shade(c,-23))
    if moss:a.rect(0,0,4,2,(109,142,94)).rect(10,8,4,2,(109,142,94))
    if cracked:a.line(2,0,4,4,shade(c,-35),2)
    return a

def stem(a, top=6, tint=False):
    c=(181,181,181) if tint else GREEN
    a.rect(7,top,2,16-top,c).rect(4,10,3,2,c).rect(9,12,3,2,c)
    return a

def blossom(kind, tall=False):
    c=FLOWERS[kind];a=Canvas(size=16);stem(a,6)
    if 'tulip' in kind:
        a.rect(5,3,6,5,c).rect(5,2,2,2,c).rect(9,2,2,2,c)
    elif kind=='blue_orchid':
        a.rect(3,4,5,3,c).rect(9,2,4,3,c).rect(7,6,5,2,shade(c,-22))
    elif kind in ('allium','paeonia'):
        a.diamond(8,4,4,c).rect(7,3,3,2,shade(c,16))
    elif kind=='rose':
        a.rect(5,2,6,6,c).rect(7,4,4,2,shade(c,-23))
    else:
        a.rect(4,3,8,4,c).rect(6,1,4,8,c).rect(7,4,2,2,(230,188,64))
    return a

def foliage(name):
    a=Canvas(size=16)
    if name.startswith('flower_') and name!='flower_pot':return blossom(name[7:])
    if name.startswith('sapling_'):
        kind=name[8:];stem(a,8)
        if kind=='spruce':
            a.rect(5,7,6,4,GREEN).rect(3,10,10,2,GREEN).rect(7,2,2,5,GREEN)
        elif kind=='birch':a.diamond(8,6,4,(141,176,101))
        elif kind=='jungle':a.rect(2,5,12,5,(94,149,87)).rect(4,3,8,2,(94,149,87))
        elif kind=='acacia':a.rect(1,5,14,3,(123,163,94))
        elif kind=='roofed_oak':a.rect(3,3,10,8,(80,131,83))
        else:a.diamond(8,6,5,GREEN)
        a.rect(7,11,2,5,(130,98,65));return a
    if name.startswith('double_plant_'):
        part=name[13:];kind,_,half=part.rpartition('_')
        if kind=='sunflower' and half in ('front','back'):
            a.diamond(8,8,7,(235,201,83) if half=='front' else GREEN)
            if half=='front':a.rect(5,5,6,6,(112,81,53))
            return a
        if half=='bottom':return stem(a,0,kind in ('grass','fern'))
        if kind in ('grass','fern'):return foliage('fern' if kind=='fern' else 'tallgrass')
        if kind=='sunflower':return stem(a,0).rect(5,4,6,5,GREEN)
        if kind=='syringa':
            stem(a,3);a.rect(5,3,6,8,(168,130,195)).rect(7,1,2,2,(168,130,195));return a
        return blossom('rose' if kind=='rose' else 'paeonia')
    if name.startswith(('wheat_stage_','carrots_stage_','potatoes_stage_','nether_wart_stage_')):
        crop=name.split('_stage_')[0];stage=int(name[-1]);max_stage=7 if crop=='wheat' else (2 if crop=='nether_wart' else 3)
        height=3+round(stage/max_stage*10);color=(171,188,105) if crop=='wheat' else GREEN
        for x in (3,7,11):
            a.rect(x,16-height,2,height,color)
            a.rect(x-2,16-height+2,2,2,color).rect(x+2,16-height+4,2,2,color)
            if stage==max_stage:
                if crop=='wheat':a.rect(x-1,16-height,4,5,(230,195,99))
                elif crop=='carrots':a.rect(x,13,2,3,COLORS['orange'])
                elif crop=='potatoes':a.rect(x,13,3,3,(190,160,106))
            if crop=='nether_wart':
                a.rect(x-1,16-height,4,4,(179,69,74));a.rect(x,16-height+4,2,height-4,(114,47,58))
        return a
    if name.startswith('cocoa_stage_'):
        stage=int(name[-1]);a.rect(7,0,2,4,GREEN);w=4+stage*2
        return a.rect(8-w/2,4,w,4+stage*3,[(151,159,72),(187,131,62),(132,83,47)][stage])
    if name.startswith(('melon_stem_','pumpkin_stem_')):
        a.rect(7,6,2,10,(182,182,182))
        if name.endswith('connected'):a.rect(8,5,8,2,(182,182,182))
        else:a.rect(5,5,6,2,(182,182,182))
        return a
    if name in ('tallgrass','fern','deadbush'):
        c=(183,183,183) if name!='deadbush' else (151,113,71)
        if name=='fern':
            a.line(8,3,8,15,c,1)
            for y in (5,8,11):a.line(8,y+2,3,y,c,1).line(8,y+2,13,y,c,1)
        else:
            for x,y in ((3,8),(6,3),(9,6),(12,5)):a.line(8,15,x,y,c,1)
        return a
    if name in ('mushroom_brown','mushroom_red'):
        a.rect(7,8,2,8,WHITE);c=(174,130,94) if name.endswith('brown') else COLORS['red']
        a.rect(3,5,10,5,c).rect(5,3,6,2,c)
        if name.endswith('red'):a.rect(5,6,2,2,WHITE).rect(9,4,2,2,WHITE)
        return a
    if name=='reeds':
        for x,y in ((3,3),(7,0),(11,5)):a.rect(x,y,2,16-y,GREEN).rect(x,y+5,2,1,shade(GREEN,-25))
        return a
    if name=='vine':
        c=(185,185,185)
        a.line(3,0,3,16,c).line(10,0,10,16,c)
        for x,y in ((3,3),(10,7),(3,11)):a.rect(x-2,y,5,3,c)
        return a
    if name=='waterlily':
        return a.rect(2,4,12,8,(182,182,182)).rect(4,2,8,12,(182,182,182)).rect(8,10,6,4,TRANSPARENT)
    return None

def block(name):
    plant=foliage(name)
    if plant:return plant
    basic={'stone':STONE,'dirt':DIRT,'coarse_dirt':(129,96,73),'grass_top':(190,190,190),
           'sand':(228,214,165),'red_sand':(198,119,75),'gravel':(165,161,153),
           'clay':(159,177,187),'snow':(235,244,247),'ice':(148,191,214,165),
           'ice_packed':(148,186,209),'netherrack':(133,76,76),'end_stone':(219,220,169),
           'obsidian':(58,46,77),'hardened_clay':(171,113,85),'mycelium_top':(153,135,153),
           'dirt_podzol_top':(125,98,64),'prismarine_rough':(107,174,164),'prismarine_dark':(63,117,106),
           'dragon_egg':(39,31,52),'slime':(144,193,109,180)}
    if name in basic:return Canvas(basic[name])
    if name=='bedrock':return Canvas((68,76,82)).rect(0,4,10,2,(91,99,105)).rect(6,12,10,2,(91,99,105))
    if name=='soul_sand':return Canvas((117,91,72)).rect(2,4,2,2,DARK).rect(6,4,2,2,DARK).rect(4,8,4,2,DARK)
    if name.startswith('stone_') and not name.startswith('stone_slab'):
        c={'granite':(184,139,121),'andesite':(152,161,152),'diorite':(207,211,201)}[name.split('_')[1]]
        return panel(c) if name.endswith('_smooth') else Canvas(c)
    if name in ('grass_side','grass_side_overlay','grass_side_snowed','mycelium_side','dirt_podzol_side'):
        overlay=name=='grass_side_overlay';a=Canvas(TRANSPARENT if overlay else DIRT)
        c=(GREEN if name=='grass_side' else (190,190,190)) if name in ('grass_side','grass_side_overlay') else (WHITE if name.endswith('snowed') else ((153,135,153) if name=='mycelium_side' else (125,98,64)))
        return a.rect(0,0,16,4,c)
    if name in ('sponge','sponge_wet'):
        c=(215,205,110) if name=='sponge' else (162,176,91)
        return Canvas(c).rect(2,2,2,2,shade(c,-32)).rect(10,10,4,2,shade(c,-32))
    if name.startswith(('cobblestone','stonebrick')) or name in ('brick','nether_brick','prismarine_bricks'):
        c=(155,160,157) if name.startswith('cobblestone') else ((151,157,159) if name.startswith('stonebrick') else {'brick':(189,111,94),'nether_brick':(80,47,59),'prismarine_bricks':(120,185,172)}[name])
        if name=='stonebrick_carved':return panel(c).frame(4,4,8,8,shade(c,-32)).rect(6,6,4,4,c)
        return brick(c,'mossy' in name,'cracked' in name)
    if name.startswith('planks_'):
        c=WOOD[name[7:]];return Canvas(c).rect(0,6,16,2,shade(c,-21)).rect(0,14,16,2,shade(c,-21)).rect(6,0,2,6,shade(c,-12)).rect(12,8,2,6,shade(c,-12))
    if name.startswith('log_'):
        top=name.endswith('_top');wood=name[4:-4] if top else name[4:];c=WOOD[wood]
        if top:return Canvas(c).frame(0,0,16,16,shade(c,-30)).frame(4,4,8,8,shade(c,-20))
        c=(228,229,213) if wood=='birch' else ((134,139,139) if wood=='acacia' else shade(c,-34))
        if wood=='birch':return Canvas(c).rect(0,4,6,2,DARK).rect(10,12,6,2,DARK)
        return Canvas(c).rect(4,0,2,16,shade(c,-17)).rect(12,0,2,16,shade(c,-17))
    if name.startswith('leaves_'):
        # All six names are tinted by the game's leaf color multiplier.
        return Canvas((192,192,192)).rect(4,6,8,2,(179,179,179))
    if name.endswith('_ore'):
        mineral=name[:-4];a=Canvas((133,76,76) if mineral=='quartz' else STONE)
        c=ORES[mineral];a.rect(2,2,4,4,c).rect(10,8,4,4,c)
        if mineral=='coal':a.rect(4,10,2,2,c)
        return a
    if name.endswith('_block') and name[:-6] in ORES:return panel(ORES[name[:-6]])
    if name.startswith('wool_colored_'):return Canvas(COLORS[name[13:]])
    if name.startswith('hardened_clay_stained_'):
        c=COLORS[name[22:]];return Canvas(tuple((v*2+b)//3 for v,b in zip(c,(168,115,91))))
    if name.startswith('glass'):
        c=(204,225,231) if name in ('glass','glass_pane_top') else COLORS[name.replace('glass_pane_top_','').replace('glass_','')]
        if 'pane_top' in name:return Canvas(c)
        return Canvas().frame(0,0,16,16,c).rect(4,4,2,2,rgba(shade(c,10)))
    if name.startswith(('sandstone_','red_sandstone_')):
        c=(222,210,167) if name.startswith('sandstone_') else (198,121,77)
        kind=name.rsplit('_',1)[1]
        if kind=='carved':return Canvas(c).frame(4,4,8,8,shade(c,-25)).rect(6,6,4,4,c)
        if kind=='normal':return Canvas(c).rect(0,6,16,2,shade(c,-17)).rect(0,14,16,2,shade(c,-17))
        return Canvas(shade(c,-10) if kind=='bottom' else c)
    if name.startswith('quartz_block_'):
        c=WHITE;a=Canvas(c)
        if 'chiseled' in name:return a.frame(2,2,12,12,shade(c,-29)).frame(6,6,4,4,shade(c,-29))
        if 'lines' in name:return a.frame(2,2,12,12,shade(c,-20)) if name.endswith('_top') else a.rect(4,0,2,16,shade(c,-20)).rect(12,0,2,16,shade(c,-20))
        return panel(c) if name.endswith('side') else a
    if name in ('glowstone','sea_lantern','redstone_lamp_on','redstone_lamp_off'):
        c={'glowstone':(234,199,112),'sea_lantern':(208,233,224),'redstone_lamp_on':(236,193,104),'redstone_lamp_off':(127,93,64)}[name]
        return panel(c).rect(6,2,2,12,shade(c,15)).rect(2,6,12,2,shade(c,15))
    if name.startswith(('water_','lava_')):
        c=(134,182,208,190) if name.startswith('water_') else (236,123,49)
        # Flow textures retain 2x tile width; single square frame.
        return Canvas(c,16 if name.endswith('flow') else 8)
    if name=='portal':return panel((137,96,178,200),(110,78,151,200))
    if name.startswith('fire_layer_'):
        a=Canvas(size=16)
        for x,y in ((0,8),(3,4),(6,9),(9,2),(12,6)):a.rect(x,y,3,16-y,(239,133,51)).rect(x+1,y+5,1,11-y,(247,205,105))
        return a
    if name.startswith('destroy_stage_'):
        stage=int(name[-1]);a=Canvas(size=16);c=(45,50,53,180)
        for i,(x0,y0,x1,y1) in enumerate([(7,0,8,5),(8,5,4,9),(4,9,5,15),(8,5,12,9),(12,9,15,10),(4,9,0,7),(12,9,10,15),(8,5,13,2),(4,9,2,13),(8,5,7,11)]):
            if i<=stage:a.line(x0,y0,x1,y1,c)
        return a
    if name in ('farmland_dry','farmland_wet'):
        c=DIRT if name.endswith('dry') else (112,86,64)
        a=Canvas(c)
        for x in (2,6,10,14):a.rect(x,0,2,16,shade(c,-14))
        return a
    if name.startswith('cactus_'):
        a=Canvas((103,157,95))
        return a.frame(2,2,12,12,shade(GREEN,-23)) if name.endswith(('top','bottom')) else a.rect(4,0,2,16,shade(GREEN,-23)).rect(12,0,2,16,shade(GREEN,-23))
    if name.startswith('mushroom_block_'):
        part=name[15:];c={'inside':(216,200,175),'skin_brown':(178,137,105),'skin_red':COLORS['red'],'skin_stem':(224,214,185)}[part];a=Canvas(c)
        if part=='skin_red':a.rect(2,2,4,4,WHITE).rect(10,10,4,4,WHITE)
        if part=='skin_stem':a.rect(6,0,2,16,shade(c,-17))
        return a
    if name.startswith(('melon_','pumpkin_')):
        pumpkin=name.startswith('pumpkin');c=(217,148,65) if pumpkin else (151,184,100)
        a=Canvas(c)
        if 'face' in name:
            eye=(247,211,107) if name.endswith('on') else (108,73,39)
            return a.rect(2,4,4,4,eye).rect(10,4,4,4,eye).rect(4,10,8,2,eye)
        if name.endswith('top'):return a.rect(6,6,4,4,(112,136,74))
        return a.rect(4,0,2,16,shade(c,-19)).rect(12,0,2,16,shade(c,-19))
    if name.startswith('hay_block_'):
        a=Canvas((214,189,113))
        return a.frame(2,2,12,12,(187,160,87)) if name.endswith('top') else a.rect(0,2,16,2,(177,91,67)).rect(0,12,16,2,(177,91,67))
    if name.startswith('bed_'):
        a=Canvas(COLORS['red'])
        if name.endswith('top'):
            if 'head' in name:a.rect(0,0,16,6,WHITE)
        else:a.rect(0,8,16,6,WOOD['oak']).rect(4,12,8,4,TRANSPARENT)
        return a
    if name=='bookshelf':
        a=Canvas(WOOD['oak']).rect(0,6,16,2,shade(WOOD['oak'],-25)).rect(0,14,16,2,shade(WOOD['oak'],-25))
        for y in (0,8):
            for x,c in [(0,COLORS['red']),(4,COLORS['blue']),(8,COLORS['green']),(12,COLORS['yellow'])]:a.rect(x,y,2,6,c)
        return a
    if name.startswith('crafting_table_'):
        a=panel(WOOD['oak'])
        if name.endswith('top'):
            for x in (4,8):a.rect(x,2,2,10,shade(WOOD['oak'],-40)).rect(2,x,10,2,shade(WOOD['oak'],-40))
        else:a.rect(4,4,2,8,DARK).rect(8,4,4,2,DARK).rect(10,6,2,6,DARK)
        return a
    if name.startswith('furnace_'):
        a=panel(STONE)
        if 'front' in name:a.rect(4,4,8,2,DARK).rect(2,10,12,4,(235,162,63) if name.endswith('on') else DARK)
        return a
    if name.startswith(('dispenser_front_','dropper_front_')):
        a=panel(STONE);a.rect(4,4,8,8,DARK)
        if name.startswith('dispenser'):a.rect(6,6,4,4,(78,88,92))
        else:a.rect(6,6,4,4,STONE)
        return a
    if name.startswith('door_'):
        half=name.rsplit('_',1)[1];kind=name[5:-(len(half)+1)]
        c=(194,204,204) if kind=='iron' else WOOD[{'wood':'oak','dark_oak':'big_oak'}.get(kind,kind)]
        a=panel(c)
        if half=='upper':
            if kind in ('wood','birch','iron'):a.rect(4,4,8,6,TRANSPARENT).rect(6,4,2,6,c)
            else:a.frame(4,4,8,8,shade(c,-29))
        else:a.frame(4,2,8,12,shade(c,-25)).rect(12,4,2,2,(231,201,111))
        return a
    if name in ('trapdoor','iron_trapdoor'):
        c=WOOD['oak'] if name=='trapdoor' else (190,200,201);a=panel(c)
        for x,y in ((4,4),(10,4),(4,10),(10,10)):a.rect(x,y,2,2,TRANSPARENT)
        return a
    if name=='ladder':
        a=Canvas(size=16).rect(3,0,2,16,WOOD['oak']).rect(11,0,2,16,WOOD['oak'])
        for y in (2,6,10,14):a.rect(3,y,10,2,WOOD['oak'])
        return a
    if name=='iron_bars':
        a=Canvas(size=16)
        for x in (2,7,12):a.rect(x,0,1,16,(190,201,204))
        return a.rect(0,4,16,1,(190,201,204)).rect(0,11,16,1,(190,201,204))
    if name.startswith('rail_'):
        a=Canvas(size=16);gold='golden' in name;c=ORES['gold'] if gold else (194,204,204)
        if name=='rail_normal_turned':return a.line(0,4,6,4,c,2).line(6,4,10,8,c,2).line(10,8,10,15,c,2).line(0,10,3,10,c,2).line(3,10,4,12,c,2).line(4,12,4,15,c,2)
        for y in (2,7,12):a.rect(2,y,12,2,WOOD['spruce'])
        a.rect(3,0,2,16,c).rect(11,0,2,16,c)
        if name!='rail_normal':a.rect(7,3,2,10,COLORS['red'] if name.endswith('powered') else (122,111,94))
        return a
    if name.startswith('redstone_dust_'):
        a=Canvas(size=16)
        if name.endswith('overlay'):return a  # no decorative dust; main line retains state tint
        a.rect(7,0,2,16,(210,210,210))
        if 'cross' in name:a.rect(0,7,16,2,(210,210,210))
        return a
    if name in ('torch_on','redstone_torch_on','redstone_torch_off','lever'):
        a=Canvas(size=16).rect(7,5,2,11,WOOD['oak'])
        if name=='lever':return a.rect(6,1,4,5,STONE)
        c=(245,205,111) if name=='torch_on' else (COLORS['red'] if name.endswith('on') else (119,69,60))
        return a.rect(6,1,4,5,c)
    if name.startswith(('comparator_','repeater_')):
        a=Canvas((207,208,196));c=COLORS['red'] if name.endswith('on') else (134,79,68)
        return a.rect(7,0,2,16,c).rect(3,5,3,3,c).rect(10,5,3,3,c).rect(7,11,2,2,c)
    if name.startswith('daylight_detector_'):
        if name.endswith('side'):return Canvas(WOOD['oak']).rect(0,0,16,4,(191,190,173))
        c=(111,141,165) if 'inverted' in name else (204,188,141);a=Canvas(WOOD['oak'])
        for x in (2,6,10):
            for y in (2,6,10):a.rect(x,y,2,2,c)
        return a
    if name.startswith('piston_'):
        a=panel(STONE)
        if 'top' in name:a.rect(2,2,12,12,(126,174,90) if name.endswith('sticky') else WOOD['oak'])
        elif name.endswith('side'):a.rect(0,0,16,6,WOOD['oak'])
        elif name.endswith('inner'):a.rect(6,0,4,16,WOOD['oak'])
        return a
    if name.startswith('hopper_') or name.startswith('cauldron_'):
        c=(84,97,105);a=Canvas(c)
        if name.endswith(('top','inside','inner')):return a.frame(0,0,16,16,(114,127,134)).rect(4,4,8,8,(57,65,72))
        if name.endswith('side'):return a.rect(2,2,12,2,(114,127,134)).rect(4,12,8,4,TRANSPARENT)
        return a
    if name.startswith('anvil_'):
        a=Canvas((102,111,117));damage=int(name[-1]) if 'damaged' in name else 0
        a.frame(0,0,16,16,(82,91,97))
        if damage:a.line(7,0,8,9,DARK,2)
        if damage==2:a.line(8,9,12,13,DARK,2)
        return a
    if name.startswith('cake_'):
        a=Canvas((211,164,114))
        if name.endswith('top'):a=Canvas(WHITE).rect(4,4,2,2,COLORS['red']).rect(10,10,2,2,COLORS['red'])
        elif name.endswith('side'):a.rect(0,0,16,6,WHITE)
        elif name.endswith('inner'):a=Canvas((223,197,157)).rect(0,0,16,4,WHITE)
        return a
    if name.startswith('tnt_'):
        a=Canvas((202,87,71))
        if name.endswith('side'):
            a.rect(0,4,16,8,WHITE)
            # Tiny original TNT lettering on a clean band.
            for x in (0,10):a.rect(x,6,6,2,DARK).rect(x+2,8,2,2,DARK)
            a.rect(6,6,2,4,DARK)
        else:a.frame(2,2,12,12,(161,70,61))
        return a
    if name.startswith('enchanting_table_'):
        a=Canvas((60,49,77))
        if name.endswith('top'):a.frame(0,0,16,16,COLORS['red']).rect(6,6,4,4,ORES['diamond'])
        elif name.endswith('side'):a.rect(0,0,16,4,COLORS['red']).rect(4,8,2,4,ORES['diamond']).rect(10,8,2,4,ORES['diamond'])
        return a
    if name.startswith('endframe_'):
        a=Canvas((147,163,125))
        if name.endswith('eye'):return Canvas().rect(2,4,12,8,(72,143,137)).rect(7,4,2,8,DARK)
        if name.endswith('top'):a.frame(2,2,12,12,(87,107,88)).rect(6,6,4,4,DARK)
        else:a.rect(0,0,16,4,(204,210,164))
        return a
    if name.startswith(('jukebox_','noteblock')):
        a=panel(WOOD['spruce'])
        if name.endswith('top'):return a.rect(4,6,8,2,DARK)
        return a.rect(4,4,8,8,(92,69,53)).rect(6,6,4,4,(135,104,76))
    if name=='brewing_stand':return Canvas(size=16).rect(7,0,2,14,ORES['gold']).rect(1,12,14,2,ORES['gold']).rect(1,8,2,6,STONE).rect(13,8,2,6,STONE)
    if name=='brewing_stand_base':return panel(STONE)
    if name=='flower_pot':return Canvas((185,120,89)).rect(0,0,16,4,shade((185,120,89),-23))
    if name=='beacon':return Canvas((198,228,225)).frame(0,0,16,16,WHITE)
    if name=='command_block':return panel((199,166,130)).rect(4,4,8,8,(152,116,86)).rect(6,6,4,4,COLORS['red'])
    if name=='mob_spawner':
        a=Canvas(size=16)
        for x in (0,5,10,15):a.rect(x,0,1,16,DARK).rect(0,x,16,1,DARK)
        return a
    if name=='web':
        a=Canvas(size=16);c=(217,226,227,255)
        a.line(0,0,15,15,c).line(0,15,15,0,c).rect(0,7,16,1,c).rect(7,0,1,16,c)
        return a.frame(3,3,10,10,c,1)
    if name=='trip_wire':return Canvas(size=16).rect(0,7,16,1,(167,178,182))
    if name=='trip_wire_source':return Canvas(size=16).rect(6,0,4,10,STONE).frame(4,8,8,6,STONE,2)
    if name=='itemframe_background':return panel(WOOD['oak'])
    if name.startswith('stone_slab_'):return Canvas(STONE).rect(0,0,16,2,shade(STONE,20)) if name.endswith('side') else panel(STONE)
    raise ValueError('No original design for ' + name)

def particles():
    # Minecraft 1.8's UV grid is 16x16 cells. Each cell is reduced from 8px to
    # 4px without moving its UV region. Distinct useful feedback stays visible.
    a=Canvas(size=64)
    def px(x,y,c):a.pixels[y*64+x]=rgba(c)
    for tile in range(256):
        x0=(tile%16)*4;y0=(tile//16)*4
        for y in range(4):
            for x in range(4):
                show=False;c=WHITE
                if 0<=tile<=7: # smoke stages: decreasing clean square
                    r=2 if tile<4 else 1;show=abs(x-1.5)<r and abs(y-1.5)<r;c=(220,225,226,140)
                elif tile in (16,17,18,19,20,21,22,23,24):show=x==1 or y==1;c=(244,202,95)
                elif tile in (32,33):show=(x in (0,3) or y in (0,3));c=(194,228,238)
                elif tile in (34,35,36,37,38,39):show=abs(x-1.5)+abs(y-1.5)<=2;c=(238,235,211)
                elif tile==48:show=(y>0 and x in (1,2)) or (y==3);c=(242,176,73)
                elif tile==49:show=y>=1 and x in (1,2);c=(231,126,62)
                elif tile==64:show=(x==2 and y<3) or (y==3 and x in (0,1)) or (y==0 and x==3)
                elif tile in (65,66):show=(x==1 or y==1);c=WHITE
                elif tile==80:show=(y==0 and x in (0,2)) or y==1 or (y==2 and x in (1,2)) or (y==3 and x==1);c=(218,115,113)
                elif tile in (81,82):show=(x==1 or y==1);c=(218,218,218)
                elif tile in (96,97,98,99,100,101):show=abs(x-1.5)+abs(y-1.5)<=2;c=(235,137,62)
                elif tile in (112,113,114,115):show=y>=1 and x in (1,2);c=(209,223,233)
                elif tile in (128,129,130,131,132):show=x in (1,2) and y in (1,2);c=(228,232,220)
                else:show=x in (1,2) and y in (1,2);c=(228,232,220,170)
                if show:px(x0+x,y0+y,c)
    return a
