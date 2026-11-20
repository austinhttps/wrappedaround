import os
import sqlite3
import sys
from pathlib import Path
from dotenv import load_dotenv

def get_db_path_from_url(database_url: str | None = None) -> Path:
    if not database_url:
        load_dotenv()
        database_url = os.getenv("DATABASE_URL", "sqlite:///data/spotify.db")
    
    if database_url.startswith("sqlite:///"):
        rel_or_abs = database_url.replace("sqlite:///", "", 1)
        return Path(rel_or_abs)
    elif database_url.startswith("sqlite://"):
        rel_or_abs = database_url.replace("sqlite://", "", 1)
        return Path(rel_or_abs)
    else:
        # Fallback to direct path or default if not sqlite prefix
        return Path(database_url)

def init_db(db_path: Path | str | None = None, schema_path: Path | str | None = None) -> Path:
    if db_path is None:
        target_path = get_db_path_from_url()
    else:
        target_path = Path(db_path)
    
    if schema_path is None:
        schema_path = Path(__file__).resolve().parent.parent / "db" / "schema.sql"
    else:
        schema_path = Path(schema_path)

    if not schema_path.exists():
        raise FileNotFoundError(f"Schema file not found at: {schema_path}")

    target_path.parent.mkdir(parents=True, exist_ok=True)

    with open(schema_path, "r", encoding="utf-8") as f:
        schema_sql = f.read()

    conn = sqlite3.connect(target_path)
    try:
        conn.executescript(schema_sql)
        conn.commit()
    finally:
        conn.close()

    return target_path

if __name__ == "__main__":
    db_file = init_db()
    print(f"Database initialized successfully at: {db_file}")
