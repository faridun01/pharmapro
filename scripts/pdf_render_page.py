import base64
import json
import sys


def _load_payload() -> dict:
    raw = sys.stdin.read().strip()
    if not raw:
        raise ValueError('missing payload')
    return json.loads(raw)


def main() -> int:
    try:
        payload = _load_payload()
        pdf_base64 = str(payload.get('pdfBase64') or '').strip()
        if not pdf_base64:
            raise ValueError('pdfBase64 is required')

        import fitz  # type: ignore

        document = fitz.open(stream=base64.b64decode(pdf_base64), filetype='pdf')
        if document.page_count == 0:
            raise ValueError('PDF has no pages')

        page = document.load_page(0)
        pix = page.get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False)
        image_base64 = base64.b64encode(pix.tobytes('png')).decode('ascii')
        document.close()

        sys.stdout.write(json.dumps({
            'imageBase64': image_base64,
            'mimeType': 'image/png',
            'pageCount': 1,
        }, ensure_ascii=True))
        return 0
    except Exception as exc:
        sys.stderr.write(str(exc))
        return 1


if __name__ == '__main__':
    raise SystemExit(main())