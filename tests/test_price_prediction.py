"""
Tests for the flight price model: preprocessing, model loading, prediction,
and the /api/travel response contract the frontend relies on.

Run from the repo root:
    python -m unittest discover -s tests -v

Model-dependent tests are skipped until scripts/train_price_model.py has
produced analytics/models/price_model.pkl.
"""
import json
import math
import sys
import tempfile
import types
import unittest
from unittest import mock
from datetime import date
from pathlib import Path

import joblib
import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from analytics.price_features import (CATEGORICAL, FEATURES, TIERS, build_inference_frame,  # noqa: E402
                                      build_training_frame, parse_clock_hour,
                                      parse_duration_minutes, to_iata)
from analytics.price_features import add_arrival_features  # noqa: E402
from analytics.price_prediction import (MODEL_PATH, FlightPricePredictor, match_airline,  # noqa: E402
                                         summarize_for_prompt)
from tools import flight_tool  # noqa: E402

HAS_MODEL = MODEL_PATH.exists()


def aviationstack_record(airline="IndiGo", flight="6E2131", dep="BLR", arr="DEL",
                         dep_time="2026-10-11T22:20:00+00:00",
                         arr_time="2026-10-12T01:10:00+00:00", codeshared=None):
    """Shape of one AviationStack /v1/flights record (only the fields we read)."""
    return {
        "flight_status": "scheduled", "airline": {"name": airline},
        "flight": {"iata": flight, "codeshared": codeshared},
        "departure": {"airport": "A", "iata": dep, "scheduled": dep_time,
                      "terminal": None, "gate": None, "delay": None},
        "arrival": {"airport": "B", "iata": arr, "scheduled": arr_time,
                    "terminal": None, "gate": None, "delay": None},
    }


class FlightDetailsTests(unittest.TestCase):
    def test_overnight_direct_leg(self):
        details = flight_tool.extract_flight_details(aviationstack_record())
        self.assertEqual(details["airline"], "IndiGo")
        self.assertEqual(details["total_stops"], 0)
        self.assertEqual(details["connections"], [])
        self.assertAlmostEqual(details["dep_hour"], 22 + 20 / 60)
        self.assertEqual(details["duration_min"], 170)  # 22:20 -> 01:10 next day

    def test_cross_timezone_has_no_duration(self):
        # Scheduled times are local wall-clock; DAC (UTC+6) -> DEL (UTC+5:30)
        # can't be subtracted naively, so duration is left unknown.
        details = flight_tool.extract_flight_details(aviationstack_record(dep="DAC", arr="DEL"))
        self.assertIsNone(details["duration_min"])

    def test_codeshare_and_incomplete_records_skipped(self):
        self.assertIsNone(flight_tool.extract_flight_details(
            aviationstack_record(codeshared={"airline_name": "x"})))
        record = aviationstack_record()
        record["arrival"]["iata"] = None
        self.assertIsNone(flight_tool.extract_flight_details(record))

    def test_text_output_unchanged_and_single_api_call(self):
        payload = {"data": [aviationstack_record(), aviationstack_record(airline="SpiceJet")]}
        with mock.patch.object(flight_tool, "API_KEY", "k"), \
                mock.patch("requests.get", return_value=mock.Mock(json=lambda: payload)) as get:
            text = flight_tool.search_flights("Trip from Bangalore to Delhi")
            self.assertEqual(get.call_count, 1)
            text2, details = flight_tool.search_flights_with_details("Trip from Bangalore to Delhi")
            self.assertEqual(get.call_count, 2)
        self.assertEqual(text, text2)
        self.assertTrue(text.startswith("Live flights from BLR to DEL"))
        self.assertIn("Airline: SpiceJet", text)
        self.assertEqual([d["airline"] for d in details], ["IndiGo", "SpiceJet"])

    def test_compact_flight_summary_for_prompts(self):
        payload = {"data": [aviationstack_record(),
                            aviationstack_record(airline="Qantas", flight="QF1",
                                                 codeshared={"airline_name": "indigo"})]}
        with mock.patch.object(flight_tool, "API_KEY", "k"), \
                mock.patch("requests.get", return_value=mock.Mock(json=lambda: payload)):
            text, details = flight_tool.search_flights_with_details("Trip from Bangalore to Delhi")
        summary = flight_tool.summarize_flights_for_prompt(text, details)
        self.assertEqual(summary.splitlines(), [
            "Live flights from BLR to DEL (scheduled local times):",
            "- IndiGo 6E2131 | BLR T? 22:20 -> DEL T? 01:10 | scheduled",
        ])
        self.assertLess(len(summary), len(text) / 2)
        # No parsed details (errors, no data): the original text is used as-is.
        self.assertEqual(flight_tool.summarize_flights_for_prompt("Flight API error", []),
                         "Flight API error")

    def test_errors_return_no_details(self):
        with mock.patch.object(flight_tool, "API_KEY", None):
            text, details = flight_tool.search_flights_with_details("Trip from Bangalore to Delhi")
        self.assertIn("AVIATIONSTACK_API_KEY is missing", text)
        self.assertEqual(details, [])


