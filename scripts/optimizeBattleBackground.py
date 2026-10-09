from pathlib import Path
from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "vue-explorakit" / "src" / "assets" / "back.png"
DESTINATION = ROOT / "vue-explorakit" / "src" / "assets" / "battle" / "back.webp"


def main() -> None:
    DESTINATION.parent.mkdir(parents=True, exist_ok=True)
    with Image.open(SOURCE) as image:
        image.save(DESTINATION, "WEBP", quality=82, method=6)

    source_size = SOURCE.stat().st_size
    output_size = DESTINATION.stat().st_size
    reduction = 100 * (1 - output_size / source_size)
    print(f"{SOURCE.name}: {source_size} octets")
    print(f"{DESTINATION.name}: {output_size} octets ({reduction:.1f}% de reduction)")


if __name__ == "__main__":
    main()
