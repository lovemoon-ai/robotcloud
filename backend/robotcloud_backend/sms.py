from __future__ import annotations

import hashlib
import hmac
import json
import logging
from abc import ABC, abstractmethod
from datetime import datetime, timezone
from typing import Dict, Optional
from urllib.parse import urlencode

import requests
from django.conf import settings


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


class VolcengineSmsGateway(SmsGateway):
    """Volcengine SMS Gateway implementation."""

    HOST = "sms.volcengineapi.com"
    VERSION = "2020-01-01"
    REGION = "cn-north-1"
    SERVICE = "volcSMS"

    def __init__(
        self,
        access_key_id: Optional[str] = None,
        secret_access_key: Optional[str] = None,
        sms_account: Optional[str] = None,
        sign_name: Optional[str] = None,
        template_id: Optional[str] = None,
    ) -> None:
        self.access_key_id = access_key_id or getattr(settings, "VOLC_ACCESS_KEY_ID", "")
        self.secret_access_key = secret_access_key or getattr(settings, "VOLC_SECRET_ACCESS_KEY", "")
        self.sms_account = sms_account or getattr(settings, "VOLC_SMS_ACCOUNT", "")
        self.sign_name = sign_name or getattr(settings, "VOLC_SMS_SIGN_NAME", "")
        self.template_id = template_id or getattr(settings, "VOLC_SMS_TEMPLATE_ID", "")
        self.logger = logging.getLogger("robotcloud.sms.volcengine")

    def _hmac_sha256(self, data: str, key: bytes, hex_output: bool = False) -> bytes:
        h = hmac.new(key, data.encode("utf-8"), hashlib.sha256)
        return h.hexdigest().encode("utf-8") if hex_output else h.digest()

    def _sign(
        self,
        method: str,
        path: str,
        query: Dict[str, str],
        headers: Dict[str, str],
        body: str,
    ) -> Dict[str, str]:
        now = datetime.now(timezone.utc)
        x_date = now.strftime("%Y%m%dT%H%M%SZ")
        short_date = x_date[:8]

        body_hash = hashlib.sha256(body.encode("utf-8")).hexdigest()
        signed_header_names = ["content-type", "host", "x-content-sha256", "x-date"]

        new_headers = {
            **headers,
            "x-date": x_date,
            "x-content-sha256": body_hash,
        }

        canonical_headers = "\n".join(
            f"{k}:{new_headers[k].strip()}" for k in signed_header_names
        )
        query_string = "&".join(
            f"{k}={query[k]}" for k in sorted(query.keys())
        )

        canonical_request = "\n".join([
            method,
            path,
            query_string,
            canonical_headers + "\n",
            ";".join(signed_header_names),
            body_hash,
        ])

        credential_scope = f"{short_date}/{self.REGION}/{self.SERVICE}/request"
        string_to_sign = "\n".join([
            "HMAC-SHA256",
            x_date,
            credential_scope,
            hashlib.sha256(canonical_request.encode("utf-8")).hexdigest(),
        ])

        k_date = self._hmac_sha256(short_date, self.secret_access_key.encode("utf-8"))
        k_region = self._hmac_sha256(self.REGION, k_date)
        k_service = self._hmac_sha256(self.SERVICE, k_region)
        k_signing = self._hmac_sha256("request", k_service)
        signature = self._hmac_sha256(string_to_sign, k_signing, hex_output=True).decode("utf-8")

        authorization = (
            f"HMAC-SHA256 Credential={self.access_key_id}/{credential_scope}, "
            f"SignedHeaders={';'.join(signed_header_names)}, Signature={signature}"
        )

        return {**new_headers, "Authorization": authorization}

    def is_configured(self) -> bool:
        return bool(
            self.access_key_id
            and self.secret_access_key
            and self.sms_account
            and self.sign_name
            and self.template_id
        )

    def send_verification_code(self, phone: str, code: str) -> None:
        if not self.is_configured():
            self.logger.info("[DEV] SMS verification code for %s: %s", phone, code)
            return

        body = json.dumps({
            "SmsAccount": self.sms_account,
            "Sign": self.sign_name,
            "TemplateID": self.template_id,
            "TemplateParam": json.dumps({"code": code}),
            "PhoneNumbers": phone,
        })

        query = {"Action": "SendSms", "Version": self.VERSION}
        headers = {
            "host": self.HOST,
            "content-type": "application/json; charset=utf-8",
        }

        signed_headers = self._sign("POST", "/", query, headers, body)
        url = f"https://{self.HOST}/?{urlencode(query)}"

        try:
            response = requests.post(url, headers=signed_headers, data=body, timeout=10)
            result = response.json()

            if result.get("ResponseMetadata", {}).get("Error"):
                error = result["ResponseMetadata"]["Error"]
                self.logger.error("Volcengine SMS error: %s", error)
                raise ValueError(error.get("Message", "SMS send failed"))

            self.logger.info("SMS sent successfully to %s", phone)
        except requests.RequestException as e:
            self.logger.error("Failed to send SMS: %s", e)
            raise ValueError("Failed to send SMS") from e


def get_default_sms_gateway() -> SmsGateway:
    """Get the default SMS gateway based on configuration."""
    dev_code = getattr(settings, "AUTH_DEV_CODE", "")
    if dev_code:
        return ConsoleSmsGateway()
    return VolcengineSmsGateway()