class ArrivalDerivationTests(unittest.TestCase):
    def test_derived_arrival_matches_raw_column(self):
        raw = pd.read_csv(ROOT / "data" / "flight_fares.csv")
        frame = add_arrival_features(build_training_frame(raw))
        raw = raw.loc[frame.index]
        ok = frame.duration_min.notna()
        raw_hour = raw.Arrival_Time.map(parse_clock_hour)
        raw_overnight = raw.Arrival_Time.str.contains(r"\d{1,2} [A-Za-z]{3}").astype(float)
        mismatch = ok & ((np.abs(frame.arr_hour - raw_hour) > 1e-9) | (frame.overnight != raw_overnight))
        # Only 3 rows disagree, and they're raw-data errors: e.g. Air India
        # BOM->HYD departing 21:10 with "4h 15m" duration listed as arriving 16:55
        # the same day.
        self.assertEqual(int(ok.sum()), 10_682)
        self.assertEqual(sorted(raw.index[mismatch]), [3821, 5309, 8232])
        self.assertTrue((raw.loc[mismatch, "Total_Stops"] == "2 stops").all())

    def test_derivation_does_not_mutate_input(self):
        frame = build_inference_frame("BLR", "DEL", date(2019, 3, 24), dep_hour=22.0, duration_min=180)
        derived = add_arrival_features(frame)
        self.assertTrue(pd.isna(frame.at[0, "arr_hour"]))
        self.assertEqual(derived.at[0, "arr_hour"], 1.0)
        self.assertEqual(derived.at[0, "overnight"], 1.0)

    def test_airline_matching(self):
        known = ["Air Asia", "GoAir", "IndiGo"]
        self.assertEqual(match_airline("INDIGO", known), "IndiGo")
        self.assertEqual(match_airline("AirAsia India", known), "Air Asia")
        self.assertEqual(match_airline("Go First", known), "GoAir")
        self.assertIsNone(match_airline("Akasa Air", known))
        self.assertIsNone(match_airline(None, known))


class FeatureEngineeringTests(unittest.TestCase):
    def test_parsers(self):
        self.assertEqual(parse_duration_minutes("2h 50m"), 170)
        self.assertEqual(parse_duration_minutes("19h"), 19 * 60)
        self.assertTrue(math.isnan(parse_duration_minutes("5m")))  # data error in the CSV
        self.assertAlmostEqual(parse_clock_hour("01:10 22 Mar"), 1 + 10 / 60)
        self.assertEqual(to_iata("Banglore"), "BLR")
        self.assertEqual(to_iata("New Delhi"), to_iata("Delhi"))
        self.assertEqual(to_iata("del"), "DEL")
        self.assertIsNone(to_iata("Atlantis"))

    def test_training_frame_from_shipped_csv(self):
        raw = pd.read_csv(ROOT / "data" / "flight_fares.csv", nrows=300)
        frame = build_training_frame(raw)
        self.assertEqual(len(frame), 300)
        self.assertTrue(set(FEATURES).issubset(frame.columns))
        self.assertTrue(frame.origin.str.fullmatch(r"[A-Z]{3}").all())
        self.assertTrue((frame.price > 0).all())

    def test_inference_frame_matches_training_columns(self):
        raw = pd.read_csv(ROOT / "data" / "flight_fares.csv", nrows=50)
        train_frame = build_training_frame(raw)[FEATURES]
        infer_frame = build_inference_frame("BLR", "DEL", date(2019, 3, 24))
        self.assertEqual(list(infer_frame.columns), list(train_frame.columns))
        # Unknown categoricals must be NaN (what the imputers detect), not None.
        for col in ("airline", "additional_info", "via"):
            self.assertTrue(pd.isna(infer_frame.at[0, col]))
            self.assertIsNot(infer_frame.at[0, col], None)

    def test_normalized_schema_is_supported(self):
        raw = pd.DataFrame({"origin": ["BLR"], "destination": ["DEL"], "airline": ["IndiGo"],
                            "days_before_departure": [30], "month": [3], "day_of_week": [0],
                            "price": [4000]})
        frame = build_training_frame(raw)
        self.assertEqual(frame.iloc[0].destination, "DEL")


