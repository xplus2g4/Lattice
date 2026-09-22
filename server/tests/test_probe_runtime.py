import asyncio
from decimal import Decimal

import httpx
import pytest


def test_budget_blocks_a_request_before_it_reaches_the_provider(tmp_path):
    from scripts.probe_runtime import BudgetExceeded, budgeted_requests

    sent = []

    def respond(request):
        sent.append(request)
        return httpx.Response(200, json={"usage": {"prompt_tokens": 10, "completion_tokens": 2}})

    async def run():
        with budgeted_requests(tmp_path / "budget.sqlite3", Decimal("0.30")):
            async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
                await client.post(
                    "https://api.deepseek.com/v1/chat/completions",
                    json={"model": "deepseek-v4-flash", "max_tokens": 100, "messages": []},
                )

    with pytest.raises(BudgetExceeded):
        asyncio.run(run())
    assert sent == []


def test_measured_usage_releases_headroom_and_survives_reopening(tmp_path):
    from scripts.probe_runtime import budgeted_requests

    path = tmp_path / "budget.sqlite3"
    transport = httpx.MockTransport(
        lambda request: httpx.Response(
            200,
            json={
                "model": "deepseek-v4.1-flash",
                "usage": {
                    "prompt_tokens": 100,
                    "completion_tokens": 10,
                    "prompt_cache_hit_tokens": 80,
                },
            },
        )
    )
    for _ in range(2):
        with budgeted_requests(path, Decimal("0.35")) as ledger:
            with httpx.Client(transport=transport) as client:
                client.post(
                    "https://api.deepseek.com/v1/chat/completions",
                    json={
                        "model": "deepseek-flash",
                        "max_tokens": 100,
                    },
                )
    report = ledger.report()
    assert len(report["requests"]) == 2
    assert report["charged_or_reserved_upper_bound_usd"] == 0.000084
    assert report["unresolved_reservations"] == 0
    assert report["requests"][0]["cache_hit_tokens"] == 80


def test_timeout_keeps_its_reservation_and_blocks_an_unfunded_retry(tmp_path):
    from scripts.probe_runtime import BudgetExceeded, budgeted_requests

    sent = []

    def timeout(request):
        sent.append(request)
        raise httpx.ReadTimeout("synthetic timeout", request=request)

    path = tmp_path / "budget.sqlite3"
    for exception in (httpx.ReadTimeout, BudgetExceeded):
        with budgeted_requests(path, Decimal("0.35")) as ledger:
            with httpx.Client(transport=httpx.MockTransport(timeout)) as client:
                with pytest.raises(exception):
                    client.post(
                        "https://api.deepseek.com/v1/chat/completions",
                        json={
                            "model": "deepseek-flash",
                            "max_tokens": 100,
                        },
                    )
    assert len(sent) == 1
    assert ledger.report()["unresolved_reservations"] == 1


@pytest.mark.parametrize(
    "body",
    [
        {"model": "unpriced-model"},
        {"model": "deepseek-flash", "stream": True},
        {"model": "deepseek-flash", "max_tokens": -1},
        {"model": "deepseek-flash", "max_tokens": 500_000},
        {"model": "deepseek-flash", "n": 2},
    ],
)
def test_unpriced_requests_never_reach_the_transport(tmp_path, body):
    from scripts.probe_runtime import BudgetExceeded, budgeted_requests

    sent = []
    with budgeted_requests(tmp_path / "budget.sqlite3"):
        with httpx.Client(
            transport=httpx.MockTransport(lambda request: sent.append(request))
        ) as client:
            with pytest.raises(BudgetExceeded):
                client.post("https://api.deepseek.com/v1/chat/completions", json=body)
    assert sent == []


def test_concurrent_calls_cannot_spend_the_same_headroom(tmp_path):
    from scripts.probe_runtime import BudgetExceeded, budgeted_requests

    sent = []

    async def respond(request):
        sent.append(request)
        await asyncio.sleep(0)
        return httpx.Response(200, json={"usage": {"prompt_tokens": 10, "completion_tokens": 2}})

    async def run():
        with budgeted_requests(tmp_path / "budget.sqlite3", Decimal("0.35")):
            async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
                return await asyncio.gather(
                    *[
                        client.post(
                            "https://api.deepseek.com/v1/chat/completions",
                            json={
                                "model": "deepseek-flash",
                                "max_tokens": 100,
                            },
                        )
                        for _ in range(2)
                    ],
                    return_exceptions=True,
                )

    results = asyncio.run(run())
    assert len(sent) == 1
    assert sum(isinstance(result, BudgetExceeded) for result in results) == 1


def test_provider_redirects_cannot_hide_another_billable_request(tmp_path):
    from scripts.probe_runtime import budgeted_requests

    sent = []

    def redirect(request):
        sent.append(request)
        return httpx.Response(
            307, headers={"location": "https://api.deepseek.com/chat/completions"}
        )

    with budgeted_requests(tmp_path / "budget.sqlite3") as ledger:
        with httpx.Client(transport=httpx.MockTransport(redirect), follow_redirects=True) as client:
            response = client.post(
                "https://api.deepseek.com/v1/chat/completions",
                json={
                    "model": "deepseek-flash",
                    "max_tokens": 100,
                },
            )
    assert response.status_code == 307
    assert len(sent) == 1
    assert ledger.report()["unresolved_reservations"] == 1


def test_preflight_never_prints_credentials(tmp_path, monkeypatch, capsys):
    from scripts import probe_runtime

    monkeypatch.setattr(probe_runtime, "SERVER_ROOT", tmp_path)
    monkeypatch.setenv("LLM_API_KEY", "synthetic-secret-not-a-real-key")
    monkeypatch.setenv("LLM_MODEL", "unsupported-model")
    monkeypatch.setattr("sys.argv", ["probe_runtime.py", "--ledger", str(tmp_path / "budget.db")])
    assert probe_runtime.main() == 2
    assert "synthetic-secret-not-a-real-key" not in capsys.readouterr().out
    assert not (tmp_path / "budget.db").exists()
