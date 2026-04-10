from __future__ import annotations

import argparse
import json
import logging
import math
import re
import sys
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Iterable, Sequence

import pandas as pd


LOGGER = logging.getLogger("document_import_pipeline")


DEFAULT_COLUMN_ALIASES: dict[str, tuple[str, ...]] = {
    "invoice_number": ("invoice", "invoice_no", "invoice_number", "номернакладной", "документ", "номердокумента"),
    "supplier_name": ("supplier", "supplier_name", "vendor", "vendor_name", "поставщик", "контрагент"),
    "invoice_date": ("invoice_date", "date", "document_date", "дата", "датанакладной"),
    "name": ("name", "product", "product_name", "item", "товар", "наименование", "номенклатура"),
    "sku": ("sku", "article", "code", "артикул", "код", "кодтовара"),
    "barcode": ("barcode", "ean", "штрихкод", "штрих-код"),
    "quantity": ("qty", "quantity", "количество", "колво", "кол-во"),
    "cost_price": ("cost", "cost_price", "unit_price", "price", "цена", "ценазаед", "закупочнаяцена"),
    "unit": ("unit", "ед", "единица", "unit_name"),
    "box_quantity": ("box_qty", "units_per_box", "quantity_per_box", "вупаковке", "вкоробке", "коробка"),
    "box_price": ("box_price", "line_total", "amount", "total", "сумма", "итого"),
    "expiry_date": ("expiry", "expiry_date", "expiration_date", "срокгодности", "годендо"),
    "batch_number": ("batch", "batch_number", "lot", "серия", "партия"),
}

DEFAULT_SHEET_HINTS = ("invoice", "наклад", "прайс", "price", "товар", "лист")


@dataclass(slots=True)
class ParseWarning:
    message: str
    row_index: int | None = None
    field_name: str | None = None


@dataclass(slots=True)
class ParsedRow:
    source: str
    row_index: int
    raw_values: dict[str, Any]
    name: str = ""
    sku: str = ""
    barcode: str = ""
    quantity: float = 0.0
    cost_price: float = 0.0
    unit: str = ""
    box_quantity: float = 0.0
    box_price: float = 0.0
    expiry_date: str = ""
    batch_number: str = ""
    warnings: list[str] = field(default_factory=list)
    status: str = "CHECK"
    needs_review: bool = True
    expected_box_price: float = 0.0
    delta: float = 0.0


@dataclass(slots=True)
class NormalizedDocument:
    invoice_number: str
    supplier_name: str
    invoice_date: str
    items: list[ParsedRow]
    raw_text: str
    warnings: list[ParseWarning]


@dataclass(slots=True)
class ImportPreview:
    document: NormalizedDocument
    preview_rows: list[dict[str, Any]]
    dataframe: pd.DataFrame
    warnings: list[dict[str, Any]]


def configure_logging(level: int = logging.INFO) -> None:
    if logging.getLogger().handlers:
        return
    logging.basicConfig(level=level, format="%(asctime)s %(levelname)s %(name)s %(message)s")


def normalize_text(value: Any) -> str:
    text = str(value or "")
    text = text.replace("\u00a0", " ")
    text = text.replace("«", '"').replace("»", '"')
    text = text.replace("“", '"').replace("”", '"')
    text = text.replace("‘", "'").replace("’", "'")
    text = text.replace("\r", " ").replace("\n", " ")
    text = re.sub(r"\s+", " ", text)
    return text.strip(" ,;:")


def normalize_key(value: Any) -> str:
    text = normalize_text(value).lower()
    text = (
        text.replace("қ", "к")
        .replace("ҳ", "х")
        .replace("ғ", "г")
        .replace("ҷ", "ж")
        .replace("ӯ", "у")
        .replace("ӣ", "и")
        .replace("ё", "е")
    )
    return re.sub(r"[^a-z0-9а-я]+", "", text)


