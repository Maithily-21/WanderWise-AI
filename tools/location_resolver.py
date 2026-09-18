"""
Shared destination resolution — reuses tools/flight_tool.py's existing
IATA/city/country matching so the new Weather and Local Info agents
don't duplicate that logic, and so all agents agree on what
"the destination" means for a given natural-language query.

NOTE — works around a real gap in flight_tool.py's parse_route(): for
queries like "Japan trip from Bangladesh" (destination named as a
direct object, no explicit "to"), the "from X" regex pattern matches
and returns (dep_iata, None) immediately — it never reaches
flight_tool's own mention-scanning fallback, so the destination is
silently lost even though "Japan" is right there in the text. This
matters because it's the exact shape of query this app's own UI
suggests ("Plan a complete 7 days Japan trip from Bangladesh...").
We don't edit flight_tool.py's parsing (flight_agent's behavior stays
exactly as before) — instead, if parse_route comes back with no
destination, we independently try flight_tool's mention-scanner here.
"""
from tools.flight_tool import (
    parse_route, resolve_location_to_iata, find_location_mentions,
    AIRPORTS, DEFAULT_ORIGIN_IATA,
)


def resolve_trip_locations(query: str):
    """
    Returns a dict: {
        "origin_iata": str | None,
        "destination_iata": str | None,
        "destination_city": str | None,
        "destination_country": str | None,
    }
    """
    dep_iata, arr_iata = parse_route(query)

    if not arr_iata:
        arr_iata = _fallback_destination_from_mentions(query, exclude_iata=dep_iata)

    destination_city = None
    destination_country = None
    if arr_iata and arr_iata in AIRPORTS:
        airport = AIRPORTS[arr_iata]
        destination_city = airport.get("city") or None
        destination_country = airport.get("country") or None

    return {
        "origin_iata": dep_iata or DEFAULT_ORIGIN_IATA,
        "destination_iata": arr_iata,
        "destination_city": destination_city,
        "destination_country": destination_country,
    }


def _fallback_destination_from_mentions(query: str, exclude_iata: str | None):
    """Picks the first location mention that isn't already the origin."""
    mentions = find_location_mentions(query)
    for mention in mentions:
        iata = resolve_location_to_iata(mention)
        if iata and iata != exclude_iata:
            return iata
    return None
