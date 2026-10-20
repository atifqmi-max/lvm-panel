import unittest

from security_utils import is_safe_redirect_target, is_same_origin_request


class SafeRedirectTests(unittest.TestCase):
    def test_accepts_local_paths(self):
        for value in ("/", "/dashboard", "/settings?tab=profile", "/path#section"):
            with self.subTest(value=value):
                self.assertTrue(is_safe_redirect_target(value))

    def test_rejects_external_and_ambiguous_targets(self):
        for value in (
            "", "dashboard", "//evil.example/path", "https://evil.example/",
            "http://example.com/", "/\\\\evil.example", "/path\\\\evil",
            "/path\r\nLocation: https://evil.example",
        ):
            with self.subTest(value=value):
                self.assertFalse(is_safe_redirect_target(value))


class SameOriginMutationTests(unittest.TestCase):
    def test_same_origin_origin_header(self):
        self.assertTrue(is_same_origin_request(
            origin="https://panel.example:443", referer=None,
            expected_origin="https://panel.example/", sec_fetch_site="same-origin",
            has_session_cookie=True,
        ))

    def test_rejects_cross_origin_origin_and_fetch_metadata(self):
        for kwargs in (
            dict(origin="https://evil.example", referer=None, sec_fetch_site="same-origin"),
            dict(origin=None, referer=None, sec_fetch_site="cross-site"),
            dict(origin="null", referer=None, sec_fetch_site=None),
        ):
            with self.subTest(kwargs=kwargs):
                self.assertFalse(is_same_origin_request(
                    expected_origin="https://panel.example", has_session_cookie=True, **kwargs
                ))

    def test_same_origin_referer_fallback(self):
        self.assertTrue(is_same_origin_request(
            origin=None, referer="https://panel.example/account",
            expected_origin="https://panel.example/", sec_fetch_site=None,
            has_session_cookie=True,
        ))

    def test_missing_origin_only_allowed_without_session_cookie(self):
        base = dict(origin=None, referer=None, expected_origin="https://panel.example",
                    sec_fetch_site=None)
        self.assertTrue(is_same_origin_request(**base, has_session_cookie=False))
        self.assertFalse(is_same_origin_request(**base, has_session_cookie=True))


if __name__ == "__main__":
    unittest.main()
