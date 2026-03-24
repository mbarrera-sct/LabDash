"""Pytest configuration and fixtures for LabDash backend tests."""
import os
import pytest


@pytest.fixture(autouse=True, scope="session")
def use_temp_db(tmp_path_factory):
    """Override DB_PATH to use a temporary SQLite database for all tests."""
    tmp_dir = tmp_path_factory.mktemp("testdb")
    db_file = str(tmp_dir / "test_labdash.db")
    os.environ["DB_PATH"] = db_file
    # Ensure no PostgreSQL backend is used during tests
    os.environ.pop("DATABASE_URL", None)
    yield db_file
