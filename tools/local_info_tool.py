"""
OpenTripMap client — powers the new LOCAL INFO AGENT.
Free tier: 5,000 calls/day. Get a key at
https://opentripmap.io/developer (after free sign-up).

Written sync + using `requests`, matching this repo's existing tools.
"""
import os
import requests
from dotenv import load_dotenv

load_dotenv()

API_KEY = os.getenv("OPENTRIPMAP_API_KEY")
BASE_URL = "https://api.opentripmap.com/0.1/en"


def _geocode(city_name: str):
    resp = requests.get(
        f"{BASE_URL}/places/geoname",
        params={"name": city_name, "apikey": API_KEY},
        timeout=30,
    )
    data = resp.json()
    if "lat" in data and "lon" in data:
        return data["lat"], data["lon"]
    return None


def get_attractions_structured(city_name: str, limit: int = 15) -> list[dict]:
    """
    Structured version used by the recommendation engine. Returns
    [] on any failure — callers should handle that gracefully rather
    than treating it as an error (matches this repo's "always return
    something displayable" convention for the text-based tools).
    """
    if not API_KEY or not city_name:
        return []

    try:
        coords = _geocode(city_name)
        if not coords:
            return []
        lat, lon = coords
        resp = requests.get(
            f"{BASE_URL}/places/radius",
            params={
                "radius": 10000, "lon": lon, "lat": lat,
                "kinds": "interesting_places", "limit": limit,
                "apikey": API_KEY, "format": "json",
            },
            timeout=30,
        )
        return resp.json() or []
    except requests.exceptions.RequestException:
        return []


def get_local_attractions(city_name: str, limit: int = 10) -> str:
    """
    Returns a human-readable list of attractions/points of interest
    (string, matching this repo's convention of agents returning
    formatted text fed directly into the itinerary/final LLM prompts).
    """
    if not API_KEY:
        return (
            "Local info API error: OPENTRIPMAP_API_KEY is missing.\n"
            "Please add this in your .env file:\n"
            "OPENTRIPMAP_API_KEY=your_api_key_here"
        )

    if not city_name:
        return "Local info unavailable: could not determine destination city from the query."

    places = get_attractions_structured(city_name, limit=limit)

    if not places:
        return f"No notable attractions found near {city_name}."

    lines = [f"Notable attractions near {city_name}:"]
    for p in places[:limit]:
        name = p.get("name") or "Unnamed place"
        rate = p.get("rate")
        rate_text = f" (rating tier: {rate})" if rate else ""
        lines.append(f"- {name}{rate_text}")

    return "\n".join(lines)
