import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[1] / "src"))

from adapters.common import classify_type
from adapters.html import fetch as fetch_html
from filters import filter_job


class Phase1Tests(unittest.TestCase):
    def test_classifies_internship(self):
        self.assertEqual(classify_type("Backend Intern", "Build APIs"), "intern")

    def test_rejects_senior_title(self):
        job = {"title": "Senior Software Engineer", "location": "India", "type": "full-time", "description_text": ""}
        self.assertEqual(filter_job(job)[0], False)

    def test_keeps_matching_india_role(self):
        job = {
            "title": "Software Engineer Intern",
            "location": "Bengaluru, India",
            "type": "intern",
            "description_text": "Python and backend services",
        }
        self.assertTrue(filter_job(job)[0])

    def test_html_adapter_reads_jobposting_json_ld(self):
        class FakeFetcher:
            def get_text(self, _url):
                return """
                <script type="application/ld+json">
                {"@type":"JobPosting","title":"Python Intern",
                 "url":"/jobs/python-intern","datePosted":"2026-10-25",
                 "jobLocation":{"address":{"addressLocality":"Remote"}},
                 "description":"Work on Python services."}
                </script>
                """

        jobs = fetch_html("Acme", "https://acme.example/careers", FakeFetcher())
        self.assertEqual(len(jobs), 1)
        self.assertEqual(jobs[0]["title"], "Python Intern")
        self.assertEqual(jobs[0]["type"], "intern")

    def test_html_adapter_rejects_search_result_links(self):
        class FakeFetcher:
            def get_text(self, _url):
                return '<a href="/en-in/search?search=Software+Engineer">Software Engineer</a>'

        self.assertEqual(
            fetch_html("Acme", "https://acme.example/careers", FakeFetcher()),
            [],
        )


if __name__ == "__main__":
    unittest.main()
