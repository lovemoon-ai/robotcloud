from __future__ import annotations

import logging
from typing import Any, Dict, Optional

from django.conf import settings

logger = logging.getLogger("robotcloud.payment.alipay")

_alipay_instance: Optional[Any] = None


def _to_pem(key: str, key_type: str) -> str:
    """Convert raw base64 key to PEM format if needed."""
    if not key or key.startswith("-----BEGIN"):
        return key
    # Wrap raw base64 in PEM headers
    if key_type == "private":
        header = "-----BEGIN RSA PRIVATE KEY-----"
        footer = "-----END RSA PRIVATE KEY-----"
    else:
        header = "-----BEGIN PUBLIC KEY-----"
        footer = "-----END PUBLIC KEY-----"
    # Split into 64-char lines
    lines = [key[i:i+64] for i in range(0, len(key), 64)]
    return f"{header}\n" + "\n".join(lines) + f"\n{footer}"


class AlipayClient:
    """Alipay SDK wrapper for payment processing."""

    def __init__(
        self,
        app_id: Optional[str] = None,
        private_key: Optional[str] = None,
        public_key: Optional[str] = None,
        gateway: Optional[str] = None,
    ) -> None:
        self.app_id = app_id or getattr(settings, "ALIPAY_APP_ID", "")
        self.private_key = private_key or getattr(settings, "ALIPAY_PRIVATE_KEY", "")
        self.public_key = public_key or getattr(settings, "ALIPAY_PUBLIC_KEY", "")
        self.gateway = gateway or getattr(settings, "ALIPAY_GATEWAY", "https://openapi.alipay.com/gateway.do")
        self._sdk: Optional[Any] = None

    def is_configured(self) -> bool:
        return bool(self.app_id and self.private_key and self.public_key)

    def _get_sdk(self) -> Any:
        if self._sdk is not None:
            return self._sdk

        if not self.is_configured():
            return None

        try:
            from alipay import AliPay
            self._sdk = AliPay(
                appid=self.app_id,
                app_notify_url=None,
                app_private_key_string=_to_pem(self.private_key, "private"),
                alipay_public_key_string=_to_pem(self.public_key, "public"),
                sign_type="RSA2",
                debug=False,
            )
            return self._sdk
        except ImportError:
            logger.warning("alipay-sdk not installed, using mock mode")
            return None
        except Exception as e:
            logger.error("Failed to initialize Alipay SDK: %s", e)
            return None

    def create_page_pay(
        self,
        out_trade_no: str,
        total_amount: str,
        subject: str,
        return_url: Optional[str] = None,
        notify_url: Optional[str] = None,
    ) -> Optional[str]:
        """Create a page payment URL for desktop web."""
        sdk = self._get_sdk()
        if not sdk:
            logger.info("[MOCK] Creating page pay for order %s, amount %s", out_trade_no, total_amount)
            return None

        try:
            order_string = sdk.api_alipay_trade_page_pay(
                out_trade_no=out_trade_no,
                total_amount=total_amount,
                subject=subject,
                return_url=return_url,
                notify_url=notify_url,
            )
            return f"{self.gateway}?{order_string}"
        except Exception as e:
            logger.error("Failed to create page pay: %s", e)
            return None

    def create_wap_pay(
        self,
        out_trade_no: str,
        total_amount: str,
        subject: str,
        return_url: Optional[str] = None,
        notify_url: Optional[str] = None,
    ) -> Optional[str]:
        """Create a WAP payment URL for mobile web."""
        sdk = self._get_sdk()
        if not sdk:
            logger.info("[MOCK] Creating wap pay for order %s, amount %s", out_trade_no, total_amount)
            return None

        try:
            order_string = sdk.api_alipay_trade_wap_pay(
                out_trade_no=out_trade_no,
                total_amount=total_amount,
                subject=subject,
                return_url=return_url,
                notify_url=notify_url,
            )
            return f"{self.gateway}?{order_string}"
        except Exception as e:
            logger.error("Failed to create wap pay: %s", e)
            return None

    def verify_notify(self, data: Dict[str, str]) -> bool:
        """Verify Alipay async notification signature."""
        sdk = self._get_sdk()
        if not sdk:
            logger.warning("[MOCK] Skipping signature verification")
            return True

        try:
            return sdk.verify(data, data.get("sign", ""))
        except Exception as e:
            logger.error("Failed to verify notify signature: %s", e)
            return False

    def query_order(self, out_trade_no: str) -> Optional[Dict[str, Any]]:
        """Query order status from Alipay."""
        sdk = self._get_sdk()
        if not sdk:
            logger.info("[MOCK] Querying order %s", out_trade_no)
            return None

        try:
            result = sdk.api_alipay_trade_query(out_trade_no=out_trade_no)
            return result
        except Exception as e:
            logger.error("Failed to query order: %s", e)
            return None


def get_alipay() -> AlipayClient:
    """Get the singleton Alipay client instance."""
    global _alipay_instance
    if _alipay_instance is None:
        _alipay_instance = AlipayClient()
    return _alipay_instance
