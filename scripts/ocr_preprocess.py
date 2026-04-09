import base64
import io
import json
import sys

from PIL import Image, ImageEnhance, ImageFilter, ImageOps


def _load_payload() -> dict:
    raw = sys.stdin.read().strip()
    if not raw:
        raise ValueError('missing payload')
    return json.loads(raw)


def _preprocess_image(image_bytes: bytes) -> tuple[bytes, int, int]:
    with Image.open(io.BytesIO(image_bytes)) as source:
        image = ImageOps.exif_transpose(source)
        image = image.convert('L')

        width, height = image.size
        target_width = max(width, 1800)
        if width > 0 and target_width != width:
            target_height = max(1, round(height * (target_width / width)))
            image = image.resize((target_width, target_height), Image.Resampling.LANCZOS)

        image = ImageOps.autocontrast(image, cutoff=1)
        image = ImageEnhance.Contrast(image).enhance(1.45)
        image = image.filter(ImageFilter.MedianFilter(size=3))
        image = image.filter(ImageFilter.SHARPEN)

        threshold = image.point(lambda pixel: 255 if pixel > 168 else 0, mode='1')
        final_image = threshold.convert('L')

        output = io.BytesIO()
        final_image.save(output, format='PNG', optimize=True)
        return output.getvalue(), final_image.size[0], final_image.size[1]


def main() -> int:
    try:
        payload = _load_payload()
        image_base64 = str(payload.get('imageBase64') or '').strip()
        if not image_base64:
            raise ValueError('imageBase64 is required')

        image_bytes = base64.b64decode(image_base64)
        processed_bytes, width, height = _preprocess_image(image_bytes)

        result = {
            'imageBase64': base64.b64encode(processed_bytes).decode('ascii'),
            'mimeType': 'image/png',
            'width': width,
            'height': height,
        }
        sys.stdout.write(json.dumps(result, ensure_ascii=True))
        return 0
    except Exception as exc:
        sys.stderr.write(str(exc))
        return 1


if __name__ == '__main__':
    raise SystemExit(main())