#!/usr/bin/env python3
"""Збирає сайт із тек плагінів.

Джерело правди — теки `plugins/<slug>/`:
    plugins/<slug>/<slug>.js   сам плагін (обов'язково)
    plugins/<slug>/README.md   назва (H1) і опис (перший абзац)
    plugins/<slug>/...         будь-які ресурси: значки, шрифти, json

Що робить:
  * `_site/`            — готовий сайт: index.html, plugins.json, <slug>.js у корені
                          (щоб посилання для Lampa було коротким) і plugins/<slug>/… з ресурсами;
  * `README.md`         — список плагінів з описами.

Запуск:
    python3 tools/build.py            # зібрати _site і оновити README.md
    python3 tools/build.py --no-readme
Локальний перегляд:  python3 tools/build.py && python3 -m http.server -d _site 8731
"""
import argparse
import datetime as dt
import json
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PLUGINS = ROOT / "plugins"
SITE = ROOT / "_site"


def parse_readme(path: Path) -> dict:
    """H1 → назва, перший абзац після нього → опис, YAML-подібний front matter → решта полів."""
    meta: dict = {"name": None, "description": "", "hidden": False}
    if not path.is_file():
        return meta
    lines = path.read_text(encoding="utf-8").splitlines()

    body_start = 0
    if lines and lines[0].strip() == "---":
        for i in range(1, len(lines)):
            if lines[i].strip() == "---":
                body_start = i + 1
                break
            key, _, val = lines[i].partition(":")
            key, val = key.strip(), val.strip().strip("\"'")
            if key in ("version", "author"):
                meta[key] = val
            elif key == "hidden":
                meta["hidden"] = val.lower() in ("true", "yes", "1")
            elif key == "name":
                meta["name"] = val
    body = lines[body_start:]

    for line in body:
        if line.startswith("# "):
            meta["name"] = line[2:].strip()
            body = body[body.index(line) + 1:]
            break

    para = []
    for line in body:
        stripped = line.strip()
        if not stripped:
            if para:
                break
            continue
        if stripped.startswith(("#", "-", "`", ">", "|")):
            if para:
                break
            continue
        para.append(stripped)
    meta["description"] = " ".join(para)
    return meta


def last_updated(folder: Path) -> str:
    try:
        out = subprocess.run(
            ["git", "log", "-1", "--format=%cs", "--", str(folder.relative_to(ROOT))],
            cwd=ROOT, capture_output=True, text=True, check=True,
        ).stdout.strip()
        if out:
            return out
    except Exception:
        pass
    newest = max((f.stat().st_mtime for f in folder.rglob("*") if f.is_file()), default=None)
    if newest is None:
        return dt.date.today().isoformat()
    return dt.date.fromtimestamp(newest).isoformat()


def collect() -> tuple[list, list]:
    plugins, problems = [], []
    if not PLUGINS.is_dir():
        return plugins, problems
    for folder in sorted(p for p in PLUGINS.iterdir() if p.is_dir() and not p.name.startswith(".")):
        slug = folder.name
        js = folder / f"{slug}.js"
        if not js.is_file():
            problems.append(f"{slug}: немає {slug}.js")
            continue
        info = parse_readme(folder / "README.md")
        entry = {
            "slug": slug,
            "name": info["name"] or slug,
            "description": info["description"],
            "updated": last_updated(folder),
        }
        if info.get("version"):
            entry["version"] = info["version"]
        if info.get("author"):
            entry["author"] = info["author"]
        if info.get("hidden"):
            entry["hidden"] = True
        plugins.append(entry)
    return plugins, problems


def build_site(plugins: list) -> None:
    if SITE.exists():
        shutil.rmtree(SITE)
    SITE.mkdir(parents=True)
    shutil.copy2(ROOT / "index.html", SITE / "index.html")
    for entry in plugins:
        slug = entry["slug"]
        shutil.copytree(PLUGINS / slug, SITE / "plugins" / slug)
        shutil.copy2(PLUGINS / slug / f"{slug}.js", SITE / f"{slug}.js")
    manifest = {
        "version": 1,
        "updated": dt.date.today().isoformat(),
        "plugins": plugins,
    }
    (SITE / "plugins.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )


def write_readme(plugins: list) -> None:
    lines = ["# lmpmod", "", "Плагіни для [Lampa](https://github.com/yumata/lampa).", ""]
    visible = [p for p in plugins if not p.get("hidden")]
    if not visible:
        lines.append("Плагінів поки немає.")
    for p in visible:
        bits = []
        if p.get("version"):
            bits.append(f"`{p['version']}`")
        if p.get("updated"):
            bits.append(p["updated"])
        tail = f" · {' · '.join(bits)}" if bits else ""
        lines.append(
            f"- **{p['name']}** — {p['description'] or 'без опису'}"
            f"{tail} · [{p['slug']}.js](https://lmpmod.github.io/{p['slug']}.js)"
        )
    (ROOT / "README.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-readme", action="store_true", help="не перезаписувати README.md")
    args = ap.parse_args()

    plugins, problems = collect()
    build_site(plugins)
    if not args.no_readme:
        write_readme(plugins)

    print(f"плагінів: {len(plugins)}")
    for p in plugins:
        print(f"  {p['slug']}: {p['name']} → /{p['slug']}.js")
    print(f"сайт зібрано: {SITE.relative_to(ROOT)}/")
    if problems:
        print("\nпроблеми:", file=sys.stderr)
        for problem in problems:
            print(f"  {problem}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
