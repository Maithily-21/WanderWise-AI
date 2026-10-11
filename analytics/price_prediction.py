"""
ANALYTICS LAYER — Flight Price Prediction

IMPORTANT CONTEXT SPECIFIC TO THIS REPO: tools/flight_tool.py uses
AviationStack, which provides live/status flight data — NOT ticket
prices (this is called out directly in flight_tool.py's own output
text). So this module can't work off a "current price" the way a
pricing-API-backed system could. Instead it predicts an *expected
fare* for a route from historical patterns, independent of whatever
flight_tool.py returned.

Loads the model bundle from analytics/models/price_model.pkl (trained by
scripts/train_price_model.py on data/flight_fares.csv — see data/README.md).
Feature building is shared with training via analytics/price_features.py.

What the shipped dataset can and can't support:
- It covers 6 Indian domestic routes, journeys Mar-Jun 2019, fares in INR.
  Routes outside that set get no number (estimated_price_usd = None) and an
  explanatory note, instead of an extrapolated guess.
- USD figures are converted from INR at INR_PER_USD (env var, default ~2019
  average) and reflect 2019 fare levels.

Falls back to a clearly-labeled stub if no trained model exists yet,
so the app keeps working end-to-end without it.
"""
import math
import os
import statistics
from datetime import date, timedelta
from pathlib import Path

import joblib

from analytics.price_features import build_inference_frame, normalize_airline, to_iata

MODEL_PATH = Path(__file__).parent / "models" / "price_model.pkl"
# Approximate 2019 average rate, matching the dataset's fare year.
INR_PER_USD = float(os.getenv("INR_PER_USD", "70.4"))
MAX_DAYS_AHEAD = 365
MAX_FLIGHT_ESTIMATES = 10

# Live-API spellings -> the 2019 training names. Kept deliberately small:
# only renames of the same carrier. Unlisted airlines (e.g. Akasa Air, which
# didn't exist in 2019) are ignored with a warning rather than guessed.
AIRLINE_ALIASES = {
    "airasia india": "Air Asia", "air asia india": "Air Asia", "airasia": "Air Asia",
    "go first": "GoAir", "go air": "GoAir", "goair": "GoAir",
}


def match_airline(name: str | None, known: list[str]) -> str | None:
    """Case-insensitive match of an airline name to a training-data airline."""
    if name is None:
        return None
    by_lower = {k.lower(): k for k in known}
    key = " ".join(name.lower().split())
    return by_lower.get(key) or by_lower.get(AIRLINE_ALIASES.get(key, "").lower())


def summarize_for_prompt(result: dict | None) -> str:
    """
    Compact text of a prediction for the LLM prompt. The full dict (with
    per-flight estimates) is ~850 tokens and pushed the final prompt over
    Groq's per-request token limit; this keeps it to ~150.
    """
    if not result:
        return "No fare estimate available."
    version = result.get("model_version", "n/a")
    if result.get("estimated_price_usd") is None:
        return f"No fare estimate (model_version {version}): {result.get('note', 'unavailable')}"
    low, high = result["price_range_usd"]
    low_inr, high_inr = result["price_range_inr"]
    # Give both currencies explicitly: with only USD the LLM re-converted the
    # range at a different rate and quoted an INR range excluding the estimate.
    lines = [
        f"{result['fare_type'].capitalize()} fare estimate for {result['route']} "
        f"(model_version {version}, input tier {result['input_tier']}): "
        f"INR {result['estimated_price_inr']} (${result['estimated_price_usd']}), "
        f"~80% range INR {low_inr}-{high_inr} (${low}-${high}). "
        f"Historical 2019 fares, not a live price; quote these figures as given.",
    ]
    if result.get("basis"):
        lines.append(f"Basis: {result['basis']}.")
    flights = result.get("flight_estimates") or []
    if flights:
        lines.append("Per-flight point estimates (no per-flight ranges): " + "; ".join(
            f"{f['airline']} {f['flight']} dep {(f['departure_scheduled'] or '')[11:16]} "
            f"INR {f['estimated_price_inr']} (${f['estimated_price_usd']})" for f in flights))
    if result.get("warnings"):
        lines.append("Warnings: " + " ".join(result["warnings"]))
    return "\n".join(lines)


