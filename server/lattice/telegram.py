"""Telegram: the one channel the watchdog alerts on.

A `Telegram` posts one-line messages to a single chat over the Bot API. Delivery never
raises: a failed post is a log line, and an unconfigured bot logs the text it would have
sent, so the watchdog runs the same way with or without a token.
"""

import logging

import httpx

from lattice.config import Settings

log = logging.getLogger(__name__)

TIMEOUT_S = 10


class Telegram:
    def __init__(self, settings: Settings, client: httpx.AsyncClient | None = None) -> None:
        self.token = settings.telegram_bot_token
        self.chat_id = settings.telegram_chat_id
        # Tests pass a client over a mock transport; production opens one per message, the
        # watchdog sends too rarely for a pooled connection to matter.
        self._client = client

    @property
    def configured(self) -> bool:
        return bool(self.token and self.chat_id)

    async def send(self, text: str) -> bool:
        """Post `text` to the chat. True when Telegram accepted it; False, already logged,
        when the bot is unconfigured, the request fails, or Telegram answers non-2xx."""
        if not self.configured:
            log.info("telegram not configured; would send: %s", text)
            return False
        url = f"https://api.telegram.org/bot{self.token}/sendMessage"
        payload = {"chat_id": self.chat_id, "text": text}
        try:
            if self._client is None:
                async with httpx.AsyncClient(timeout=TIMEOUT_S) as client:
                    response = await client.post(url, json=payload)
            else:
                response = await self._client.post(url, json=payload, timeout=TIMEOUT_S)
        except Exception as exc:  # noqa: BLE001 - an alert that cannot be delivered is logged
            # The exception text is kept short: httpx puts the URL, token included, in some.
            log.warning("telegram send failed: %s", type(exc).__name__)
            return False
        if not response.is_success:
            log.warning(
                "telegram rejected message: %s %s", response.status_code, response.text[:200]
            )
            return False
        return True
