import importlib

from fastapi.testclient import TestClient


def client(monkeypatch, root):
    monkeypatch.setenv("TTS_OUTPUT_ROOT", str(root))
    import main

    importlib.reload(main)
    return TestClient(main.app)


def test_health(monkeypatch, tmp_path):
    assert client(monkeypatch, tmp_path).get("/health").json() == {"ok": True}


def test_rejects_output_outside_the_jobs_root(monkeypatch, tmp_path):
    res = client(monkeypatch, tmp_path / "jobs").post(
        "/synthesize", json={"texts": ["hi"], "out_path": str(tmp_path / "elsewhere" / "x.wav")}
    )
    assert res.status_code == 400
    assert "must be inside" in res.json()["detail"]


def test_rejects_non_wav_output(monkeypatch, tmp_path):
    res = client(monkeypatch, tmp_path).post("/synthesize", json={"texts": ["hi"], "out_path": str(tmp_path / "x.sh")})
    assert res.status_code == 400
