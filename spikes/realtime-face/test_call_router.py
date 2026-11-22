"""Unit tests for per-call routing and call tokens. `python -m unittest test_call_router` (no model, no venv needed)."""
import time
import unittest

import call_token
from call_router import Busy, CallRouter


class Ws:
    def __init__(self, name):
        self.name = name

    def __repr__(self):
        return self.name


class RouterTest(unittest.TestCase):
    def test_frames_go_to_the_active_call_only(self):
        r = CallRouter()
        a = Ws("a")
        r.attach("A", a)
        self.assertEqual(r.targets(), [a])
        self.assertTrue(r.busy)

    def test_a_second_call_is_refused_while_the_first_has_a_socket(self):
        r = CallRouter()
        r.attach("A", Ws("a"))
        with self.assertRaises(Busy):
            r.attach("B", Ws("b"))
        self.assertEqual(r.active, "A")

    def test_a_second_socket_for_the_same_call_replaces_the_first(self):
        r = CallRouter()
        first, second = Ws("1"), Ws("2")
        r.attach("A", first)
        replaced, switched = r.attach("A", second)
        self.assertIs(replaced, first)
        self.assertFalse(switched)
        self.assertEqual(r.targets(), [second])  # one listener: no doubled audio
        # the old socket closing later must not free the call
        self.assertFalse(r.detach("A", first))
        self.assertEqual(r.targets(), [second])

    def test_the_server_is_free_when_the_active_call_leaves(self):
        r = CallRouter()
        a = Ws("a")
        r.attach("A", a)
        self.assertTrue(r.detach("A", a))
        self.assertEqual(r.targets(), [])
        replaced, switched = r.attach("B", Ws("b"))
        self.assertIsNone(replaced)
        self.assertTrue(switched)

    def test_end_from_the_api(self):
        r = CallRouter()
        a = Ws("a")
        r.attach("A", a)
        self.assertIs(r.end("A"), a)
        self.assertIsNone(r.active)
        self.assertIsNone(r.end("A"))

    def test_attach_reports_a_switch_on_first_and_new_calls(self):
        r = CallRouter()
        self.assertTrue(r.attach("A", Ws("a"))[1])


class TokenTest(unittest.TestCase):
    S = "s3cret"

    def test_roundtrip_and_audience(self):
        t = call_token.sign({"call": "c_1", "aud": ["face"]}, self.S, 60)
        self.assertEqual(call_token.verify(t, self.S, aud="face")["call"], "c_1")
        with self.assertRaises(call_token.TokenError):
            call_token.verify(t, self.S, aud="voice")

    def test_admin_passes_any_audience(self):
        t = call_token.sign({"call": "admin", "aud": ["admin"]}, self.S, 60)
        self.assertEqual(call_token.verify(t, self.S, aud="face")["call"], "admin")

    def test_tamper_and_expiry(self):
        t = call_token.sign({"call": "c_1", "aud": ["face"]}, self.S, 10, now=1000)
        with self.assertRaises(call_token.TokenError):
            call_token.verify(t, "other", now=1001)
        self.assertEqual(call_token.verify(t, self.S, now=1012)["call"], "c_1")
        with self.assertRaisesRegex(call_token.TokenError, "expired"):
            call_token.verify(t, self.S, now=1016)
        with self.assertRaises(call_token.TokenError):
            call_token.verify("a.b", self.S)
        with self.assertRaises(call_token.TokenError):
            call_token.verify(None, self.S)

    def test_token_from_headers(self):
        self.assertEqual(call_token.token_from_headers({"Sec-WebSocket-Protocol": "mirli.v1, bearer.x.y"}), "x.y")
        self.assertEqual(call_token.token_from_headers({"Authorization": "Bearer z.w"}), "z.w")
        self.assertIsNone(call_token.token_from_headers({}))

    def test_fresh_tokens_are_not_expired(self):
        t = call_token.sign({"call": "c", "aud": ["face"]}, self.S)
        self.assertGreater(call_token.verify(t, self.S)["exp"], time.time())


if __name__ == "__main__":
    unittest.main()