def safe_float(value: Any) -> tuple[float | None, bool]:
    if value is None:
        return None, False
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        if isinstance(value, float) and (math.isnan(value) or math.isinf(value)):
            return None, False
        return float(value), True

    text = normalize_text(value)
    if not text:
        return None, False

    candidate = text.replace(" ", "")
    candidate = re.sub(r"[^0-9,.-]", "", candidate)
    if not candidate:
        return None, False

    if "," in candidate and "." in candidate:
        if candidate.rfind(",") > candidate.rfind("."):
            candidate = candidate.replace(".", "").replace(",", ".")
        else:
            candidate = candidate.replace(",", "")
    elif candidate.count(",") == 1 and candidate.count(".") == 0:
        candidate = candidate.replace(",", ".")
    elif candidate.count(",") > 1 and candidate.count(".") == 0:
        candidate = candidate.replace(",", "")
    elif candidate.count(".") > 1 and candidate.count(",") == 0:
        candidate = candidate.replace(".", "")

    try:
        return float(candidate), True
    except ValueError:
        return None, False


def safe_date(value: Any) -> tuple[str, bool]:
    if value is None:
        return "", False

    if isinstance(value, pd.Timestamp):
        return value.strftime("%Y-%m-%d"), True

    text = normalize_text(value)
    if not text:
        return "", False

    patterns = [
        (r"^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$", lambda m: f"{'20' + m.group(3) if len(m.group(3)) == 2 else m.group(3)}-{m.group(2).zfill(2)}-{m.group(1).zfill(2)}"),
        (r"^(\d{4})-(\d{2})-(\d{2})$", lambda m: m.group(0)),
    ]

    for pattern, builder in patterns:
        match = re.match(pattern, text)
        if match:
            return builder(match), True

    parsed = pd.to_datetime(text, errors="coerce", dayfirst=True)
    if pd.isna(parsed):
        return text, False
    return parsed.strftime("%Y-%m-%d"), True


def merge_aliases(base_aliases: dict[str, tuple[str, ...]], supplier_aliases: dict[str, Sequence[str]] | None = None) -> dict[str, tuple[str, ...]]:
    merged = dict(base_aliases)
    if not supplier_aliases:
        return merged
    for key, aliases in supplier_aliases.items():
        existing = merged.get(key, ())
        merged[key] = tuple(dict.fromkeys([*existing, *aliases]))
    return merged


def detect_sheet_name(excel_file: Path, sheet_hints: Sequence[str] | None = None) -> str:
    sheet_hints = sheet_hints or DEFAULT_SHEET_HINTS
    workbook = pd.ExcelFile(excel_file)
    normalized_hints = [normalize_key(hint) for hint in sheet_hints]
    scored: list[tuple[int, str]] = []
    for sheet_name in workbook.sheet_names:
        normalized_sheet = normalize_key(sheet_name)
        score = sum(1 for hint in normalized_hints if hint and hint in normalized_sheet)
        scored.append((score, sheet_name))
    scored.sort(key=lambda item: (-item[0], item[1]))
    return scored[0][1]


def build_column_mapping(columns: Sequence[str], aliases: dict[str, tuple[str, ...]]) -> dict[str, str]:
    normalized_columns = {normalize_key(column): str(column) for column in columns}
    mapping: dict[str, str] = {}
    for target_field, field_aliases in aliases.items():
        for alias in field_aliases:
            normalized_alias = normalize_key(alias)
            matched_key = next((key for key in normalized_columns if normalized_alias and normalized_alias in key), None)
            if matched_key:
                mapping[target_field] = normalized_columns[matched_key]
                break
    return mapping