class FlightPricePredictor:
    def __init__(self, model_path: Path = MODEL_PATH):
        self.bundle = None
        self.model_version = "stub-v0"
        if model_path.exists():
            try:
                bundle = joblib.load(model_path)
                if isinstance(bundle, dict) and "models" in bundle:
                    self.bundle = bundle
                    self.model_version = bundle["model_version"]
                else:
                    print("[price_prediction] price_model.pkl is from the old trainer (city-name "
                          "features); re-run scripts/train_price_model.py. Using stub.")
            except Exception as e:
                print(f"[price_prediction] Failed to load trained model, using stub: {e}")

    @property
    def model(self):
        """Kept for callers that only check whether a trained model is loaded."""
        return self.bundle

    def predict(self, origin_iata: str | None, destination_iata: str | None,
                airline: str = "unknown", days_ahead: int = 30, *,
                total_stops: int | None = None, duration_min: float | None = None,
                dep_hour: float | None = None, connections: list[str] | None = None) -> dict:
        """
        `days_ahead` defaults to 30 since this repo's natural-language
        query doesn't carry a structured travel date — adjust the
        caller if/when you add explicit date parsing.

        Optional trip details (airline, total_stops, duration_min, dep_hour,
        and connecting airports as IATA codes) sharpen the estimate when
        supplied; the model tier used is reported in `input_tier`.
        """
        if not origin_iata or not destination_iata:
            return self._no_estimate("Could not resolve origin/destination airports from the query.")

        if isinstance(days_ahead, bool) or not isinstance(days_ahead, int) \
                or not 0 <= days_ahead <= MAX_DAYS_AHEAD:
            return self._no_estimate(
                f"days_ahead must be an integer between 0 and {MAX_DAYS_AHEAD}; got {days_ahead!r}.")

        if self.bundle is None:
            return self._predict_stub(origin_iata, destination_iata)
        return self._predict_with_model(origin_iata, destination_iata, airline, days_ahead,
                                        total_stops, duration_min, dep_hour, connections)

    def _predict_with_model(self, origin, destination, airline, days_ahead,
                            total_stops, duration_min, dep_hour, connections) -> dict:
        bundle = self.bundle
        origin, destination = to_iata(origin), to_iata(destination)
        if (origin, destination) not in {tuple(r) for r in bundle["routes"]}:
            covered = ", ".join(f"{o}->{d}" for o, d in bundle["routes"])
            return self._no_estimate(
                f"No fare estimate for {origin}->{destination}: the price model is trained only on "
                f"these Indian domestic routes: {covered}.")

        warnings = []
        raw_airline = normalize_airline(airline)
        airline = match_airline(raw_airline, bundle["airlines"])
        if raw_airline is not None and airline is None:
            warnings.append(f"Airline '{raw_airline}' not in training data; ignored.")

        details = (total_stops, duration_min, dep_hour)
        if total_stops == 0 and connections is None:
            connections = []  # non-stop implies no connecting airports
        if connections is not None and total_stops is not None and len(connections) != total_stops:
            return self._no_estimate(f"connections lists {len(connections)} airport(s) but "
                                     f"total_stops is {total_stops}.")
        if airline is not None and all(v is not None for v in details):
            tier = "full" if connections is not None and "full" in bundle["models"] else "trip_details"
        elif airline is not None:
            tier = "route_date_airline"
        else:
            tier = "route_date"
        if tier not in ("full", "trip_details") and (
                any(v is not None for v in details) or connections is not None):
            warnings.append("Partial trip details ignored; the detailed model needs airline, "
                            "total_stops, duration_min and dep_hour together.")

        travel_date = date.today() + timedelta(days=days_ahead)
        if travel_date.month not in bundle["journey_months"]:
            lo, hi = bundle["journey_date_range"]
            warnings.append(f"Travel month {travel_date.month} is outside the training data "
                            f"({lo} to {hi}); seasonal effects are not modeled for it.")

        try:
            features = build_inference_frame(origin, destination, travel_date, airline=airline,
                                             total_stops=total_stops, duration_min=duration_min,
                                             dep_hour=dep_hour, connections=connections)
        except (TypeError, ValueError) as e:
            return self._no_estimate(f"Invalid trip details: {e}")
        predicted_inr = float(bundle["models"][tier].predict(features)[0])
        if not math.isfinite(predicted_inr) or predicted_inr <= 0:
            return self._no_estimate("Model produced an invalid fare for these inputs.")

        half_width = math.exp(bundle["interval_log_half_width"][tier])
        level = int(round(bundle["interval_level"] * 100))
        low_inr, high_inr = predicted_inr / half_width, predicted_inr * half_width
        usd = round(predicted_inr / INR_PER_USD, 2)
        return {
            "estimated_price_usd": usd,
            "predicted_fare_usd": usd,  # key read by the frontend's fare card
            "estimated_price_inr": round(predicted_inr),
            "price_range_usd": [round(low_inr / INR_PER_USD, 2), round(high_inr / INR_PER_USD, 2)],
            "price_range_inr": [round(low_inr), round(high_inr)],
            "range_note": f"~{level}% of held-out historical fares fell inside ranges built this "
                          f"way; not a guarantee.",
            "currency_note": f"Model trained on 2019 INR fares; USD at {INR_PER_USD} INR/USD.",
            # The training fares are single one-way tickets in this direction only.
            "fare_type": "one-way",
            "route": f"{origin}->{destination}",
            "input_tier": tier,
            "expected_mae_inr": bundle["test_metrics"][tier]["mae"],
            "assumed_days_ahead": days_ahead,
            "warnings": warnings,
            "model_version": self.model_version,
        }

    def predict_for_trip(self, origin_iata: str | None, destination_iata: str | None,
                         flight_details: list[dict] | None = None, days_ahead: int = 30) -> dict:
        """
        Route estimate that uses live flight details when available.

        `flight_details` are dicts from tools.flight_tool.extract_flight_details
        (airline, total_stops, duration_min, dep_hour, connections, ...). Each
        flight on this exact route is scored with the most detailed model tier
        its fields allow; the headline fare is the median across those flights.
        With no usable flights it returns the plain route + date estimate.
        """
        route_estimate = self.predict(origin_iata, destination_iata, days_ahead=days_ahead)
        if route_estimate["estimated_price_usd"] is None:
            return route_estimate

        origin, destination = to_iata(origin_iata), to_iata(destination_iata)
        per_flight = []
        for flight in flight_details or []:
            if to_iata(flight.get("dep_iata")) != origin or to_iata(flight.get("arr_iata")) != destination:
                continue
            result = self.predict(
                origin, destination, airline=flight.get("airline") or "unknown",
                days_ahead=days_ahead, total_stops=flight.get("total_stops"),
                duration_min=flight.get("duration_min"), dep_hour=flight.get("dep_hour"),
                connections=flight.get("connections"))
            if result["estimated_price_usd"] is not None:
                per_flight.append((flight, result))
            if len(per_flight) == MAX_FLIGHT_ESTIMATES:
                break

        if not per_flight:
            route_estimate["basis"] = "route and date only (no usable live flight details)"
            return route_estimate

        median_inr = statistics.median(r["estimated_price_inr"] for _, r in per_flight)
        tiers = [r["input_tier"] for _, r in per_flight]
        main_tier = max(set(tiers), key=tiers.count)
        warnings = list(dict.fromkeys(w for _, r in per_flight for w in r["warnings"]))
        usd = round(median_inr / INR_PER_USD, 2)
        return {
            **route_estimate,
            "estimated_price_usd": usd,
            "predicted_fare_usd": usd,
            "estimated_price_inr": round(median_inr),
            "price_range_usd": [min(r["price_range_usd"][0] for _, r in per_flight),
                                max(r["price_range_usd"][1] for _, r in per_flight)],
            "price_range_inr": [min(r["price_range_inr"][0] for _, r in per_flight),
                                max(r["price_range_inr"][1] for _, r in per_flight)],
            "range_note": route_estimate["range_note"] + " Range spans the cheapest to "
                          "priciest flight's interval.",
            "input_tier": main_tier,
            "expected_mae_inr": self.bundle["test_metrics"][main_tier]["mae"],
            "basis": f"median of {len(per_flight)} scheduled flight(s) on this route",
            "route_only_estimate_usd": route_estimate["estimated_price_usd"],
            "flight_estimates": [{
                "airline": f.get("airline"), "flight": f.get("flight_iata"),
                "departure_scheduled": f.get("dep_scheduled"),
                "duration_min": f.get("duration_min"), "total_stops": f.get("total_stops"),
                "estimated_price_usd": r["estimated_price_usd"],
                "estimated_price_inr": r["estimated_price_inr"],
                "price_range_usd": r["price_range_usd"], "input_tier": r["input_tier"],
            } for f, r in per_flight],
            "warnings": warnings,
        }

    def _no_estimate(self, note: str) -> dict:
        return {"estimated_price_usd": None, "note": note, "model_version": self.model_version}

    def _predict_stub(self, origin, destination) -> dict:
        return {
            "estimated_price_usd": None,
            "note": f"No trained price model yet for {origin}->{destination}. "
                    f"Add data/flight_fares.csv and run scripts/train_price_model.py.",
            "model_version": self.model_version,
        }


price_predictor = FlightPricePredictor()
