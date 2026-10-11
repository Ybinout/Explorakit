"""Import fidèle du catalogue Excel, sans dépendance Python externe.

python3 scripts/importDriftCatalogue.py [--check]
Le classeur reste la référence ; les cellules vides ne deviennent jamais zéro.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import xml.etree.ElementTree as ET
import zipfile

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'vue-explorakit/catalogue_drifts_pokemon.xlsx'
DESTINATION = ROOT / 'data/game/drifts.json'
NS = {'s': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
RARITIES = ['common', 'rare', 'epic', 'legendary', 'mythic']


def read_rows(archive, name, strings):
    rows = []
    for row in ET.fromstring(archive.read(name)).findall('.//s:sheetData/s:row', NS):
        cells = {}
        for cell in row.findall('s:c', NS):
            column = re.match(r'[A-Z]+', cell.attrib['r'])[0]
            value = cell.find('s:v', NS)
            text = value.text if value is not None else ''
            if cell.attrib.get('t') == 's':
                text = strings[int(text)]
            elif cell.attrib.get('t') == 'inlineStr':
                text = ''.join(cell.find('s:is', NS).itertext())
            cells[column] = text
        rows.append(cells)
    return rows


def catalogue():
    with zipfile.ZipFile(SOURCE) as archive:
        strings = []
        if 'xl/sharedStrings.xml' in archive.namelist():
            strings = [''.join(cell.itertext()) for cell in ET.fromstring(archive.read('xl/sharedStrings.xml')).findall('s:si', NS)]
        rows = read_rows(archive, 'xl/worksheets/sheet1.xml', strings)
        rules = read_rows(archive, 'xl/worksheets/sheet2.xml', strings)
    assert rows[0]['A'] == 'ID' and rows[0]['C'] == 'Drift', 'Structure du catalogue inattendue'
    definitions = []
    for row in rows[1:]:
        if not row.get('A'):
            continue
        values = {}
        for rarity, column in zip(RARITIES, 'GHIJK'):
            raw = row.get(column, '')
            value = float(raw) if raw else None
            values[rarity] = int(value) if value is not None and value.is_integer() else value
        definitions.append(dict(id=row['A'], category=row['B'], name=row['C'], description=row['D'],
                                stat=row['E'], unit=row['F'], values=values, rule=row.get('L', '')))
    rarities = [dict(key=key, name=row['A'], proposedDropPercent=int(row['B']), weight=int(row['C']),
                    colorName=row['D'], description=row['E']) for key, row in zip(RARITIES, rules[1:6])]
    assert len(definitions) == 59 and len({entry['id'] for entry in definitions}) == 59
    assert sum(row['weight'] for row in rarities) == 10000
    return dict(version=1, source=dict(path=str(SOURCE.relative_to(ROOT)), sha256=hashlib.sha256(SOURCE.read_bytes()).hexdigest()),
                rarities=rarities, definitions=definitions,
                workbookRules=[row for row in rules[6:] if row.get('A')])


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true', help='Vérifie le JSON sans écrire')
    args = parser.parse_args()
    result = json.dumps(catalogue(), ensure_ascii=False, indent=2) + '\n'
    if args.check:
        if not DESTINATION.exists() or DESTINATION.read_text(encoding='utf-8') != result:
            raise SystemExit('Catalogue JSON différent du classeur : relancer l’import.')
        print('Catalogue conforme au classeur : 59 Drifts, 5 raretés, 280 variantes disponibles.')
    else:
        DESTINATION.write_text(result, encoding='utf-8')
        print(f'Catalogue importé : {DESTINATION.relative_to(ROOT)}')