def merge_multiline_names(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    merged: list[dict[str, Any]] = []
    for row in rows:
        name = normalize_text(row.get("name"))
        has_numeric_content = any(safe_float(row.get(field))[0] is not None for field in ("quantity", "cost_price", "box_quantity", "box_price"))

        if merged and name and not has_numeric_content:
            merged[-1]["name"] = normalize_text(f"{merged[-1].get('name', '')} {name}")
            merged[-1].setdefault("raw_multiline_parts", []).append(dict(row))
            continue

        next_row = dict(row)
        next_row["name"] = name
        merged.append(next_row)
    return merged


def parse_excel_file(
    excel_file: str | Path,
    supplier_aliases: dict[str, Sequence[str]] | None = None,
    sheet_name: str | None = None,
) -> dict[str, Any]:
    excel_path = Path(excel_file)
    aliases = merge_aliases(DEFAULT_COLUMN_ALIASES, supplier_aliases)
    selected_sheet = sheet_name or detect_sheet_name(excel_path)
    LOGGER.info("Parsing Excel file %s sheet=%s", excel_path, selected_sheet)

    dataframe = pd.read_excel(excel_path, sheet_name=selected_sheet, dtype=object)
    dataframe = dataframe.dropna(how="all")
    dataframe.columns = [normalize_text(column) or f"column_{index}" for index, column in enumerate(dataframe.columns)]

    column_mapping = build_column_mapping(dataframe.columns, aliases)
    LOGGER.info("Excel column mapping: %s", column_mapping)

    metadata = {
        "invoice_number": "",
        "supplier_name": "",
        "invoice_date": "",
    }

    rows: list[dict[str, Any]] = []
    warnings: list[ParseWarning] = []
    for row_index, record in enumerate(dataframe.to_dict(orient="records"), start=1):
        normalized_record = {normalize_text(key): value for key, value in record.items()}
        parsed_row = {"row_index": row_index, "raw_values": normalized_record}
        for metadata_field in ("invoice_number", "supplier_name", "invoice_date"):
            source_column = column_mapping.get(metadata_field)
            if source_column and not metadata[metadata_field]:
                metadata[metadata_field] = normalize_text(normalized_record.get(source_column))

        for target_field in ("name", "sku", "barcode", "quantity", "cost_price", "unit", "box_quantity", "box_price", "expiry_date", "batch_number"):
            source_column = column_mapping.get(target_field)
            parsed_row[target_field] = normalized_record.get(source_column) if source_column else ""
        rows.append(parsed_row)

    if not rows:
        warnings.append(ParseWarning(message="Excel file contains no usable rows"))

    return {
        "source": "excel",
        "sheet_name": selected_sheet,
        "metadata": metadata,
        "rows": merge_multiline_names(rows),
        "warnings": warnings,
    }


def _run_camelot(path: Path, flavor: str) -> list[pd.DataFrame]:
    import camelot  # type: ignore

    tables = camelot.read_pdf(str(path), pages="all", flavor=flavor)
    return [table.df for table in tables]


def _score_table(dataframe: pd.DataFrame) -> int:
    if dataframe.empty:
        return 0
    sample = " ".join(normalize_text(value) for value in dataframe.head(5).to_numpy().flatten())
    hits = 0
    for aliases in DEFAULT_COLUMN_ALIASES.values():
        if any(normalize_key(alias) in normalize_key(sample) for alias in aliases):
            hits += 1
    return hits


def dataframe_to_rows(dataframe: pd.DataFrame) -> list[dict[str, Any]]:
    if dataframe.empty:
      return []
    working = dataframe.fillna("").copy()
    header_index = 0
    best_score = -1
    for index in range(min(len(working), 5)):
        score = _score_table(pd.DataFrame([working.iloc[index].tolist()]))
        if score > best_score:
            best_score = score
            header_index = index

    header_values = [normalize_text(value) or f"column_{position}" for position, value in enumerate(working.iloc[header_index].tolist())]
    body = working.iloc[header_index + 1 :].copy()
    body.columns = header_values
    body = body.dropna(how="all")
    return merge_multiline_names([
        {
            "row_index": row_index,
            "raw_values": record,
            **record,
        }
        for row_index, record in enumerate(body.to_dict(orient="records"), start=1)
    ])


def parse_pdf_with_camelot(pdf_file: str | Path) -> dict[str, Any]:
    pdf_path = Path(pdf_file)
    LOGGER.info("Parsing PDF with Camelot %s", pdf_path)
    warnings: list[ParseWarning] = []
    tables: list[pd.DataFrame] = []
    flavor_used = "lattice"

    try:
        tables = _run_camelot(pdf_path, "lattice")
        if not any(_score_table(table) >= 2 for table in tables):
            tables = _run_camelot(pdf_path, "stream")
            flavor_used = "stream"
    except Exception as exc:
        warnings.append(ParseWarning(message=f"Camelot lattice failed: {exc}"))
        tables = _run_camelot(pdf_path, "stream")
        flavor_used = "stream"

    rows: list[dict[str, Any]] = []
    for table in tables:
        rows.extend(dataframe_to_rows(table))

    return {
        "source": "pdf-camelot",
        "flavor": flavor_used,
        "metadata": extract_pdf_metadata(pdf_path),
        "rows": rows,
        "warnings": warnings,
    }


def parse_pdf_with_pdfplumber(pdf_file: str | Path) -> dict[str, Any]:
    import pdfplumber  # type: ignore

    pdf_path = Path(pdf_file)
    LOGGER.info("Parsing PDF with pdfplumber %s", pdf_path)
    warnings: list[ParseWarning] = []
    rows: list[dict[str, Any]] = []
    raw_lines: list[str] = []

    with pdfplumber.open(str(pdf_path)) as pdf:
        for page_number, page in enumerate(pdf.pages, start=1):
            raw_text = page.extract_text() or ""
            if raw_text:
                raw_lines.extend(raw_text.splitlines())
            page_tables = page.extract_tables() or []
            for table in page_tables:
                if not table:
                    continue
                frame = pd.DataFrame(table)
                rows.extend(dataframe_to_rows(frame))

    if not rows:
        for index, line in enumerate(raw_lines, start=1):
            normalized_line = normalize_text(line)
            if not normalized_line:
                continue
            if len(re.findall(r"\d+[.,]?\d*", normalized_line)) < 2:
                continue
            cells = [part for part in re.split(r"\s{2,}|\|", normalized_line) if normalize_text(part)]
            if len(cells) < 2:
                continue
            rows.append({
                "row_index": index,
                "raw_values": {f"column_{position}": cell for position, cell in enumerate(cells)},
                "name": cells[0],
                "quantity": cells[-3] if len(cells) >= 3 else "",
                "cost_price": cells[-2] if len(cells) >= 2 else "",
                "box_price": cells[-1] if len(cells) >= 1 else "",
            })

    if not rows:
        warnings.append(ParseWarning(message="pdfplumber did not find structured rows"))

    return {
        "source": "pdf-pdfplumber",
        "metadata": extract_pdf_metadata(pdf_path),
        "rows": merge_multiline_names(rows),
        "warnings": warnings,
        "raw_text": "\n".join(raw_lines),
    }


def extract_pdf_metadata(pdf_file: str | Path) -> dict[str, str]:
    import pdfplumber  # type: ignore

    pdf_path = Path(pdf_file)
    raw_text = ""
    with pdfplumber.open(str(pdf_path)) as pdf:
        for page in pdf.pages[:2]:
            raw_text += "\n" + (page.extract_text() or "")

    invoice_number = ""
    supplier_name = ""
    invoice_date = ""
    for line in raw_text.splitlines()[:30]:
        normalized_line = normalize_text(line)
        if not normalized_line:
            continue
        if not invoice_number:
            match = re.search(r"(?:invoice|накладная|счет|фактура)\s*[№#]?\s*([A-Za-zА-Яа-я0-9\/-]{2,30})", normalized_line, flags=re.IGNORECASE)
            if match:
                invoice_number = normalize_text(match.group(1))
        if not invoice_date:
            parsed_date, ok = safe_date(normalized_line)
            if ok:
                invoice_date = parsed_date
        if not supplier_name:
            match = re.search(r"(?:supplier|поставщик|vendor)\s*[:\-]?\s*(.+)", normalized_line, flags=re.IGNORECASE)
            if match:
                supplier_name = normalize_text(match.group(1))
    return {
        "invoice_number": invoice_number,
        "supplier_name": supplier_name,
        "invoice_date": invoice_date,
    }


def normalize_rows(parsed_rows: Sequence[dict[str, Any]], source: str) -> tuple[list[ParsedRow], list[ParseWarning]]:
    warnings: list[ParseWarning] = []
    normalized_rows: list[ParsedRow] = []

    for row in parsed_rows:
        row_index = int(row.get("row_index") or len(normalized_rows) + 1)
        raw_values = dict(row.get("raw_values") or row)
        name = normalize_text(row.get("name"))
        sku = normalize_text(row.get("sku"))
        barcode = normalize_text(row.get("barcode"))
        unit = normalize_text(row.get("unit"))
        batch_number = normalize_text(row.get("batch_number"))
        expiry_date, expiry_ok = safe_date(row.get("expiry_date"))
        quantity, quantity_ok = safe_float(row.get("quantity"))
        cost_price, cost_ok = safe_float(row.get("cost_price"))
        box_quantity, box_quantity_ok = safe_float(row.get("box_quantity"))
        box_price, box_price_ok = safe_float(row.get("box_price"))

        parsed = ParsedRow(
            source=source,
            row_index=row_index,
            raw_values=raw_values,
            name=name,
            sku=sku,
            barcode=barcode,
            quantity=quantity or 0.0,
            cost_price=cost_price or 0.0,
            unit=unit,
            box_quantity=box_quantity or 0.0,
            box_price=box_price or 0.0,
            expiry_date=expiry_date,
            batch_number=batch_number,
        )

        if not name:
            parsed.warnings.append("Missing product name")
        if quantity is None:
            parsed.warnings.append("Quantity could not be parsed")
        elif not quantity_ok:
            parsed.warnings.append("Quantity preserved from uncertain value")
        if cost_price is None:
            parsed.warnings.append("Cost price could not be parsed")
        elif not cost_ok:
            parsed.warnings.append("Cost price preserved from uncertain value")
        if row.get("expiry_date") and not expiry_ok:
            parsed.warnings.append("Expiry date preserved from uncertain value")
        if row.get("box_quantity") and not box_quantity_ok:
            parsed.warnings.append("Box quantity preserved from uncertain value")
        if row.get("box_price") and not box_price_ok:
            parsed.warnings.append("Box price preserved from uncertain value")

        normalized_rows.append(parsed)

    if not normalized_rows:
        warnings.append(ParseWarning(message="No normalized rows produced"))

    return normalized_rows, warnings


def validate_rows(rows: Sequence[ParsedRow]) -> tuple[list[ParsedRow], list[ParseWarning]]:
    warnings: list[ParseWarning] = []

    for row in rows:
        row.expected_box_price = round((row.cost_price or 0.0) * (row.box_quantity or 0.0), 2)
        if row.box_price and row.expected_box_price:
            row.delta = round(row.box_price - row.expected_box_price, 2)
        else:
            row.delta = 0.0

        if row.quantity < 1:
            row.warnings.append("Quantity must be >= 1")
        if row.cost_price <= 0:
            row.warnings.append("Cost price must be numeric and > 0")
        if row.box_price and row.expected_box_price and abs(row.delta) > 0.01:
            row.warnings.append(f"Box price mismatch delta={row.delta:.2f}")

        row.status = "OK" if not row.warnings else "CHECK"
        row.needs_review = row.status != "OK"

        if row.warnings:
            warnings.extend(ParseWarning(message=message, row_index=row.row_index) for message in row.warnings)

    return list(rows), warnings


def convert_to_internal_format(metadata: dict[str, str], rows: Sequence[ParsedRow], warnings: Sequence[ParseWarning], raw_text: str = "") -> NormalizedDocument:
    invoice_date, _ = safe_date(metadata.get("invoice_date"))
    return NormalizedDocument(
        invoice_number=normalize_text(metadata.get("invoice_number")),
        supplier_name=normalize_text(metadata.get("supplier_name")),
        invoice_date=invoice_date,
        items=list(rows),
        raw_text=raw_text,
        warnings=list(warnings),
    )


def import_preview(document: NormalizedDocument) -> ImportPreview:
    preview_rows = []
    for row in document.items:
        preview_rows.append(
            {
                "row_index": row.row_index,
                "name": row.name,
                "sku": row.sku,
                "barcode": row.barcode,
                "quantity": row.quantity,
                "costPrice": row.cost_price,
                "unit": row.unit,
                "boxQuantity": row.box_quantity,
                "boxPrice": row.box_price,
                "expectedBoxPrice": row.expected_box_price,
                "delta": row.delta,
                "expiryDate": row.expiry_date,
                "batchNumber": row.batch_number,
                "status": row.status,
                "needsReview": row.needs_review,
                "warnings": "; ".join(row.warnings),
            }
        )
    dataframe = pd.DataFrame(preview_rows)
    return ImportPreview(
        document=document,
        preview_rows=preview_rows,
        dataframe=dataframe,
        warnings=[asdict(warning) for warning in document.warnings],
    )


def prepare_for_database(document: NormalizedDocument) -> dict[str, Any]:
    return {
        "invoiceNumber": document.invoice_number,
        "supplierName": document.supplier_name,
        "invoiceDate": document.invoice_date,
        "items": [
            {
                "name": row.name,
                "sku": row.sku,
                "barcode": row.barcode,
                "quantity": max(1, int(round(row.quantity or 0))),
                "costPrice": round(row.cost_price, 2),
                "unit": row.unit,
                "boxQuantity": int(round(row.box_quantity or 0)) if row.box_quantity else 0,
                "boxPrice": round(row.box_price, 2) if row.box_price else 0.0,
                "expiryDate": row.expiry_date,
                "batchNumber": row.batch_number,
                "status": row.status,
                "needsReview": row.needs_review,
                "warnings": row.warnings,
            }
            for row in document.items
        ],
        "warnings": [asdict(warning) for warning in document.warnings],
    }


def export_preview_to_excel(preview: ImportPreview, output_file: str | Path) -> Path:
    output_path = Path(output_file)
    preview.dataframe.to_excel(output_path, index=False)
    return output_path


def parse_document(file_path: str | Path, supplier_aliases: dict[str, Sequence[str]] | None = None) -> dict[str, Any]:
    path = Path(file_path)
    suffix = path.suffix.lower()
    if suffix in {".xlsx", ".xls"}:
        return parse_excel_file(path, supplier_aliases=supplier_aliases)
    if suffix == ".pdf":
        camelot_warnings: list[ParseWarning] = []
        try:
            camelot_result = parse_pdf_with_camelot(path)
            if camelot_result["rows"]:
                return camelot_result
            LOGGER.info("Camelot returned no rows, falling back to pdfplumber")
            camelot_warnings = list(camelot_result["warnings"])
        except Exception as exc:
            LOGGER.warning("Camelot parsing failed for %s: %s", path, exc)
            camelot_warnings.append(ParseWarning(message=f"Camelot failed: {exc}"))

        fallback = parse_pdf_with_pdfplumber(path)
        fallback["warnings"] = [*camelot_warnings, *fallback["warnings"]]
        return fallback
    raise ValueError(f"Unsupported file type: {suffix}")


def build_import_preview(file_path: str | Path, supplier_aliases: dict[str, Sequence[str]] | None = None) -> ImportPreview:
    parsed = parse_document(file_path, supplier_aliases=supplier_aliases)
    normalized_rows, normalization_warnings = normalize_rows(parsed["rows"], parsed["source"])
    validated_rows, validation_warnings = validate_rows(normalized_rows)
    document = convert_to_internal_format(
        metadata=parsed.get("metadata", {}),
        rows=validated_rows,
        warnings=[*parsed.get("warnings", []), *normalization_warnings, *validation_warnings],
        raw_text=parsed.get("raw_text", ""),
    )
    return import_preview(document)


def _load_supplier_aliases(json_path: str | None) -> dict[str, Sequence[str]] | None:
    if not json_path:
        return None
    data = json.loads(Path(json_path).read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ValueError("Supplier alias file must be a JSON object")
    return {str(key): list(value) for key, value in data.items()}


def _build_argument_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Preview document import from Excel or text-based PDF")
    parser.add_argument("file", help="Path to Excel or PDF file")
    parser.add_argument("--supplier-aliases", help="Path to JSON file with supplier-specific column aliases")
    parser.add_argument("--export-preview", help="Optional path to export preview rows as Excel")
    parser.add_argument("--json-output", action="store_true", help="Print database-ready JSON")
    return parser


def configure_stdio() -> None:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8")


def main() -> int:
    configure_stdio()
    configure_logging()
    parser = _build_argument_parser()
    args = parser.parse_args()
    try:
        supplier_aliases = _load_supplier_aliases(args.supplier_aliases)
        preview = build_import_preview(args.file, supplier_aliases=supplier_aliases)
        if args.export_preview:
            export_preview_to_excel(preview, args.export_preview)
            LOGGER.info("Preview exported to %s", args.export_preview)

        if args.json_output:
            print(json.dumps(prepare_for_database(preview.document), ensure_ascii=False, indent=2))
        else:
            output = {
                "invoiceNumber": preview.document.invoice_number,
                "supplierName": preview.document.supplier_name,
                "invoiceDate": preview.document.invoice_date,
                "previewRows": preview.preview_rows,
                "warnings": preview.warnings,
            }
            print(json.dumps(output, ensure_ascii=False, indent=2))
        return 0
    except Exception as exc:
        LOGGER.exception("Import preview failed")
        print(json.dumps({"error": str(exc)}), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())