class PredictorWithoutModelTests(unittest.TestCase):
    def test_stub_when_model_missing(self):
        predictor = FlightPricePredictor(Path(tempfile.gettempdir()) / "does-not-exist.pkl")
        result = predictor.predict("BLR", "DEL")
        self.assertEqual(result["model_version"], "stub-v0")
        self.assertIsNone(result["estimated_price_usd"])

    def test_legacy_pickle_falls_back_to_stub(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "legacy.pkl"
            joblib.dump(["old trainer saved a bare Pipeline"], path)  # any non-bundle object
            self.assertEqual(FlightPricePredictor(path).model_version, "stub-v0")

    def test_missing_locations(self):
        result = FlightPricePredictor(Path("nope.pkl")).predict(None, "DEL")
        self.assertIsNone(result["estimated_price_usd"])
        self.assertIn("note", result)


@unittest.skipUnless(HAS_MODEL, "train the model first: python scripts/train_price_model.py")
class PredictorWithModelTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.predictor = FlightPricePredictor()
        cls.bundle = cls.predictor.bundle

    def test_bundle_loaded(self):
        self.assertIsNotNone(self.bundle)
        self.assertNotEqual(self.predictor.model_version, "stub-v0")
        self.assertEqual(set(self.bundle["models"]), set(TIERS))

    def test_covered_route_returns_consistent_estimate(self):
        result = self.predictor.predict("BLR", "DEL")
        self.assertEqual(result["input_tier"], "route_date")
        usd = result["estimated_price_usd"]
        self.assertGreater(usd, 0)
        self.assertEqual(result["predicted_fare_usd"], usd)
        low, high = result["price_range_usd"]
        self.assertLessEqual(low, usd)
        self.assertGreaterEqual(high, usd)
        json.dumps(result)  # must be JSON-serializable for the API

    def test_plausible_magnitude_for_all_routes(self):
        for origin, destination in self.bundle["routes"]:
            inr = self.predictor.predict(origin, destination)["estimated_price_inr"]
            self.assertTrue(1_000 < inr < 100_000, (origin, destination, inr))

    def test_uncovered_route_returns_no_number(self):
        result = self.predictor.predict("DAC", "NRT")
        self.assertIsNone(result["estimated_price_usd"])
        self.assertIn("trained only on", result["note"])

    def test_invalid_days_ahead(self):
        for bad in (-1, 1000, "30", 2.5, True):
            result = self.predictor.predict("BLR", "DEL", days_ahead=bad)
            self.assertIsNone(result["estimated_price_usd"], bad)

    def test_tier_selection(self):
        airline = self.bundle["airlines"][0]
        self.assertEqual(self.predictor.predict("BLR", "DEL", airline=airline)["input_tier"],
                         "route_date_airline")
        # Non-stop implies no connections, so the top tier is available.
        full = self.predictor.predict("BLR", "DEL", airline="IndiGo", total_stops=0,
                                      duration_min=170, dep_hour=22.3)
        self.assertEqual(full["input_tier"], "full")
        one_stop = dict(airline="Jet Airways", total_stops=1, duration_min=600, dep_hour=20.0)
        self.assertEqual(self.predictor.predict("DEL", "COK", **one_stop)["input_tier"], "trip_details")
        with_via = self.predictor.predict("DEL", "COK", connections=["BOM"], **one_stop)
        self.assertEqual(with_via["input_tier"], "full")
        self.assertGreater(with_via["estimated_price_usd"], 0)
        mismatch = self.predictor.predict("DEL", "COK", connections=["BOM", "HYD"], **one_stop)
        self.assertIsNone(mismatch["estimated_price_usd"])
        bad_code = self.predictor.predict("DEL", "COK", connections=["Atlantis"], **one_stop)
        self.assertIsNone(bad_code["estimated_price_usd"])
        unknown = self.predictor.predict("BLR", "DEL", airline="Not An Airline")
        self.assertEqual(unknown["input_tier"], "route_date")
        self.assertTrue(unknown["warnings"])

    def test_nonstop_cheaper_than_two_stops(self):
        # Realistic combos from the data (DEL->COK medians: 0 stops ~3h, 2 stops ~14h);
        # stops and duration are correlated, so vary both. Averaged over in-range
        # journey dates, since dates outside Mar-Jun are extrapolation.
        model = self.bundle["models"]["trip_details"]
        dates = pd.date_range("2019-03-01", "2019-06-27", freq="7D")

        def mean_fare(airline, stops, duration):
            return np.mean([model.predict(build_inference_frame(
                "DEL", "COK", d, airline=airline, total_stops=stops,
                duration_min=duration, dep_hour=9.0))[0] for d in dates])

        for airline in ("IndiGo", "Jet Airways", "Air India"):
            self.assertLess(mean_fare(airline, 0, 190), mean_fare(airline, 2, 850), airline)

    def test_tier_model_ignores_masked_columns(self):
        frame = build_inference_frame("BLR", "DEL", date(2019, 5, 1), airline="IndiGo",
                                      total_stops=0, duration_min=170, dep_hour=6.0)
        other = frame.copy()
        other.loc[0, ["airline", "total_stops", "duration_min", "dep_hour", "arr_hour", "via"]] =             ["Air India", 2, 900, 20.0, 11.0, "BOM-HYD"]
        model = self.bundle["models"]["route_date"]
        self.assertAlmostEqual(model.predict(frame)[0], model.predict(other)[0], places=6)

    def test_every_tier_pipeline_derives_arrival_first(self):
        for tier, model in self.bundle["models"].items():
            first_name, _ = model.regressor_.steps[0]
            self.assertEqual(first_name, "derive_arrival", tier)

    def test_caller_supplied_arrival_values_are_ignored(self):
        frame = build_inference_frame("DEL", "COK", date(2019, 5, 1), airline="IndiGo",
                                      total_stops=1, duration_min=600, dep_hour=20.0,
                                      connections=["BOM"])
        bogus = frame.copy()
        bogus.loc[0, ["arr_hour", "overnight"]] = [3.0, 0.0]  # wrong: real arrival is 06:00 next day
        correct = add_arrival_features(frame)
        for tier in ("full", "trip_details"):
            model = self.bundle["models"][tier]
            p = model.predict(frame)[0]
            self.assertAlmostEqual(p, model.predict(bogus)[0], places=6)
            self.assertAlmostEqual(p, model.predict(correct)[0], places=6)

    def test_predict_for_trip_uses_live_flight_details(self):
        flights = [flight_tool.extract_flight_details(r) for r in (
            aviationstack_record(),
            aviationstack_record(airline="Air India", flight="AI504",
                                 dep_time="2026-10-11T06:00:00+00:00",
                                 arr_time="2026-10-11T08:45:00+00:00"),
            aviationstack_record(airline="Akasa Air", flight="QP1"),     # unknown in 2019 data
            aviationstack_record(dep="BOM", arr="HYD", flight="6E9"),    # different route
        )]
        result = self.predictor.predict_for_trip("BLR", "DEL", flights)
        self.assertEqual(len(result["flight_estimates"]), 3)
        tiers = [f["input_tier"] for f in result["flight_estimates"]]
        self.assertEqual(tiers, ["full", "full", "route_date"])
        self.assertEqual(result["input_tier"], "full")
        self.assertTrue(any("Akasa Air" in w for w in result["warnings"]))
        self.assertEqual(result["predicted_fare_usd"], result["estimated_price_usd"])
        low, high = result["price_range_usd"]
        self.assertTrue(low <= result["estimated_price_usd"] <= high)
        # Training fares are single tickets in one direction; the LLM relies on this label.
        self.assertEqual(result["fare_type"], "one-way")
        self.assertEqual(result["route"], "BLR->DEL")
        json.dumps(result)

        # The LLM gets a compact summary (the full dict overflowed Groq's token limit).
        summary = summarize_for_prompt(result)
        self.assertTrue(summary.startswith("One-way fare estimate for BLR->DEL"))
        self.assertIn("AI504", summary)
        self.assertLess(len(summary), len(str(result)) / 2)
        self.assertTrue(summarize_for_prompt({"estimated_price_usd": None, "note": "x",
                                              "model_version": "stub-v0"}).startswith("No fare estimate"))

    def test_predict_for_trip_falls_back_without_details(self):
        result = self.predictor.predict_for_trip("BLR", "DEL", [])
        self.assertEqual(result["input_tier"], "route_date")
        self.assertIn("route and date only", result["basis"])
        uncovered = self.predictor.predict_for_trip("DAC", "NRT", [])
        self.assertIsNone(uncovered["estimated_price_usd"])

    def test_matches_held_out_quality_on_sample(self):
        # Sanity check that the saved model reproduces sensible error on known data.
        raw = pd.read_csv(ROOT / "data" / "flight_fares.csv").drop_duplicates().sample(500, random_state=0)
        frame = build_training_frame(raw)
        preds = self.bundle["models"]["full"].predict(frame[FEATURES])
        self.assertLess(np.mean(np.abs(preds - frame.price)), 1500)


@unittest.skipUnless(HAS_MODEL, "train the model first: python scripts/train_price_model.py")
class TravelApiContractTests(unittest.TestCase):
    """
    Drives the real /api/travel route with a stand-in `backend` module (the
    real one needs Groq + Postgres credentials). The stand-in runs the same
    flight-agent and analytics-node calls as backend.py, with AviationStack
    mocked.
    """

    def setUp(self):
        from fastapi.testclient import TestClient

        from analytics.price_prediction import price_predictor
        from tools.location_resolver import resolve_trip_locations

        payload = {"data": [aviationstack_record(), aviationstack_record(airline="SpiceJet")]}

        def run_travel_agent(user_input, thread_id=None):
            with mock.patch.object(flight_tool, "API_KEY", "k"), \
                    mock.patch("requests.get", return_value=mock.Mock(json=lambda: payload)):
                flight_text, flight_details = flight_tool.search_flights_with_details(user_input)
            locations = resolve_trip_locations(user_input)
            prediction = price_predictor.predict_for_trip(
                origin_iata=locations["origin_iata"],
                destination_iata=locations["destination_iata"],
                flight_details=flight_details)
            return {"thread_id": thread_id or "t1", "answer": "ok", "flight_results": flight_text,
                    "hotel_results": "", "weather_results": "", "local_info_results": "",
                    "itinerary": "", "price_prediction": prediction, "sentiment_summary": None,
                    "recommended_attractions": [], "llm_calls": 0}

        self._saved_backend = sys.modules.get("backend")
        sys.modules["backend"] = types.SimpleNamespace(run_travel_agent=run_travel_agent)
        import app
        self.client = TestClient(app.app)
        self.client.get("/auth/mock", follow_redirects=False)

    def tearDown(self):
        if self._saved_backend is None:
            sys.modules.pop("backend", None)
        else:
            sys.modules["backend"] = self._saved_backend

    def test_covered_route_reaches_frontend_field(self):
        response = self.client.post("/api/travel", json={"message": "Trip from Bangalore to Delhi"})
        self.assertEqual(response.status_code, 200, response.text)
        prediction = response.json()["price_prediction"]
        # Exactly the condition the frontend uses to show the fare card.
        self.assertNotEqual(prediction["model_version"], "stub-v0")
        self.assertGreater(prediction["predicted_fare_usd"], 0)
        # Live flight details reached the detailed model tier.
        self.assertEqual(prediction["input_tier"], "full")
        self.assertEqual(len(prediction["flight_estimates"]), 2)

    def test_uncovered_route_hides_fare_card(self):
        response = self.client.post("/api/travel", json={"message": "Plan a trip from Dhaka to Tokyo"})
        self.assertEqual(response.status_code, 200, response.text)
        prediction = response.json()["price_prediction"]
        self.assertIsNone(prediction["estimated_price_usd"])
        self.assertFalse(prediction.get("predicted_fare_usd"))


if __name__ == "__main__":
    unittest.main()
