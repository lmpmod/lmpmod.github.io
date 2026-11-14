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
import html
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PLUGINS = ROOT / "plugins"
SITE = ROOT / "_site"


def parse_readme(path: Path) -> dict:
    """H1 → назва; перший розділ (до наступного заголовка) → опис; front matter → решта полів.

    Опис — це все, що стоїть між H1 і першим заголовком `##`. Абзаци зберігаються
    (розділяються порожнім рядком), рядки всередині абзацу склеюються пробілом,
    пункти списку стають окремими рядками з «•». Саме цей текст бачить картка.
    """
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
            elif key == "description":
                meta["description"] = val
    body = lines[body_start:]

    for index, line in enumerate(body):
        if line.startswith("# "):
            meta["name"] = line[2:].strip()
            body = body[index + 1:]
            break

    paragraphs: list[str] = []
    buffer: list[str] = []
    for line in body:
        stripped = line.strip()
        if stripped.startswith("#"):          # почався наступний розділ
            break
        if not stripped:                      # порожній рядок закриває абзац
            if buffer:
                paragraphs.append(" ".join(buffer))
                buffer = []
            continue
        if stripped.startswith(("- ", "* ")):  # пункт списку — окремим рядком
            if buffer:
                paragraphs.append(" ".join(buffer))
                buffer = []
            paragraphs.append("• " + stripped[2:].strip())
            continue
        buffer.append(stripped)
    if buffer:
        paragraphs.append(" ".join(buffer))

    if paragraphs:
        meta["description"] = "\n\n".join(paragraphs)
    return meta


def first_added(folder: Path) -> str:
    """Дата, коли тека плагіна вперше потрапила в репозиторій (для порядку додавання)."""
    try:
        out = subprocess.run(
            ["git", "log", "--diff-filter=A", "--reverse", "--format=%cI", "--",
             str(folder.relative_to(ROOT))],
            cwd=ROOT, capture_output=True, text=True, check=True,
        ).stdout.strip().splitlines()
        if out:
            return out[0]
    except Exception:
        pass
    oldest = min((f.stat().st_mtime for f in folder.rglob("*") if f.is_file()), default=None)
    if oldest is None:
        return dt.datetime.now().isoformat(timespec="seconds")
    return dt.datetime.fromtimestamp(oldest).isoformat(timespec="seconds")


def last_updated(folder: Path) -> str:
    """Час останньої зміни теки плагіна в ISO (для сортування; показ бере дату)."""
    try:
        out = subprocess.run(
            ["git", "log", "-1", "--format=%cI", "--", str(folder.relative_to(ROOT))],
            cwd=ROOT, capture_output=True, text=True, check=True,
        ).stdout.strip()
        if out:
            return out
    except Exception:
        pass
    newest = max((f.stat().st_mtime for f in folder.rglob("*") if f.is_file()), default=None)
    if newest is None:
        return dt.datetime.now().isoformat(timespec="seconds")
    return dt.datetime.fromtimestamp(newest).isoformat(timespec="seconds")


README_PAGE = """<!DOCTYPE html>
<html lang="uk">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>__NAME__ — lmpmod</title>
<style>
  :root{--bg:#0d0f12;--panel:#15181d;--panel-2:#1b1f26;--line:#262b34;--text:#e8eaed;
        --muted:#8b93a1;--accent:#f5a623}
  *{box-sizing:border-box}
  html,body{margin:0;padding:0}
  body{background:radial-gradient(1200px 600px at 50% -200px,#1a1f27 0%,var(--bg) 60%);
       color:var(--text);min-height:100vh;
       font:16px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;
       -webkit-font-smoothing:antialiased}
  .wrap{max-width:820px;margin:0 auto;padding:48px 20px 80px}
  .back{display:inline-block;margin-bottom:22px;color:var(--muted);text-decoration:none;font-size:14px}
  .back:hover{color:var(--accent)}
  article h1{font-size:26px;margin:0 0 18px;letter-spacing:-.01em}
  article h2{font-size:19px;margin:34px 0 12px;padding-bottom:6px;border-bottom:1px solid var(--line)}
  article h3{font-size:16px;margin:24px 0 8px}
  article p{color:#cfd4dc}
  article a{color:var(--accent);text-decoration:none;border-bottom:1px solid rgba(245,166,35,.35)}
  article a:hover{border-bottom-color:var(--accent)}
  article code{background:#0a0c0f;border:1px solid var(--line);border-radius:5px;
       padding:1px 5px;font-size:13px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
  article pre{background:#0a0c0f;border:1px solid var(--line);border-radius:10px;
       padding:14px;overflow:auto}
  article pre code{background:none;border:0;padding:0;font-size:13px}
  article table{border-collapse:collapse;width:100%;margin:16px 0;font-size:14px;
       display:block;overflow-x:auto}
  article th,article td{border:1px solid var(--line);padding:8px 10px;text-align:left;vertical-align:top}
  article th{background:var(--panel-2);color:#c8cdd6}
  article ul,article ol{padding-left:22px;color:#cfd4dc}
  article li{margin:6px 0}
  article blockquote{margin:16px 0;padding:8px 16px;border-left:3px solid var(--accent);
       color:var(--muted);background:var(--panel)}
  article img{max-width:100%}
</style>
</head>
<body><div class="wrap">
<a class="back" href="/">&larr; до списку плагінів</a>
<article>
__BODY__
</article>
</div></body>
</html>
"""


def readme_page(slug: str, name: str) -> str | None:
    """README.md плагіна → HTML-сторінка в стилі сайту (front matter не рендеримо)."""
    source = PLUGINS / slug / "README.md"
    if not source.is_file():
        return None
    try:
        import markdown
    except ImportError:  # у CI ставимо залежність окремим кроком
        raise SystemExit(
            "потрібна бібліотека markdown: python3 -m pip install markdown"
        )
    text = source.read_text(encoding="utf-8")
    text = re.sub(r"\A---\r?\n.*?\r?\n---\r?\n", "", text, count=1, flags=re.S)
    body = markdown.markdown(text, extensions=["tables", "fenced_code", "sane_lists"])
    return README_PAGE.replace("__NAME__", html.escape(name, quote=False)).replace("__BODY__", body)


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
        updated_iso = last_updated(folder)
        entry = {
            "slug": slug,
            "name": info["name"] or slug,
            "description": info["description"],
            "updated": updated_iso[:10],       # дата для показу на картці
            "updated_at": updated_iso,       # точний час для сортування
            "added": first_added(folder),    # коли плагін додали (порядок за замовчуванням)
        }
        if info.get("version"):
            entry["version"] = info["version"]
        if info.get("author"):
            entry["author"] = info["author"]
        if info.get("hidden"):
            entry["hidden"] = True
        plugins.append(entry)
    # порядок за замовчуванням — як плагіни додавались; для однакової дати — за назвою
    plugins.sort(key=lambda e: (e["added"], e["name"].lower()))
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
        page = readme_page(slug, entry["name"])
        if page:
            (SITE / "plugins" / slug / "index.html").write_text(page, encoding="utf-8")
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
        short = (p["description"].split("\n\n")[0] if p["description"] else "") or "без опису"
        lines.append(
            f"- **{p['name']}** — {short}"
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
