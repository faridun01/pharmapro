import base64
import json
import os
import re
import sys
import tempfile


ALIASES = {
    'name': ['наименование', 'товар', 'product', 'name', 'номенклатура'],
    'unit': ['ед', 'едизм', 'unit', 'measure', 'единица'],
    'quantity': ['кол', 'колво', 'количество', 'qty', 'quantity'],
    'pricePerUnit': ['цена', 'ценаед', 'unitprice', 'price', 'priceperunit'],
    'unitsPerBox': ['вкоробке', 'вупаковке', 'коробка', 'упаковка', 'unitsperbox'],
    'boxPrice': ['сумма', 'итого', 'boxprice', 'total', 'amount'],
}


def _load_payload() -> dict:
    raw = sys.stdin.read().strip()
    if not raw:
        raise ValueError('missing payload')
    return json.loads(raw)


def _normalize_header(value: str) -> str:
    return re.sub(r'[\s_\-./\\()]+', '', str(value or '').strip().lower())


def _normalize_text(value: str) -> str:
    return re.sub(r'\s+', ' ', str(value or '').replace('«', '"').replace('»', '"')).strip()


def _looks_header(row: list[str]) -> bool:
    normalized = [_normalize_header(cell) for cell in row]
    hits = 0
    for aliases in ALIASES.values():
        for alias in aliases:
            alias_norm = _normalize_header(alias)
            if any(alias_norm and alias_norm in cell for cell in normalized):
                hits += 1
                break
    return hits >= 2


def _build_header_map(row: list[str]) -> dict[str, int]:
    mapping: dict[str, int] = {}
    normalized = [_normalize_header(cell) for cell in row]
    for field, aliases in ALIASES.items():
      for index, cell in enumerate(normalized):
        if any(_normalize_header(alias) and _normalize_header(alias) in cell for alias in aliases):
          mapping[field] = index
          break
    return mapping


def _extract_numeric_cells(cells: list[str]) -> list[str]:
    return [cell for cell in cells if re.search(r'\d', cell)]


def _map_row(cells: list[str], header_map: dict[str, int]) -> dict:
    values = {_field: '' for _field in ALIASES.keys()}

    for field, index in header_map.items():
        if 0 <= index < len(cells):
            values[field] = cells[index]

    if not values['name']:
        text_cells = [cell for cell in cells if cell and not re.fullmatch(r'[\d\s.,]+', cell)]
        if text_cells:
            values['name'] = text_cells[0]

    numeric_cells = _extract_numeric_cells(cells)
    if not values['quantity'] and numeric_cells:
        values['quantity'] = numeric_cells[0]
    if not values['pricePerUnit'] and len(numeric_cells) >= 2:
        values['pricePerUnit'] = numeric_cells[-2]
    if not values['boxPrice'] and numeric_cells:
        values['boxPrice'] = numeric_cells[-1]
    if not values['unitsPerBox'] and len(numeric_cells) >= 3:
        values['unitsPerBox'] = numeric_cells[-3]

    return {
        'name': _normalize_text(values['name']),
        'unit': _normalize_text(values['unit']),
        'quantity': _normalize_text(values['quantity']),
        'pricePerUnit': _normalize_text(values['pricePerUnit']),
        'unitsPerBox': _normalize_text(values['unitsPerBox']),
        'boxPrice': _normalize_text(values['boxPrice']),
        'rawCells': [_normalize_text(cell) for cell in cells],
    }


def _extract_with_camelot(pdf_path: str, flavor: str):
    import camelot  # type: ignore

    tables = camelot.read_pdf(pdf_path, pages='all', flavor=flavor)
    rows = []
    for table_index, table in enumerate(tables):
        df = table.df.fillna('')
        header_map: dict[str, int] = {}
        header_consumed = False
        for row_index in range(len(df)):
            cells = [_normalize_text(value) for value in df.iloc[row_index].tolist()]
            if not any(cells):
                continue
            if not header_consumed and _looks_header(cells):
                header_map = _build_header_map(cells)
                header_consumed = True
                continue
            mapped = _map_row(cells, header_map)
            if not mapped['name'] and not any(mapped[field] for field in ['quantity', 'pricePerUnit', 'unitsPerBox', 'boxPrice']):
                continue
            mapped['sourceTable'] = table_index
            rows.append(mapped)
    return tables, rows


def main() -> int:
    temp_path = None
    try:
        payload = _load_payload()
        pdf_base64 = str(payload.get('pdfBase64') or '').strip()
        if not pdf_base64:
            raise ValueError('pdfBase64 is required')

        pdf_bytes = base64.b64decode(pdf_base64)
        with tempfile.NamedTemporaryFile(delete=False, suffix='.pdf') as handle:
            handle.write(pdf_bytes)
            temp_path = handle.name

        try:
            tables, rows = _extract_with_camelot(temp_path, 'lattice')
            flavor = 'lattice'
            if not rows:
                tables, rows = _extract_with_camelot(temp_path, 'stream')
                flavor = 'stream'
        except Exception:
            tables, rows = _extract_with_camelot(temp_path, 'stream')
            flavor = 'stream'

        result = {
            'flavor': flavor,
            'tableCount': len(tables),
            'rows': rows,
            'rawTableText': '\n'.join(' | '.join(row.get('rawCells', [])) for row in rows),
            'issues': [],
        }
        sys.stdout.write(json.dumps(result, ensure_ascii=True))
        return 0
    except Exception as exc:
        sys.stderr.write(str(exc))
        return 1
    finally:
        if temp_path and os.path.exists(temp_path):
            try:
                os.unlink(temp_path)
            except OSError:
                pass


if __name__ == '__main__':
    raise SystemExit(main())