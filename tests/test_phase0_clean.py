import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[1] / "src"))

from phase0_clean import classify_link, detect_platform, normalize_url


class Phase0Tests(unittest.TestCase):
    def test_normalize_url_adds_scheme_and_removes_tracking(self):
        self.assertEqual(
            normalize_url("  example.com/careers/?utm_source=x&role=dev#jobs "),
            "https://example.com/careers?role=dev",
        )

    def test_platform_detection_uses_url(self):
        self.assertEqual(detect_platform("https://boards.greenhouse.io/acme"), "greenhouse")
        self.assertEqual(detect_platform("https://jobs.lever.co/acme"), "lever")
        self.assertEqual(detect_platform("https://jobs.ashbyhq.com/acme"), "ashby")

    def test_platform_detection_uses_embedded_signal(self):
        self.assertEqual(
            detect_platform("https://acme.example/careers", '<script src="https://jobs.lever.co/embed.js"></script>'),
            "lever",
        )

    def test_forbidden_board_is_skipped(self):
        flag, reason = classify_link("Acme", "https://www.linkedin.com/company/acme/jobs", "custom")
        self.assertEqual(flag, "skipped_third_party")
        self.assertIn("linkedin.com", reason)

    def test_custom_homepage_is_review(self):
        flag, reason = classify_link("Acme", "https://acme.example", "custom")
        self.assertEqual(flag, "review")
        self.assertIn("career path", reason)


if __name__ == "__main__":
    unittest.main()
