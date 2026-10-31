import pytest

from app.budget import budget


@pytest.fixture(autouse=True)
def isolated_budget(tmp_path, monkeypatch):
    """Never touch the real spend ledger from tests; start every test with a fresh, generous cap."""
    monkeypatch.setattr(budget, "path", tmp_path / "budget.json")
    monkeypatch.setattr(budget, "cap", 1000.0)
    monkeypatch.setattr(budget, "_spent", 0.0)
    monkeypatch.setattr(budget, "_by_op", {})
    yield budget
