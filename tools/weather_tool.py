"""
OpenWeatherMap client — powers the new WEATHER AGENT.
Free tier: 1,000 calls/day. Get a key at
https://home.openweathermap.org/api_keys

Written sync + using `requests`, matching this repo's existing tools
(flight_tool.py, tavily_tool.py) rather than introducing async/httpx.
"""
import os
import requests
from dotenv import load_dotenv

load_dotenv()

API_KEY = os.getenv("OPENWEATHER_API_KEY")
BASE_URL = "https://api.openweathermap.org/data/2.5"


def get_weather_forecast(city_name: str, country_code: str | None = None) -> str:
    """
    Returns a human-readable multi-day forecast summary (string, to
    match this repo's convention of agents returning formatted text
    that gets fed straight into the itinerary/final LLM prompts).
    """
    if not API_KEY:
        return (
            "Weather API error: OPENWEATHER_API_KEY is missing.\n"
            "Please add this in your .env file:\n"
            "OPENWEATHER_API_KEY=your_api_key_here"
        )

    if not city_name:
        return "Weather unavailable: could not determine destination city from the query."

    query = f"{city_name},{country_code}" if country_code else city_name

    try:
        response = requests.get(
            f"{BASE_URL}/forecast",
            params={"q": query, "appid": API_KEY, "units": "metric"},
            timeout=30,
        )
        data = response.json()
    except requests.exceptions.RequestException as e:
        return f"Weather API request failed: {e}"
    except ValueError:
        return "Weather API returned invalid JSON."

    if str(data.get("cod")) != "200":
        return f"Weather API error: {data.get('message', 'Unknown error')}"

    # Free tier only gives 3-hour buckets — aggregate into daily min/max.
    daily: dict[str, dict] = {}
    for entry in data.get("list", []):
        day = entry["dt_txt"].split(" ")[0]
        temp = entry["main"]["temp"]
        condition = entry["weather"][0]["main"]
        bucket = daily.setdefault(day, {"min": temp, "max": temp, "condition": condition})
        bucket["min"] = min(bucket["min"], temp)
        bucket["max"] = max(bucket["max"], temp)

    if not daily:
        return f"No forecast data available for {city_name}."

    lines = [f"5-day forecast for {city_name}:"]
    for day, v in sorted(daily.items()):
        lines.append(f"- {day}: {v['condition']}, {round(v['min'])}°C to {round(v['max'])}°C")

    return "\n".join(lines)
