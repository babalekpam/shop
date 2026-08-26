#!/usr/bin/env python3
"""
Convert a prospection workbook into the normalised JSON the importer reads.

    python3 tools/convert-prospects.py <workbook.xlsx> <out.json>

Stdlib only — no openpyxl, no pandas, nothing to review.

The output contains personal data (facility directors, mobile numbers) and is written to
`data/`, which is gitignored. **Do not commit it.** Personal data in version control is
replicated to every clone and every fork, and unlike a leaked secret it cannot be rotated.
Security spec §9 says secrets never enter the repository; the same reasoning applies here,
with the added problem that the people concerned did not choose to be in it.
"""
import json, re, sys, zipfile
from xml.etree import ElementTree as ET

NS = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
R = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}'

# Workbook column -> our field. Extend here when the next list has different headings.
COLUMNS = {
    'N°': 'ref',
    'Nom de la formation sanitaire': 'name',
    'Segment': 'segment',
    'Tier': 'tier',
    'Score prospection': 'score',
    'Type de propriétaire': 'ownerType',
    'Téléphone': 'phone',
    'Téléphone 2': 'phone2',
    'Email': 'email',
    'Confiance téléphone': 'phoneConfidence',
    'Source téléphone': 'phoneSource',
    'Ville / agglomération': 'city',
    'District sanitaire': 'district',
    'Région': 'region',
    'Statut agrément': 'licenceStatus',
    'Jours avant expiration': 'daysToExpiry',
    # Kept for the human call sheet only. The importer never maps it into a contact.
    'Contact / dirigeant': 'director',
}

def load(path):
    z = zipfile.ZipFile(path)
    shared = []
    if 'xl/sharedStrings.xml' in z.namelist():
        for si in ET.fromstring(z.read('xl/sharedStrings.xml')).findall(f'{NS}si'):
            shared.append(''.join(t.text or '' for t in si.iter(f'{NS}t')))

    rels = {r.get('Id'): 'xl/' + r.get('Target').lstrip('/').replace('xl/', '')
            for r in ET.fromstring(z.read('xl/_rels/workbook.xml.rels'))}
    sheets = [(s.get('name'), rels[s.get(f'{R}id')])
              for s in ET.fromstring(z.read('xl/workbook.xml')).iter(f'{NS}sheet')]

    def col(ref):
        n = 0
        for ch in re.match(r'([A-Z]+)', ref).group(1):
            n = n * 26 + (ord(ch) - 64)
        return n - 1

    def rows_of(part):
        out = []
        for row in ET.fromstring(z.read(part)).iter(f'{NS}row'):
            cells = {}
            for c in row.findall(f'{NS}c'):
                v, t = c.find(f'{NS}v'), c.get('t')
                inline = c.find(f'{NS}is')
                if t == 's' and v is not None:
                    val = shared[int(v.text)]
                elif t == 'inlineStr' and inline is not None:
                    val = ''.join(x.text or '' for x in inline.iter(f'{NS}t'))
                else:
                    val = v.text if v is not None else ''
                if val:
                    cells[col(c.get('r'))] = val
            if cells:
                out.append([cells.get(i, '') for i in range(max(cells) + 1)])
        return out

    return dict(sheets), rows_of

def main():
    if len(sys.argv) < 3:
        sys.exit(__doc__)
    sheets, rows_of = load(sys.argv[1])

    # The full list is the source of truth; the other sheets are filtered views of it.
    part = sheets.get('Liste complète') or next(iter(sheets.values()))
    rows = rows_of(part)

    header_idx = next(i for i, r in enumerate(rows) if 'Tier' in r)
    header = rows[header_idx]
    index = {h: i for i, h in enumerate(header)}

    records = []
    for raw in rows[header_idx + 1:]:
        def cell(name):
            i = index.get(name)
            return (raw[i] if i is not None and i < len(raw) else '') or ''
        if not cell('Nom de la formation sanitaire'):
            continue
        record = {}
        for source, field in COLUMNS.items():
            record[field] = cell(source).strip()
        for numeric in ('score', 'daysToExpiry'):
            try:
                record[numeric] = int(float(record[numeric]))
            except (ValueError, TypeError):
                record[numeric] = None if numeric == 'daysToExpiry' else 0
        records.append(record)

    with open(sys.argv[2], 'w', encoding='utf8') as fh:
        json.dump(records, fh, ensure_ascii=False, indent=2)
    print(f'{len(records)} records -> {sys.argv[2]}')

if __name__ == '__main__':
    main()
