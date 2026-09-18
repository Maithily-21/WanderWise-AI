"""
ANALYTICS LAYER — Recommendation Engine

Ranks the structured attraction list from
tools/local_info_tool.py::get_attractions_structured().

# TODO(upgrade): this currently just sorts by OpenTripMap's `rate`
#   field. For real personalization, parse interests out of the
#   user's natural-language query (e.g. "food", "history", "museums")
#   and do content-based matching against each place's `kinds` tags
#   (OpenTripMap returns these) before falling back to rate-sorting.
"""
from typing import Any


def rank_attractions(attractions: list[dict[str, Any]], limit: int = 10) -> list[dict[str, Any]]:
    return sorted(attractions, key=lambda a: (a.get("rate") or 0), reverse=True)[:limit]
