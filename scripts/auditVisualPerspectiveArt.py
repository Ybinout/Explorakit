"""Check pixel invariants of the visual hotfix; requires Pillow like existing art scripts."""
from pathlib import Path
from PIL import Image
import json
root = Path(__file__).resolve().parents[1]
assets = root / 'vue-explorakit/src/assets'
old = Image.open(assets / 'housing/furniture-rotations-v2.png').convert('RGBA')
new = Image.open(assets / 'housing/furniture-rotations-v3.png').convert('RGBA')
assert old.size == new.size == (256, 1408)
metrics = json.loads((root / 'vue-explorakit/src/data/housingArt.json').read_text())
changed = {0, 1, 2, 4, 5, 10, 12, 14, 15, 17, 20, 21}
checks = []
for row in range(22):
    for face in range(4):
        box = (face*64, row*64, (face+1)*64, (row+1)*64)
        a, b = old.crop(box), new.crop(box)
        if face in (0, 2) or row not in changed:
            assert a.tobytes() == b.tobytes(), (row, face, 'protected view changed')
        else:
            assert a.tobytes() != b.tobytes(), (row, face, 'side missing')
        w, h = (metrics['orientations'][row][face][v] for v in ('w', 'h'))
        bounds = b.getchannel('A').getbbox()
        assert bounds and bounds[0] >= (64-w)//2 and bounds[2] <= (64-w)//2+w
        assert bounds[1] >= 64-h and bounds[3] == 64
checks.append('88 cells checked: 24 new sides; all 44 fronts/rears and all bed cells byte-identical')
for row in (2,15):
    assert metrics['orientations'][row][1] == metrics['orientations'][row][3] == {'w':28,'h':52}
checks.append('Both sofa sides span their three-tile depth with identical anchors')
slot = Image.open(assets / 'casino/slot-cabinet-v3.png')
assert slot.size == (48,68)
assert set(slot.getchannel('A').getdata()) <= {0,255}
server=json.loads((root/'data/game/casino_slots.json').read_text())
client=json.loads((root/'vue-explorakit/src/data/casinoSlots.json').read_text())
assert server == client
assert [m['y'] for m in server['machines']] == [8,12]
assert server['visualOffset'] == {'x':12,'y':0}
checks.append('Cabinet clean RGBA alpha; two lower physical footprints and shared client/server placement')
print(json.dumps({'success':True,'checks':checks},ensure_ascii=False,indent=2))
