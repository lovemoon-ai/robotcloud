from __future__ import annotations

import logging
from abc import ABC, abstractmethod
from typing import Dict


class SmsGateway(ABC):
    @abstractmethod
    def send_verification_code(self, phone: str, code: str) -> None:
        """Send a verification code to the given phone number."""


class ConsoleSmsGateway(SmsGateway):
    def __init__(self) -> None:
        self.logger = logging.getLogger("robotcloud.sms")

    def send_verification_code(self, phone: str, code: str) -> None:
        self.logger.info("Sending verification code %s to %s", code, phone)


class InMemorySmsGateway(SmsGateway):
    def __init__(self) -> None:
        self.sent_codes: Dict[str, str] = {}

    def send_verification_code(self, phone: str, code: str) -> None:
        self.sent_codes[phone] = code

    def get_code(self, phone: str) -> str:
        return self.sent_codes[phone]
