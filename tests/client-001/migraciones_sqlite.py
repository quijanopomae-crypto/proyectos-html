"""Prueba local, sin claves ni conexiones a Cloudflare.
Ejecuta las migraciones en una base SQLite descartable y verifica estado inicial.
No equivale a certificar compatibilidad final con D1 en produccion.
"""
from pathlib import Path
import sqlite3

root = Path(__file__).resolve().parents[2]
migrations = sorted((root / "infra/database/migrations").glob("*.sql"))
if len(migrations) < 36:
    raise SystemExit(f"Solo {len(migrations)} migraciones: se esperaban 36 o mas")

conn = sqlite3.connect(":memory:")
for migration in migrations:
    try:
        conn.executescript(migration.read_text(encoding="utf-8"))
    except sqlite3.Error as exc:
        raise SystemExit(f"Error en {migration.name}: {exc}") from exc
    print(f"OK {migration.name}")

mode = conn.execute("SELECT mode FROM canonical_control WHERE id=1").fetchone()
if mode != ("LEGACY",):
    raise SystemExit(f"Estado inicial incorrecto: {mode!r}")
session_count = conn.execute("SELECT COUNT(*) FROM auth_sessions").fetchone()[0]
if session_count != 0:
    raise SystemExit(f"Base debe empezar sin sesiones: {session_count}")
print(f"PASS: {len(migrations)} migraciones SQLite, autoridad LEGACY, cero sesiones")
